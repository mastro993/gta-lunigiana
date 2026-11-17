/**
 * The dispatcher, the same on every line: it brings each line's trains in, turns them round at a
 * terminus and takes them off. A new game stands each line's first train at its station nearest the
 * player's start (`FillTrains`); an AI train whose body has run past the drawn run is removed, beyond
 * view, and after a layover of `LAYOVER` s (drawn from `RailRng`) the next enters at the end of the
 * run-out there, the other way (`Dispatch`); one dwelling at its line's terminus with no call left
 * ahead has its driver change ends, to run back; a stolen train the player has left goes once all of
 * it is out of view (`VIEW_REACH` m from them, as people and cars quietly go), so the line clears and
 * its next train is due after a layover; a `SetTrains` call makes one due at once (`ApplyTrains`). No
 * train enters or is placed where it could meet another line's head-on on track the two share
 * (`headOn`). The trains themselves are drafted in ./service.ts, which drives them.
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
  type TrainMotionValue,
  TrainRun,
  type TrainRunValue,
} from "../schema.ts"
import { VIEW_REACH } from "../view.ts"
import { boarded } from "./boarding.ts"
import { bodiesOn, offCar, type SeenTrain, trainCars } from "./bodies.ts"
import { brakingDistance } from "./driver.ts"
import {
  DRAWN_RUN,
  type Line,
  LINES,
  nextStop,
  pointAt,
  SHARED,
  sharedPart,
  speedAt,
  stopPoint,
} from "./lines.ts"
import { spanOf, trainLength, type TrainModel } from "./models.ts"
import { between, DWELL_STEPS, KEEP_BEHIND, trainDraft } from "./service.ts"

/** How long after a train leaves a line its next one enters from that end, s. */
export const LAYOVER = [60, 180] as const
/** The model every AI train is. */
const MODEL: TrainModel = "atr220"

/** A stretch of its line a train will still run, from s to s, and the way it runs it (+1 toward +s). */
interface Pass {
  readonly line: number
  readonly lo: number
  readonly hi: number
  readonly dir: 1 | -1
}

/**
 * What a train of `model` will still run of its line (`motion`: its nose's s and the way it faces, which an AI train runs): from
 * its tail on to the line's end that way and, on a line to a terminus running toward it, the whole line back, as it turns round
 * there.
 */
const passesOf = (
  motion: Pick<TrainMotionValue, "line" | "s" | "facing">,
  model: TrainModel,
): Array<Pass> => {
  const line = LINES[motion.line]!,
    dir = motion.facing,
    { lo, hi } = spanOf(motion.s, dir, trainLength(model))
  const on: Pass = {
    line: line.index,
    lo: dir > 0 ? lo : line.start,
    hi: dir > 0 ? line.end : hi,
    dir,
  }
  return line.terminus && dir > 0
    ? [on, { line: line.index, lo: line.start, hi: line.end, dir: -1 }]
    : [on]
}

/**
 * Whether trains that will still run `a` and `b` (`passesOf`) could meet head-on: on track two lines share (`SHARED`) the one
 * runs the other way from the other. Lines of different lengths sharing track, a train still on its own track would run onto
 * the shared one later and meet one entering there head-on, and both would stand face to face for good.
 */
const headOn = (a: ReadonlyArray<Pass>, b: ReadonlyArray<Pass>): boolean =>
  a.some((p) =>
    b.some(
      (q) =>
        p.line !== q.line &&
        sharedPart(SHARED[p.line]![q.line]!, q.lo, q.hi).some(
          (part) => part.hi >= p.lo && part.lo <= p.hi && part.sign * q.dir === -p.dir,
        ),
    ),
  )

