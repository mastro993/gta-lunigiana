/**
 * The railway tests' kit, shared by the `trains*.test.ts` files and their `*.long-test.ts`: Monzone's
 * line, the way from Monzone toward Via Riolo and to its nearer neighbour, the train dwelling there
 * for the player to steal, and a game stepped by the railway alone.
 *
 * @module sim/__tests__/railway
 */
import assert from "node:assert/strict"

import type { Descriptor } from "@typeonce/ritmo"

import { Game, Whistle } from "../index.ts"
import { MARGIN } from "../rail/barriers.ts"
import { CROSSINGS } from "../rail/crossings.ts"
import { LINES, nextStop, pointAt, speedAt } from "../rail/lines.ts"
import { trainLength } from "../rail/models.ts"
import {
  aiTrain,
  atDoor,
  crossedBy,
  MONZONE,
  railStep,
  RIOLO,
  stopOf,
  TrainWorld,
  wayInto,
  liveKeys,
} from "../rail/testing.ts"
import { press, start, type Timeline } from "../testing.ts"

/** Steps a second. */
export const S = 60
/** The ATR 220's length, m. */
export const LENGTH = trainLength("atr220")
/** Monzone's line, and where Via Riolo crosses it. */
export const line = LINES[MONZONE.line]!,
  riolo = crossedBy(RIOLO, line.index)
/** Via Riolo's crossing. */
export const box = CROSSINGS[RIOLO]!
/** Where Via Riolo crosses the track, its heading and a way along it there (to walk), and the player watching from 35 m off. */
export const ON_TRACK = pointAt(line, riolo.s),
  ROAD = box.approaches[0]!.heading,
  ROUTE = wayInto(RIOLO, 0).step,
  NEARBY = { x: box.x + 25, y: box.y + 25, angle: 0 }
type Whistled = Descriptor.Descriptor.Value<typeof Whistle>

/** A game with the train service, its world stepped by the railway alone (`railStep`), the whistles it hears collected. */
export const railway = () => {
  const game = start([], undefined, { trains: true })
  const whistles: Array<Whistled> = []
  const listen = Game.Schedule(
    Game.System(
      "Test/Whistles",
      { events: { whistles: Game.System.readEvent(Whistle) } },
      ({ events }) => {
        whistles.push(...events.whistles.all())
      },
    ),
  )
  const step = (
    frames: number,
    each: (world: ReturnType<typeof inspect>, frame: number) => boolean | void = () => {},
  ) => {
    for (let frame = 0; frame < frames; frame++) {
      assert.ok(game.runtime.tick(railStep, listen).ok)
      if (each(inspect(), frame) === true) return frame
    }
    return frames
  }
  const inspect = () => game.runtime.inspect(TrainWorld)
  return { ...game, step, inspect, whistles }
}

/** The way from Monzone toward Via Riolo, and where a train running it stands at Monzone. */
export const toRiolo = Math.sign(riolo.s - stopOf(MONZONE.station, -1)) as 1 | -1,
  atMonzone = stopOf(MONZONE.station, toRiolo)

/** From Monzone the way to its nearer neighbouring station, and that station (an index into `MAP.railway.stations`). */
export const [WAY, NEXT] = (() => {
  const run = (dir: 1 | -1) => {
    const from = stopOf(MONZONE.station, dir),
      next = nextStop(line, from, dir, LENGTH)
    return { dir, next, far: next < 0 ? Number.MAX_VALUE : Math.abs(stopOf(next, dir) - from) }
  }
  const best = [run(1), run(-1)].reduce((a, b) => (b.far < a.far ? b : a))
  return [best.dir, best.next] as const
})()
/** Where a train calling at Monzone that way stands. */
export const AT_MONZONE = stopOf(MONZONE.station, WAY)
/** The ATR 220 dwelling at Monzone, bound for NEXT, for a minute. */
export const dwelling = () => aiTrain(AT_MONZONE, WAY, 0, 60 * S)
/** Where the player stands to board it at its active cab, on the platform's side. */
export const AT_CAB = atDoor(AT_MONZONE, WAY, 0, MONZONE.side)
/** The player at the cab of the train dwelling at Monzone: in at frame 1, the up key held from frame 10. */
export const JOYRIDE: Timeline = [...press(1, "action"), { frame: 10, press: ["up"] }]

