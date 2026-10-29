/**
 * The railway's mechanics, whoever drives: the level crossings' cycle (`Crossings`, before traffic
 * reads it) and every train's motion along its line (`TrainPhysics`, after the AI drivers and the
 * vehicles move). The AI drivers and the dispatcher are in ./service.ts.
 *
 * @module rail/systems
 */
import { Clock } from "@typeonce/ritmo"

import { MAP } from "../map/index.ts"
import {
  CarInput,
  Driving,
  Game,
  GameClock,
  Impact,
  LevelCrossings,
  Player,
  STEP,
  Time,
  Train,
  TrainMotion,
  type TrainMotionValue,
  TrainRun,
  type TrainRunValue,
  Weather,
  type WeatherValue,
} from "../schema.ts"
import { airAt } from "../sky/climate.ts"
import { DRY, groundAt } from "../sky/local.ts"
import { advanceCrossing, DEPARTURE, demands, OPEN, type RailTrain } from "./barriers.ts"
import { buffersOf, endStop, meet, supervise, TOUCH_SPEED } from "./collisions.ts"
import { CROSSINGS } from "./crossings.ts"
import { railGrip, stepTrain, type TrackUnder } from "./dynamics.ts"
import { curvatureAt, type Line, LINES, nextStop, pointAt, stopPoint } from "./lines.ts"
import { spanOf, TRAINS, trainLength, type TrainModel } from "./models.ts"

const DEPARTURE_STEPS = Clock.steps(Clock.duration(STEP, DEPARTURE))

/** A train as the crossings see it (`RailTrain`), with its lever's `throttle` and its AI driver's run, if any. */
const asRail = (
  motion: TrainMotionValue,
  model: TrainModel,
  throttle: number,
  run: TrainRunValue | undefined,
  now: number,
): RailTrain => {
  const { tail } = spanOf(motion.s, motion.facing, trainLength(model))
  // The player's, or none: standing with the lever forward, it is about to move off its cab's way.
  if (run === undefined)
    return {
      line: motion.line,
      head: motion.s,
      tail,
      v: motion.v,
      ...(throttle > 0 ? { ai: { dir: motion.facing, ready: true } } : {}),
    }
  const line = LINES[motion.line]
  const next =
    run.state === "dwell" && line !== undefined
      ? nextStop(line, motion.s, run.dir, trainLength(model))
      : run.stop
  const station = MAP.railway.stations[next]
  return {
    line: motion.line,
    head: motion.s,
    tail,
    v: motion.v,
    ai: {
      dir: run.dir,
      stop: station === undefined ? undefined : stopPoint(station, run.dir, trainLength(model)),
      // Running or held by something on the track, it may move off at any moment; dwelling, from DEPARTURE s before it leaves.
      ready: run.state !== "dwell" || run.until - now <= DEPARTURE_STEPS,
    },
  }
}

/** Each step every level crossing moves on through its cycle, from whether a train demands it now (`demands`): a train standing with its lever forward, its driver's or the player's, is ready to go. */
export const Crossings = Game.System(
  "Lunigiana/Crossings",
  {
    queries: {
      trains: Game.Query({
        selection: {
          motion: Game.Query.read(TrainMotion),
          train: Game.Query.read(Train),
          input: Game.Query.read(CarInput),
          run: Game.Query.optional(TrainRun),
        },
      }),
    },
    resources: {
      crossings: Game.System.writeResource(LevelCrossings),
      time: Game.System.thisTick(Game.System.readResource(Time)),
    },
  },
  ({ queries, resources }) => {
    const { step } = resources.time.get(),
      states = resources.crossings.get()
    const trains = queries.trains
      .each()
      .map(({ data }) =>
        asRail(
          data.motion.get(),
          data.train.get().model,
          data.input.get().throttle,
          data.run.value(),
          step,
        ),
      )
    // Each box asks only the trains on the lines crossing it.
    const onLine = LINES.map((): Array<RailTrain> => [])
    for (const train of trains) onLine[train.line]?.push(train)
    let changed = false
    const next = CROSSINGS.map((box, i) => {
      const state = states[i] ?? OPEN,
        near = box.on.flatMap((at) => onLine[at.line] ?? []),
        after = advanceCrossing(state, demands(box, near), step)
      changed ||= after !== state
      return after
    })
    if (changed) resources.crossings.set(next)
  },
)

