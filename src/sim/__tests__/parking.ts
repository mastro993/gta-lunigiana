/**
 * The villages and spots the parking tests drive to, and their readers, shared by `parked.test.ts` and `parked.long-test.ts`.
 *
 * @module sim/__tests__/parking
 */
import assert from "node:assert/strict"

import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { type PoseValue, SetPlayer } from "../index.ts"
import { MAP } from "../map/index.ts"
import { carOn, PARKING, spotsWithin } from "../population/parked.ts"
import { door, press, start } from "../testing.ts"

/** A game as `start` makes it. */
export type Run = ReturnType<typeof start>

/** Where the player starts. */
export const START = MAP.spawns.player

/** Parked spot `index`'s pose. */
export const spotPose = (index: number): PoseValue => {
  const { x, y, angle } = MAP.spawns.parked[index]!
  return { x, y, angle }
}

/** The spot nearest the start that seed 1 parks a Panda on. */
export const FIRST = spotsWithin(START, PARKING.fill[1])
  .filter((i) => carOn(1, i)?.model === "panda")
  .reduce((a, b) =>
    Vec2.distanceSquared(spotPose(b), START) < Vec2.distanceSquared(spotPose(a), START) ? b : a,
  )

/** The point `m` m from `to` toward `from`, facing `to`. */
export const outFrom = (to: Vec2.Vec2, from: Vec2.Vec2, m: number): PoseValue => {
  const d = Math.max(Vec2.distance(to, from), 1e-9),
    ux = (from.x - to.x) / d,
    uy = (from.y - to.y) / d
  return { x: to.x + ux * m, y: to.y + uy * m, angle: Ops.atan2(-uy, -ux) }
}

/** Sends the player (and the car they drive) to `at` and runs `frames` frames. */
export const go = (game: Run, at: PoseValue, frames: number, each?: () => void) => {
  game.runtime.send(SetPlayer, at)
  game.run(frames, each)
}

/** A game on seed 1 whose player has got into the Panda parked at `FIRST`. */
export const inFirst = () => {
  const game = start(press(10, "action"))
  go(game, door(spotPose(FIRST)), 20)
  assert.equal(game.view()?.mode, "driving")
  return game
}

/** The villages a drive across the map nears, by their HUD districts. */
export const VILLAGES = [
  "Monzone (Stazione)",
  "Monzone Alto",
  "Equi Terme",
  "Gragnola",
  "Colognola",
  "Campiglione",
  "Viano",
  "Vinca",
  "Ugliancaldo",
  "Tenerano",
]
