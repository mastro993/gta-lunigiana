/**
 * The dispatcher, the same on every line: it brings each line's trains in and takes them off. A new
 * game stands each line's first train at its station nearest the player's start (`FillTrains`); an AI
 * train whose body has run past the drawn run is removed, beyond view, and after a layover of `LAYOVER`
 * s (drawn from `RailRng`) the next enters at the end of the run-out there, the other way (`Dispatch`);
 * a stolen train the player has left goes once all of it is out of view (`VIEW_REACH` m from them, as
 * people and cars quietly go), so the line clears and its next train is due after a layover; a `SetTrains` call makes one due at once
 * (`ApplyTrains`). The trains themselves are drafted in ./service.ts, which drives them.
 *
 * @module rail/dispatch
 */
import { Clock } from "@typeonce/ritmo"
import { Random } from "@typeonce/ritmo-math"

import { segDist2 } from "../collide.ts"
import { MAP } from "../map/index.ts"
import {
  CarInput,
  Driving,
  Game,
  Player,
  Pose,
  RailRng,
  Railway,
  type RailwayValue,
  SetTrains,
  STEP,
  Stolen,
  Time,
  Train,
  TrainMotion,
  TrainRun,
} from "../schema.ts"
import { VIEW_REACH } from "../view.ts"
import { bodiesOn, offCar, type SeenTrain, trainCars } from "./bodies.ts"
import { brakingDistance } from "./driver.ts"
import { DRAWN_RUN, type Line, LINES, nextStop, pointAt, speedAt, stopPoint } from "./lines.ts"
import { spanOf, trainLength, type TrainModel } from "./models.ts"
import { between, DWELL_STEPS, KEEP_BEHIND, trainDraft } from "./service.ts"

/** How long after a train leaves a line its next one enters from that end, s. */
export const LAYOVER = [60, 180] as const
/** The model every AI train is. */
const MODEL: TrainModel = "atr220"

/** How much track ahead of its nose a train entering at `v` m/s needs free of any train, m: its driver's braking distance, to stop KEEP_BEHIND m short of whatever is there (530 m at 85 km/h). */
export const entryClear = (v: number): number => brakingDistance(v) + KEEP_BEHIND

/** The s of `line`'s point nearest (x, y) between its terminals. */
const nearestS = (line: Line, x: number, y: number): number => {
  let best = Number.MAX_VALUE,
    at = 0
  for (let k = 0; k + 1 < line.s.length; k++) {
    const { d2, t } = segDist2(x, y, line.x[k]!, line.y[k]!, line.x[k + 1]!, line.y[k + 1]!)
    if (d2 < best) [best, at] = [d2, line.s[k]! + (line.s[k + 1]! - line.s[k]!) * t]
  }
  return Math.max(0, Math.min(line.length, at))
}

/**
 * Where each line's first train may stand in a new game: its stations, nearest the player's start first, and the line's point
 * nearest the start (s), which the train passes on leaving.
 */
const FIRST = LINES.map((line) => {
  const { player } = MAP.spawns
  const far = (i: number) => {
    const { s0, s1 } = MAP.railway.stations[i]!,
      at = pointAt(line, (s0 + s1) / 2)
    return (at.x - player.x) ** 2 + (at.y - player.y) ** 2
  }
  return {
    stations: [...line.stations].sort((a, b) => far(a) - far(b)),
    near: nearestS(line, player.x, player.y),
  }
})

const LAYOVER_STEPS = [
  Clock.steps(Clock.duration(STEP, LAYOVER[0])),
  Clock.steps(Clock.duration(STEP, LAYOVER[1])),
] as const

/** Where the train entering `line` from end `from` stands: its tail at the run-out's end, its nose toward the line. */
const entry = (line: Line, from: 0 | 1, length: number) => {
  const dir = from === 0 ? 1 : -1
  return { dir, s: from === 0 ? line.start + length : line.end - length } as const
}

/**
 * The dispatcher: an AI train whose whole body has run past its line's drawn run is removed, and that line's next train is due
 * after a layover (drawn from `RailRng`) from that end; a line's due train enters at the run-out's end at line speed, beyond
 * view, once no AI train runs on its line, no train is on its run-out or within `entryClear` ahead of its nose, and no AI train
 * of another line runs the other way on track the two share (`SHARED`), which it would meet head-on. A stolen
 * train the player is not in is removed once all of it is out of view (`VIEW_REACH` m from them); its line, with no AI train on
 * it and none due, has its next due after a layover, from the end nearer where it stood.
 */
