import assert from "node:assert/strict"
import { test } from "node:test"

import type { RailF, RoadF, WaterF } from "../features.ts"
import type { V } from "../geometry.ts"
import { clearancesAtGrade, waterTopOf } from "../path-pass.ts"
import type { Bound } from "../profiles.ts"
import { resample } from "../terrain.ts"

const v = (x: number, y: number): V => ({ x, y })
// A 4 m stream along y 0 whose surface falls from 20 to 19 m over x 0–100, its gravel bed 3 m
// either side of its centreline.
const stream: WaterF = {
  id: 1,
  kind: "stream",
  w: 4,
  bed: 3,
  depth: 1,
  pts: [v(0, 0), v(100, 0)],
  from: 0,
}
const surface = resample(stream.pts, 2, (x) => 20 - x / 100)

test("waterTopOf: the highest surface of a water whose bed reaches a point, or of the water standing there", () => {
  const top = waterTopOf([stream], [surface], (x) => (x > 90 ? 25 : undefined))
  assert.ok(Math.abs(top(50, 2.5)! - 19.5) < 1e-9, "on the stream's bed")
  assert.equal(top(50, 3.5), undefined, "past its bed")
  // Within 3 m more, the highest of the surface its bed reaches: 19.52 m, 2 m upstream.
  assert.equal(top(50, 5.5, 3)!.toFixed(2), "19.52", "its bed within 3 m")
  assert.equal(top(95, 0), 25, "in a lake over it")
})

// Regression: the bank path 159053025 along the Canale Lunense, under Via Fonda's bridge
// (647881621) level with its bank, would have dipped to the canal's surface under the deck's
// clearance, and shipped its natural level there, 0.5 m over the deck.
test("clearancesAtGrade: a path or steps at grade keeps the rail bridge's clearance over it, but none under a deck that would take it under the water beside it", () => {
  const path: RoadF = {
    id: 2,
    cls: "path",
    w: 1.5,
    surface: "ground",
    private: false,
    pts: [v(50, -10), v(50, 10)],
  }
  const rail: RailF = { id: 3, bridge: true, pts: [v(0, 5), v(100, 5)] }
  const over: Bound = { x: 50, y: 2, z: 17, kind: "min" }
  const clears = (deck: number, y = 2) =>
    clearancesAtGrade(
      new Map([[path, [{ x: 50, y, z: deck, kind: "max" as const }, over]]]),
      [{ rl: rail, rd: path, c: { x: 50, y: 5, sa: 50, sb: 15 }, clear: 5.5, tagged: false }],
      () => 30,
      waterTopOf([stream], [surface], () => undefined),
    ).get(path)!
  const kinds = (bounds: ReadonlyArray<Bound>) => bounds.map((b) => [b.kind, b.z.toFixed(1)])
  // Clear of the stream's 19.5 m: the deck's, the tunnel's and the rail's, 24.5 m.
  assert.deepEqual(kinds(clears(20)), [
    ["max", "20.0"],
    ["min", "17.0"],
    ["max", "24.5"],
  ])
  // Under it, no deck's: the tunnel's alone; so too past the stream's bed, within the path's
  // core's 3.05 m of it (the coast's 326011444, 3.99 m under Via Bassagrande's bridge at −1.53 m).
  assert.deepEqual(kinds(clears(18)), [["min", "17.0"]])
  assert.deepEqual(kinds(clears(18, 6)), [["min", "17.0"]])
  assert.deepEqual(kinds(clears(18, 6.1)).length, 3)
})