/** The track under a train this step: the grade between its ends, the curvature at its middle, and the rail's grip at its nose (dry in a tunnel). */
export const trackUnder = (
  line: Line,
  motion: TrainMotionValue,
  model: TrainModel,
  weather: WeatherValue,
  seconds: number,
): TrackUnder => {
  const { tail } = spanOf(motion.s, motion.facing, trainLength(model)),
    nose = pointAt(line, motion.s),
    end = pointAt(line, tail)
  const ground = nose.tunnel
    ? DRY
    : groundAt(weather, nose.x, nose.y, nose.z, airAt(seconds, weather))
  return {
    grade: (nose.z - end.z) / (motion.s - tail),
    curvature: curvatureAt(line, (motion.s + tail) / 2),
    grip: railGrip(ground),
  }
}

/**
 * Every train moves along its line from its lever (`CarInput`): the power and the brakes ease toward it, and the traction, the
 * brakes, the running resistance, the grade and the curves move it (rail/dynamics.ts), on rail the weather leaves wet or under
 * snow. The player's train is watched toward the buffer stop at the drawn run past each terminal and stops dead against it
 * (rail/collisions.ts); any other runs on to the end of its line's run-out, no farther. Trains on one track that meet stop each
 * other, both going on at their common speed (`meet`). A buffer or a train struck faster than `TOUCH_SPEED` is an `Impact`: a
 * `wall` hit with the train as its `car`, or a `train` hit with the striking train as `car` and the struck one as `other`.
 */
export const TrainPhysics = Game.System(
  "Lunigiana/TrainPhysics",
  {
    queries: {
      trains: Game.Query({
        selection: {
          motion: Game.Query.write(TrainMotion),
          train: Game.Query.read(Train),
          input: Game.Query.read(CarInput),
        },
      }),
      driver: Game.Query({ selection: { driving: Game.Query.read(Driving) }, with: [Player] }),
    },
    resources: {
      time: Game.System.thisTick(Game.System.readResource(Time)),
      weather: Game.System.readResource(Weather),
      clock: Game.System.readResource(GameClock),
    },
    events: { impact: Game.System.writeEvent(Impact) },
  },
  ({ queries, resources, events }) => {
    const { dt } = resources.time.get()
    if (dt <= 0) return
    const weather = resources.weather.get(),
      { seconds } = resources.clock.get()
    const driven = new Set<number>(
      queries.driver.each().map(({ data }) => Game.Entity.id(data.driving.get().vehicle) as number),
    )
    const moved = queries.trains.each().flatMap(({ entity, data }) => {
      const motion = data.motion.get(),
        { model } = data.train.get(),
        line = LINES[motion.line]
      if (line === undefined) return []
      const spec = TRAINS[model],
        length = trainLength(model),
        track = trackUnder(line, motion, model, weather, seconds),
        mine = driven.has(entity.id)
      const lever = mine
        ? supervise(line, motion, length, data.input.get(), track.grip)
        : data.input.get()
      const next = stepTrain(spec, motion, lever, track, dt)
      // The player's train between the buffer stops, any other between its run-outs' ends.
      const ends = mine ? buffersOf(line) : { lo: line.start, hi: line.end },
        stop = endStop(next, length, ends.lo, ends.hi)
      if (stop.hit > TOUCH_SPEED) {
        const { x, y } = pointAt(line, stop.at)
        events.impact.emit({
          hit: "wall",
          x,
          y,
          speed: stop.hit,
          mass: spec.mass / 1000,
          car: entity.id,
        })
      }
      return [
        {
          data,
          id: entity.id,
          line: motion.line,
          s: stop.s,
          v: stop.v,
          facing: motion.facing,
          length,
          mass: spec.mass,
          prev: motion.s,
          power: next.power,
          brake: next.brake,
        },
      ]
    })
    const met = meet(moved)
    for (const [i, after] of met.trains.entries()) {
      const { data, prev, power, brake } = moved[i]!
      data.motion.set({
        line: after.line,
        s: after.s,
        prev,
        v: after.v,
        facing: after.facing,
        power,
        brake,
      })
    }
    for (const bump of met.bumps) {
      const { x, y } = pointAt(LINES[bump.line]!, bump.s)
      events.impact.emit({
        hit: "train",
        x,
        y,
        speed: bump.speed,
        mass: bump.mass,
        car: bump.car,
        other: bump.other,
      })
    }
  },
)