export const Dispatch = Game.System(
  "Lunigiana/Dispatch",
  {
    queries: {
      trains: Game.Query({
        selection: {
          motion: Game.Query.read(TrainMotion),
          train: Game.Query.read(Train),
          run: Game.Query.optional(TrainRun),
          stolen: Game.Query.optional(Stolen),
        },
      }),
      player: Game.Query({
        selection: { pose: Game.Query.read(Pose), driving: Game.Query.optional(Driving) },
        with: [Player],
      }),
    },
    resources: {
      railway: Game.System.writeResource(Railway),
      rng: Game.System.writeResource(RailRng),
      time: Game.System.thisTick(Game.System.readResource(Time)),
    },
    commands: Game.System.commands(
      Game.System.spawns(Train, TrainMotion, CarInput, TrainRun),
      Game.System.despawns(Train),
    ),
  },
  ({ queries, resources, commands }) => {
    const { step } = resources.time.get(),
      random = Random.draw(resources.rng)
    const before = resources.railway.get()
    const service: Array<RailwayValue[number]> = [...before]
    const running = new Set<number>()
    const trains = queries.trains.each().map(({ entity, data }) => ({
      entity,
      id: entity.id as number,
      motion: data.motion.get(),
      model: data.train.get().model,
      run: data.run.value(),
      stolen: data.stolen.present,
    }))
    for (const { entity, motion, model, run } of trains) {
      const line = LINES[motion.line]
      if (run === undefined || line === undefined) continue
      const { tail } = spanOf(motion.s, motion.facing, trainLength(model))
      const gone = run.dir > 0 ? tail > line.length + DRAWN_RUN : tail < -DRAWN_RUN
      if (!gone) {
        running.add(motion.line)
        continue
      }
      commands.despawn(entity)
      service[motion.line] = {
        due: step + between(random, LAYOVER_STEPS),
        from: run.dir > 0 ? 1 : 0,
      }
    }
    const found = queries.player.singleOptional(),
      me = found.ok ? found.value?.data : undefined
    const at = me?.pose.get(),
      driving = me?.driving.value(),
      mine = driving === undefined ? -1 : Game.Entity.id(driving.vehicle)
    for (const train of trains) {
      const line = LINES[train.motion.line]
      if (train.run !== undefined || !train.stolen || train.id === mine) continue
      if (at === undefined || line === undefined) continue
      if (trainCars([train]).some((car) => offCar(car, at.x, at.y) < VIEW_REACH)) continue
      commands.despawn(train.entity)
      const i = train.motion.line,
        middle = train.motion.s - (train.motion.facing * trainLength(train.model)) / 2
      if (running.has(i) || service[i]?.due !== null) continue
      service[i] = {
        due: step + between(random, LAYOVER_STEPS),
        from: middle < line.length / 2 ? 0 : 1,
      }
    }
    const ai = trains.filter((train) => train.run !== undefined)
    for (const [i, line] of LINES.entries()) {
      const due = service[i]?.due ?? null
      if (due === null || due > step || running.has(i)) continue
      const length = trainLength(MODEL),
        { dir, s } = entry(line, service[i]!.from, length)
      // Its braking distance ahead of its nose, and its own body on the run-out, free of any train.
      const v = speedAt(line, s),
        clear = entryClear(v)
      const lo = dir > 0 ? line.start : s - clear,
        hi = dir > 0 ? s + clear : line.end
      if (bodiesOn(trains, i).some((body) => body.hi >= lo && body.lo <= hi)) continue
      // Nor any AI train of a line sharing its track running on it the other way: they would meet head-on.
      if (bodiesOn(ai, i).some((body) => body.facing === -dir)) continue
      commands.spawn(
        trainDraft(
          MODEL,
          { line: i, s, facing: dir, v: dir * v },
          { dir, stop: nextStop(line, s, dir, length), state: "run", until: 0 },
        ),
      )
      service[i] = { ...service[i]!, due: null }
    }
    if (service.some((entry, i) => entry !== before[i])) resources.railway.set(service)
  },
)