/** An AI train entering the line from its start (s 0 end), its tail at the run-out's end, at line speed. */
export const entering = () => aiTrain(line.start + LENGTH, 1, speedAt(line, line.start + LENGTH))

/** Where a train's leading end along `dir` is. */
export const leading = (train: { s: number; facing: 1 | -1 }, dir: 1 | -1) =>
  dir > 0
    ? Math.max(train.s, train.s - train.facing * LENGTH)
    : Math.min(train.s, train.s - train.facing * LENGTH)

/** The calls, removals and entries of the trains on the line over `frames`, or until `trips` trains have run and the next enters. */
export const service = (
  game: ReturnType<typeof railway>,
  frames: number,
  trips = Number.MAX_SAFE_INTEGER,
) => {
  const calls: Array<{ station: number; dir: number; off: number; dwell: number }> = [],
    removed: Array<{ step: number; due: number; from: number; tail: number; v: number }> = [],
    entered: Array<{ step: number; s: number; v: number; dir: number }> = [],
    onOpenBox: Array<string> = []
  let seen: { id: number; state: string; tail: number; v: number } | undefined
  game.step(frames, (world, frame) => {
    const train = world.trains[0]
    if (train === undefined) {
      if (seen !== undefined) {
        const { due, from } = world.railway[line.index]!
        removed.push({ step: frame, due: due!, from, tail: seen.tail, v: seen.v })
      }
      seen = undefined
      return
    }
    if (seen?.id !== train.id)
      entered.push({ step: frame, s: train.s, v: train.v, dir: train.run!.dir })
    if (entered.length > trips) return true
    const run = train.run!
    if (run.state === "dwell" && seen?.state !== "dwell")
      calls.push({
        station: run.stop,
        dir: run.dir,
        off: (train.s - stopOf(run.stop, run.dir)) * run.dir,
        dwell: run.until - frame,
      })
    // Its leading end never on a road box whose arms are not down.
    const head = leading(train, run.dir)
    for (const [i, box] of CROSSINGS.entries()) {
      const at = box.on.find((o) => o.line === line.index)
      if (box.walk || at === undefined || world.crossings[i]!.phase === "closed") continue
      if (Math.abs(head - at.s) <= at.half + MARGIN) onOpenBox.push(`box ${i} at ${frame}`)
    }
    seen = { id: train.id, state: run.state, tail: train.s - train.facing * LENGTH, v: train.v }
    return false
  })
  return { calls, removed, entered, onOpenBox }
}

/** A game where the player stands at the cab of a train dwelling at Monzone, with the trains' world and the player's keys live. */
export const atCab = (alone = true) => {
  const keys = liveKeys()
  const game = start([], [AT_CAB, { trains: [dwelling()] }], { trains: true, alone, keys })
  return { ...game, keys, train: () => game.world().trains[0]! }
}

/** Steps `game` until `done` holds (at most `frames` steps); how many it took. */
export const stepUntil = (
  game: { run: (frames: number) => void },
  frames: number,
  done: () => boolean,
) => {
  for (let frame = 0; frame < frames; frame++) {
    if (done()) return frame
    game.run(1)
  }
  return frames
}

/** The player drives the train as a driver would: up to `top` m/s, then on a 0.6 m/s² braking curve to its nose at s `to`, stopping. */
export const driveTo = (game: ReturnType<typeof atCab>, to: number, top = 22) => {
  let fastest = 0
  stepUntil(game, 600 * S, () => {
    const train = game.train(),
      way = Math.sign(to - train.s),
      fwd = train.v * way,
      d = Math.abs(to - train.s)
    fastest = Math.max(fastest, fwd)
    const want = Math.min(top, Math.sqrt(2 * 0.6 * Math.max(0, d - 1)))
    game.keys.release("up", "down")
    if (want < 0.6 && Math.abs(fwd) < 0.6) return Math.abs(train.v) < 0.01
    // Up and down are toward and away from the cab's way.
    const push = (sign: number) => game.keys.hold(sign * train.facing > 0 ? "up" : "down")
    if (fwd < want - 0.3) push(way)
    else if (fwd > want + 0.3) push(-way)
    return false
  })
  return fastest
}

/** `bodies` as plain data without their entity ids (and their leaders'), which a train spawned before them shifts. */
export const anonymous = (bodies: ReadonlyArray<object>) =>
  bodies.map((body) =>
    Object.fromEntries(Object.entries(body).filter(([key]) => key !== "id" && key !== "leader")),
  )
