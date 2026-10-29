/**
 * The AI drivers, the same on every line with no timetable: one AI train runs each line end to end,
 * calls at every station (a dwell of `DWELL` s, drawn from `RailRng`, never `Rng`) and runs off at the
 * far end; trains of lines that share track keep clear of each other there (`SHARED`). `TrainAI` drives
 * each AI train; ./dispatch.ts brings them in and takes them off, and `trainDraft` drafts any train.
 *
 * @module rail/service
 */
import { Clock } from "@typeonce/ritmo"
import { Random } from "@typeonce/ritmo-math"

import { FAUNA } from "../fauna.ts"
import { MAP } from "../map/index.ts"
import {
  Animal,
  CarInput,
  Chassis,
  Driving,
  Footing,
  Game,
  GameClock,
  LevelCrossings,
  Person,
  Pose,
  RailRng,
  STEP,
  Time,
  Train,
  TrainMotion,
  type TrainMotionValue,
  TrainRun,
  type TrainRunValue,
  Vehicle,
  Weather,
  Whistle,
} from "../schema.ts"
import { footingAt } from "../systems/footing.ts"
import { PERSON_RADIUS } from "../tuning.ts"
import { VEHICLES } from "../vehicles.ts"
import { beyond, CROSSING_HOLD, MARGIN } from "./barriers.ts"
import { bodiesOn, type Sighted } from "./bodies.ts"
import { CROSSINGS, CROSSINGS_ON } from "./crossings.ts"
import { brakingDistance, leverFor, type Target } from "./driver.ts"
import { HOLD_SPEED, serviceShare } from "./dynamics.ts"
import { LINES, nextStop, pointAt, speedAt, STOP_REACH, stopPoint } from "./lines.ts"
import { CREEP, fouledAhead, lookout, lookoutReach, touchingAlong } from "./lookout.ts"
import { isHeld, spanOf, TRAINS, trainLength, type TrainModel } from "./models.ts"
import { trackUnder } from "./systems.ts"

/** A station call's dwell, s: the doors, the passengers and the closing warning take about 30–45 s at such halts (Rail Engineer), and the timetable books 1 min. */
export const DWELL = [30, 60] as const
/** An AI train keeps this far behind any train ahead on its track, m. */
export const KEEP_BEHIND = 30
/** Nearer than that, it runs this much slower than the train ahead per metre short, 1/s: a driver's gain on a speed. */
const FALL_BACK = 0.5
/** An AI train sounds a moderately long whistle entering a tunnel at least this long, m (RFI's signal rules, art. 5). */
export const LONG_TUNNEL = 200
/** It sounds this far before the portal, m: a 1.5 s whistle ends about at the mouth. */
export const WHISTLE_LEAD = 30
/** A train slower than this, m/s, has stopped. */
const STILL = 0.01
/** How far ahead an AI driver looks for limits, crossings and trains, m: beyond its longest stop. */
const LOOK_AHEAD = 2000
/** A driver does not look out past its next stop by more than this, m: it stops short of what stands beyond. */
const STOP_LOOK = 5
/** Another train this near either end of an AI train, m, is against it: it struck it, or was struck. */
const AGAINST = 0.5

/** `DWELL` in steps. */
export const DWELL_STEPS = [
  Clock.steps(Clock.duration(STEP, DWELL[0])),
  Clock.steps(Clock.duration(STEP, DWELL[1])),
] as const
/** A whole number of steps from lo to hi, both included, drawn from `random`. */
export const between = (random: Random.Random, [lo, hi]: readonly [number, number]) =>
  random.integer(lo, hi + 1)

/** Released controls: the brakes hold a train at rest. */
const IDLE = { throttle: 0, steer: 0, handbrake: false } as const

/** A train of `model` with its nose at s on `line`, its cab facing `facing`, moving `v` m/s toward +s with its power off, its brakes holding it if it stands; `run` its AI driver. */
export const trainDraft = (
  model: TrainModel,
  motion: Pick<TrainMotionValue, "line" | "s" | "facing" | "v">,
  run?: TrainRunValue,
) => {
  const base = Game.Command.spawn(
    [Train, { model }],
    [
      TrainMotion,
      {
        line: motion.line,
        s: motion.s,
        prev: motion.s,
        v: motion.v,
        facing: motion.facing,
        power: 0,
        brake: motion.v === 0 ? serviceShare(TRAINS[model]) : 0,
      },
    ],
    [CarInput, IDLE],
  )
  return run === undefined ? base : Game.Command.extend(base, [TrainRun, run])
}