/** Whether an AI train of `model` (`motion`, `run`) dwells at its line's terminus with no call left ahead: its driver changes ends. */
const turnsRound = (motion: TrainMotionValue, run: TrainRunValue, model: TrainModel): boolean => {
  const line = LINES[motion.line]
  return (
    line?.terminus === true &&
    run.state === "dwell" &&
    run.dir > 0 &&
    nextStop(line, motion.s, 1, trainLength(model)) < 0
  )
}

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
 * after a layover (drawn from `RailRng`) from that end; one dwelling at its line's terminus with no call left ahead is turned
 * round as its dwell starts (its driver changes ends: `boarded` at its far cab), to run back once it ends; a line's due train
 * enters at the run-out's end at line speed, beyond view, once no AI train runs on its line, no train (another line's entering
 * this step included) is on its run-out or within `entryClear` ahead of its nose, and no AI train of another line, entering this step or running, would run track the
 * two share (`SHARED`) the other way from it, on it or still ahead (`headOn`): they could meet head-on. A stolen train the
 * player is not in is removed once all of it is out of view (`VIEW_REACH` m from them); its line, with no AI train on it and
 * none due, has its next due after a layover, from the end nearer where it stood (its first, on a line to a terminus).
 */
export const Dispatch = Game.System(
  "Lunigiana/Dispatch",
  {
    queries: {
      trains: Game.Query({
        selection: {
          motion: Game.Query.write(TrainMotion),
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
      Game.System.inserts(TrainRun),
      Game.System.despawns(Train),
    ),
  },
  ({ queries, resources, commands }) => {
    const { step } = resources.time.get(),
      random = Random.draw(resources.rng)
    const before = resources.railway.get()
    const service: Array<RailwayValue[number]> = [...before]
    const running = new Set<number>()
    const trains = queries.trains.each().map(({ entity, data }) => {
      const model = data.train.get().model
      let motion = data.motion.get(),
        run = data.run.value()
      if (run !== undefined && turnsRound(motion, run, model)) {
        motion = boarded(motion, model, 1)
        run = { ...run, dir: motion.facing }
        data.motion.set(motion)
        commands.insert(entity, [TrainRun, run])
      }
      return { entity, id: entity.id, motion, model, run, stolen: data.stolen.present }
    })
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
        from: line.terminus || middle < line.length / 2 ? 0 : 1,
      }
    }
    // What each AI train will still run, and each entering this step; and every train's body, with theirs.
    const ahead = trains.flatMap((train) =>
        train.run === undefined ? [] : [passesOf(train.motion, train.model)],
      ),
      seen: Array<SeenTrain> = [...trains]
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
      if (bodiesOn(seen, i).some((body) => body.hi >= lo && body.lo <= hi)) continue
      // Nor any AI train of a line sharing its track that would run it the other way, on it or still ahead (a train still on
      // its own track runs onto the shared one later): they could meet head-on and stand face to face for good.
      const passes = passesOf({ line: i, s, facing: dir }, MODEL)
      if (ahead.some((other) => headOn(passes, other))) continue
      ahead.push(passes)
      // Another line's entry this step sees its body on the track they share.
      const motion = { line: i, s, facing: dir, v: dir * v }
      seen.push({ id: -1 - i, motion: { ...motion, prev: s, power: 0, brake: 0 }, model: MODEL })
      commands.spawn(
        trainDraft(MODEL, motion, {
          dir,
          stop: nextStop(line, s, dir, length),
          state: "run",
          until: 0,
        }),
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
 * do), so it passes the player, unless it could meet a train placed already head-on that way on track the lines share
 * (`headOn`): then the other way, or, either way, the next station.
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
        // Not on a train placed already, and never where it could meet one head-on (`headOn`).
        const dir = ([first, first > 0 ? -1 : 1] as const).find((dir) => {
          const s = stopPoint(station, dir, length),
            { lo, hi } = spanOf(s, dir, length)
          const passes = passesOf({ line: i, s, facing: dir }, MODEL)
          return (
            !bodies.some((b) => b.hi >= lo - KEEP_BEHIND && b.lo <= hi + KEEP_BEHIND) &&
            !placed.some((b) => headOn(passes, passesOf(b.motion, b.model)))
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