/**
 * Setup: each line with service and stations gets its first train, dwelling at its station nearest the player's start whose
 * platforms no train placed already stands on (its line's train comes in from a run-out instead, when every one is taken), its
 * dwell drawn from `RailRng`; it faces the way that takes it past the line's point nearest the start (either, drawn, when both
 * do), so it passes the player, unless a train placed ahead that way on track the lines share faces it: then the other way, or,
 * facing one either way, the next station.
 */
export const FillTrains = Game.System(
  "Lunigiana/FillTrains",
  {
    resources: {
      railway: Game.System.writeResource(Railway),
      rng: Game.System.writeResource(RailRng),
      time: Game.System.readResource(Time),
    },
    commands: Game.System.commands(Game.System.spawns(Train, TrainMotion, CarInput, TrainRun)),
  },
  ({ resources, commands }) => {
    const { step } = resources.time.get(),
      random = Random.draw(resources.rng)
    const length = trainLength(MODEL),
      placed: Array<SeenTrain> = []
    const service = resources.railway.get()
    const next = service.map((entry, i) => {
      const line = LINES[i]
      if (entry.due === null || line === undefined || line.stations.length === 0) return entry
      const { stations, near } = FIRST[i]!,
        draw = random.next() < 0.5 ? 1 : -1
      for (const stop of stations) {
        const station = MAP.railway.stations[stop]!,
          // Toward the start: its tail behind the point nearest it, the way it runs.
          ways = ([1, -1] as const).filter(
            (dir) => (near - (stopPoint(station, dir, length) - dir * length)) * dir >= 0,
          ),
          first = ways.length === 1 ? ways[0]! : draw
        const bodies = bodiesOn(placed, i)
        // Not on a train placed already, and never facing one ahead that faces it: they would meet head-on.
        const dir = ([first, first > 0 ? -1 : 1] as const).find((dir) => {
          const { lo, hi } = spanOf(stopPoint(station, dir, length), dir, length)
          return !bodies.some(
            (b) =>
              (b.hi >= lo - KEEP_BEHIND && b.lo <= hi + KEEP_BEHIND) ||
              (b.facing === -dir && (dir > 0 ? b.lo > hi : b.hi < lo)),
          )
        })
        if (dir === undefined) continue
        const s = stopPoint(station, dir, length)
        const motion = { line: i, s, facing: dir, v: 0 }
        commands.spawn(
          trainDraft(MODEL, motion, {
            dir,
            stop,
            state: "dwell",
            until: step + between(random, DWELL_STEPS),
          }),
        )
        placed.push({
          id: -1 - placed.length,
          motion: { ...motion, prev: s, power: 0, brake: 0 },
          model: MODEL,
        })
        return { ...entry, due: null }
      }
      return entry
    })
    if (next.some((entry, i) => entry !== service[i])) resources.railway.set(next)
  },
)

/**
 * Whether a `SetTrains` call makes a line's next train due at `now`: no AI train runs on it (`running`), and none is due by then
 * already (`due`, null when none is). `ApplyTrains` and the dev trains store (src/hud/trains.ts) share it.
 */
export const takesCall = (running: boolean, due: number | null, now: number): boolean =>
  !running && (due === null || due > now)

/** Each `SetTrains` request (a call for trains: the tests and the dev debug menu's Trains area send it) makes a train due now on every line no AI train runs on (`takesCall`). */
export const ApplyTrains = Game.System(
  "Lunigiana/ApplyTrains",
  {
    queries: {
      ai: Game.Query({ selection: { motion: Game.Query.read(TrainMotion) }, with: [TrainRun] }),
    },
    resources: {
      railway: Game.System.writeResource(Railway),
      time: Game.System.readResource(Time),
    },
    events: { requests: Game.System.readEvent(SetTrains) },
  },
  ({ queries, resources, events }) => {
    if (events.requests.all().length === 0) return
    const { step } = resources.time.get(),
      running = new Set(queries.ai.each().map(({ data }) => data.motion.get().line))
    resources.railway.update((service) =>
      service.map((entry, i) =>
        takesCall(running.has(i), entry.due, step) ? { ...entry, due: step } : entry,
      ),
    )
  },
)