/**
 * Every AI train's driver: at a station it dwells (while the game clock runs: behind the title card the day stands still, and
 * so does the dwell), then runs on to the next or off the line; running, it works its lever to the line speed and the braking
 * curves to its next stop, to KEEP_BEHIND m short of a train ahead on its track (of where one coming at it will stand) and to
 * CROSSING_HOLD m short of a level crossing whose arms are not down (rail/driver.ts), and whistles entering a long tunnel. Past
 * that hold point, or standing within its braking distance from the line speed there, it stays where it is until the arms are
 * down, so it never stops on a box or moves off only to brake for one. A person, an animal or a vehicle on the track ahead
 * within its emergency stop, or a vehicle touching its body alongside, holds it (rail/lookout.ts): the emergency brake and the
 * urgent whistle, then the horn, then a creep on until the way is clear; so does another train against either end of it (a
 * collision). Shoved along while it dwells, it pulls the emergency brake. Dwells draw from `RailRng`.
 */
export const TrainAI = Game.System(
  "Lunigiana/TrainAI",
  {
    queries: {
      ai: Game.Query({
        selection: {
          motion: Game.Query.read(TrainMotion),
          train: Game.Query.read(Train),
          run: Game.Query.write(TrainRun),
          input: Game.Query.write(CarInput),
        },
      }),
      trains: Game.Query({
        selection: { motion: Game.Query.read(TrainMotion), train: Game.Query.read(Train) },
      }),
      people: Game.Query({
        selection: { pose: Game.Query.read(Pose), footing: Game.Query.optional(Footing) },
        with: [Person],
        without: [Driving],
      }),
      animals: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          animal: Game.Query.read(Animal),
          footing: Game.Query.optional(Footing),
        },
      }),
      vehicles: Game.Query({
        selection: {
          pose: Game.Query.read(Pose),
          vehicle: Game.Query.read(Vehicle),
          chassis: Game.Query.read(Chassis),
        },
      }),
    },
    resources: {
      time: Game.System.thisTick(Game.System.readResource(Time)),
      crossings: Game.System.thisTick(Game.System.readResource(LevelCrossings)),
      weather: Game.System.readResource(Weather),
      clock: Game.System.readResource(GameClock),
      rng: Game.System.writeResource(RailRng),
    },
    events: { whistle: Game.System.writeEvent(Whistle) },
  },
  ({ queries, resources, events }) => {
    const { step } = resources.time.get(),
      states = resources.crossings.get(),
      weather = resources.weather.get(),
      { seconds, rate } = resources.clock.get()
    const random = Random.draw(resources.rng)
    const trains = queries.trains.each().map(({ entity, data }) => ({
      id: entity.id as number,
      motion: data.motion.get(),
      model: data.train.get().model,
    }))
    // What a driver may see on the track: people on foot, animals and vehicles, each on its own ground.
    let sighted: ReadonlyArray<Sighted> | undefined, cars: ReadonlyArray<Sighted> | undefined
    const vehicles = (): ReadonlyArray<Sighted> =>
      (cars ??= queries.vehicles.each().map(({ data }) => {
        const spec = VEHICLES[data.vehicle.get().model],
          z = data.chassis.get().z - spec.cg
        return { ...data.pose.get(), long: spec.length / 2, wide: spec.width / 2, ground: () => z }
      }))
    const sight = (): ReadonlyArray<Sighted> =>
      (sighted ??= [
        ...queries.people.each().map(({ data }) => {
          const { x, y, angle } = data.pose.get(),
            footing = data.footing.value()
          return {
            x,
            y,
            angle,
            long: PERSON_RADIUS,
            wide: PERSON_RADIUS,
            ground: () => footingAt(footing, x, y),
          }
        }),
        ...queries.animals.each().map(({ data }) => {
          const { x, y, angle } = data.pose.get(),
            { species, size } = data.animal.get(),
            r = FAUNA[species].radius * size,
            footing = data.footing.value()
          return { x, y, angle, long: r, wide: r, ground: () => footingAt(footing, x, y) }
        }),
        ...vehicles(),
      ])
    for (const { entity, data } of queries.ai.each()) {
      const motion = data.motion.get(),
        run = data.run.get(),
        { model } = data.train.get(),
        line = LINES[motion.line]
      if (line === undefined) continue
      const spec = TRAINS[model],
        length = trainLength(model),
        { dir } = run,
        head = motion.s
      // Entering a long tunnel: the head passed the whistle point during the last step.
      for (const tunnel of line.tunnels) {
        if (tunnel.to - tunnel.from < LONG_TUNNEL) continue
        const at = dir > 0 ? tunnel.from - WHISTLE_LEAD : tunnel.to + WHISTLE_LEAD
        if ((motion.prev - at) * dir < 0 && (head - at) * dir >= 0) {
          const { x, y } = pointAt(line, head)
          events.whistle.emit({ train: entity.id, x, y, urgent: false })
        }
      }
      if (run.state === "dwell") {
        if (rate === 0) data.run.set({ ...run, until: run.until + 1 })
        else if (step >= run.until)
          data.run.set({ ...run, state: "run", stop: nextStop(line, head, dir, length) })
        // Standing, the brakes hold it; shoved along by another train, the driver pulls the emergency brake.
        data.input.set(Math.abs(motion.v) < HOLD_SPEED ? IDLE : { ...IDLE, handbrake: true })
        continue
      }
      const { lo, hi } = spanOf(head, motion.facing, length),
        others = bodiesOn(trains, motion.line, entity.id)
      // Another train against either end: it struck this one, or this one struck it.
      const against = others.some((body) => body.hi >= lo - AGAINST && body.lo <= hi + AGAINST)
      const fwd = motion.v * dir,
        station = MAP.railway.stations[run.stop],
        stopAt = station === undefined ? undefined : stopPoint(station, dir, length)
      // The look-out ahead, as far as its emergency stop and no farther than just past its next stop.
      const reach = Math.min(
        lookoutReach(fwd, isHeld(run.state)),
        stopAt === undefined ? Number.MAX_VALUE : (stopAt - head) * dir + STOP_LOOK,
      )
      const watch = lookout(
        run,
        Math.abs(motion.v) < STILL,
        against ||
          fouledAhead(line, head, dir, reach, spec.width / 2, sight()) ||
          touchingAlong(line, lo, hi, spec.width / 2, vehicles()),
        step,
      )
      if (watch.run !== run) data.run.set(watch.run)
      if (watch.urgent) {
        const { x, y } = pointAt(line, head)
        events.whistle.emit({ train: entity.id, x, y, urgent: true })
      }
      const { state } = watch.run
      if (state === "braking" || state === "horn") {
        data.input.set(state === "braking" ? { ...IDLE, handbrake: true } : IDLE)
        continue
      }
      if (
        state === "run" &&
        stopAt !== undefined &&
        Math.abs(motion.v) < STILL &&
        (stopAt - head) * dir < STOP_REACH
      ) {
        data.run.set({ ...run, state: "dwell", until: step + between(random, DWELL_STEPS) })
        data.input.set(IDLE)
        continue
      }
      const z = pointAt(line, head).z,
        targets: Array<Target> = []
      const toward = (s: number, v: number) => {
        targets.push({ d: (s - head) * dir, v, rise: pointAt(line, s).z - z })
      }
      if (stopAt !== undefined) toward(stopAt, 0)
      // Line speed: the lowest limit under the train now, and each lower one ahead; creeping on toward something on the track, a walk.
      let limit = state === "creep" ? CREEP : spec.vmax
      for (const span of line.speeds) {
        if (span.to > lo && span.from < hi) limit = Math.min(limit, span.v)
        const edge = dir > 0 ? span.from : span.to,
          ahead = (edge - head) * dir
        if (ahead > 0 && ahead < LOOK_AHEAD) toward(edge, span.v)
      }
      // A train ahead on its track: keep KEEP_BEHIND m behind its near end, at its speed; nearer, falling back to it. One coming at
      // it: KEEP_BEHIND m short of where its near end stands once its driver brakes as this one plans to, so meeting head-on both
      // stop KEEP_BEHIND m apart.
      for (const body of others) {
        const near = dir > 0 ? body.lo : body.hi,
          gap = (near - head) * dir,
          along = body.v * dir
        if (gap < 0 || gap >= LOOK_AHEAD) continue
        if (along < 0) toward(near - dir * (KEEP_BEHIND + brakingDistance(-along)), 0)
        else
          toward(
            near - dir * KEEP_BEHIND,
            Math.max(0, along - FALL_BACK * Math.max(0, KEEP_BEHIND - gap)),
          )
      }
      // A level crossing ahead, its near edge short of the next stop and not yet reached, whose arms are not down: its hold point
      // (once past it, that brakes the train to a stand), or where it stands if its hold point lies within its braking distance.
      const standing = Math.abs(motion.v) < HOLD_SPEED
      for (const { box, at } of CROSSINGS_ON[motion.line]!) {
        if (CROSSINGS[box]!.walk || states[box]?.phase === "closed") continue
        if (stopAt !== undefined && beyond(at, dir, stopAt)) continue
        const edge = (at.s - dir * (at.half + MARGIN) - head) * dir
        if (edge < 0 || edge > LOOK_AHEAD) continue
        const hold = at.s - dir * CROSSING_HOLD
        const wait = standing && (hold - head) * dir < brakingDistance(speedAt(line, at.s))
        toward(wait ? head : hold, 0)
      }
      const throttle = leverFor(
        spec,
        fwd,
        dir,
        limit,
        targets,
        trackUnder(line, motion, model, weather, seconds),
      )
      data.input.set({ throttle, steer: 0, handbrake: false })
    }
  },
)
