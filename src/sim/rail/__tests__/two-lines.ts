/**
 * A map with more railways, staged as this module loads: a second line runs the first's track the other way round, as a
 * branch shares the main line's track up to its junction (the build's `findLines` makes lines that share track at any
 * junction). The map gets it, with its stations, before any rail module loads, so a test file imports this first, and runs in
 * a process of its own. Shared by `service.test.ts` and `service.long-test.ts`.
 *
 * @module sim/rail/__tests__/two-lines
 */
import assert from "node:assert/strict"

import { MAP, type RailLine, type Station } from "../../map/index.ts"

const main = MAP.railway.lines[0]!
let total = 0
for (const { rail } of main.pieces) {
  const { pts } = MAP.rail[rail]!
  for (let k = 2; k < pts.length; k += 2)
    total += Math.sqrt((pts[k]! - pts[k - 2]!) ** 2 + (pts[k + 1]! - pts[k - 1]!) ** 2)
}
/** The second line: the first's pieces the other way round. */
const back: RailLine = {
  pieces: [...main.pieces].reverse().map(({ rail, rev }) => ({ rail, rev: !rev })),
  maxspeed: [],
}
;(MAP.railway.lines as Array<RailLine>).push(back)
;(MAP.railway.stations as Array<Station>).push(
  ...MAP.railway.stations
    .filter((station) => station.line === 0)
    .reverse()
    .map((station): Station => ({
      ...station,
      line: 1,
      s0: total - station.s1,
      s1: total - station.s0,
      side: station.side === 1 ? -1 : 1,
    })),
)

/** The rail modules and the sim, loaded only once the map has its second line. */
export const { SHARED, sharedPart } = await import("../lines.ts")
export const { meet } = await import("../collisions.ts")
export const { CROSSINGS } = await import("../crossings.ts")
export const { KEEP_BEHIND, trainDraft } = await import("../service.ts")
export const { entryClear, FillTrains } = await import("../dispatch.ts")
export const { placeTrains, railStep, TrainWorld } = await import("../testing.ts")
export const { Game, SetTrains } = await import("../../schema.ts")
export const { start } = await import("../../testing.ts")
export const { bindings, KeyboardInput, makeRuntime } = await import("../../index.ts")
export const { Keyboard } = await import("@typeonce/ritmo-browser")
const { LINES } = await import("../lines.ts")
const { Impact } = await import("../../schema.ts")

/** Steps a second, the ATR 220's length (m), and the two lines. */
export const S = 60,
  LENGTH = 55.57,
  [ahead, behind] = LINES as [(typeof LINES)[number], (typeof LINES)[number]]
/** The lines' length, m. */
export const L = ahead.length

/** A game with no trains, stepped by the railway alone. */
export const railway = () => {
  const game = start()
  const step = (frames: number) => {
    for (let frame = 0; frame < frames; frame++) assert.ok(game.runtime.tick(railStep).ok)
  }
  return { ...game, step, inspect: () => game.runtime.inspect(TrainWorld) }
}

/** Every Impact the schedules ticked with it hear, into `hits`. */
export const listener = (hits: Array<{ hit: string; speed: number }>) =>
  Game.Schedule(
    Game.System(
      "Test/Hits",
      { events: { impacts: Game.System.readEvent(Impact) } },
      ({ events }) => {
        hits.push(...events.impacts.all())
      },
    ),
  )
