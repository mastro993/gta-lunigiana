import assert from "node:assert/strict"
import { test } from "node:test"

import type { RailF, RoadF, WaterF } from "../features.ts"
import type { V } from "../geometry.ts"
import { clearancesAtGrade, waterTopOf } from "../path-pass.ts"
import type { Bound } from "../profiles.ts"
import type { Clearance } from "../road-levels.ts"
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
// clearance, and shipped its natural level there, 0.5 m over the deck. One deck's bound under the
// water dropped every deck's (1134003774 lost six for one 0.6 m under it), and a path under a
// rail bridge kept its clearance where the lines cross alone.
test("clearancesAtGrade: a path or steps at grade keeps the rail bridge's clearance across its slab, and no deck's that would take it under the water beside it", () => {
  const path: RoadF = {
    id: 2,
    cls: "path",
    w: 1.5,
    surface: "ground",
    private: false,
    pts: [v(50, -10), v(50, 30)],
  }
  const rail: RailF = { id: 3, bridge: true, pts: [v(0, 20), v(100, 20)] }
  const deck = (z: number, y: number, under = [y]): Clearance => {
    const at = (y: number): Bound => ({ x: 50, y, z, kind: "max" })
    return { bounds: [at(y - 2), at(y), at(y + 2)], under: under.map(at) }
  }
  const over: Clearance = { bounds: [{ x: 50, y: 10, z: 17, kind: "min" }], under: [] }
  const clears = (...decks: ReadonlyArray<Clearance>) =>
    clearancesAtGrade(
      new Map([[path, [...decks, over]]]),
      [{ rl: rail, rd: path, c: { x: 50, y: 20, sa: 50, sb: 30 }, clear: 5.5, tagged: false }],
      () => 30,
      waterTopOf([stream], [surface], () => undefined),
    ).get(path)!
  const kinds = (bounds: ReadonlyArray<Bound>) => [
    ...new Set(bounds.map((b) => `${b.kind} ${b.z.toFixed(1)}`)),
  ]
  // Clear of the stream's 19.5 m: the deck's, the tunnel's and the rail's, 24.5 m.
  assert.deepEqual(kinds(clears(deck(20, 2))), ["max 20.0", "min 17.0", "max 24.5"])
  // The rail's, every 2 m across its slab and the path's walkers' reach, and a step past.
  const ys = clears().flatMap((b) => (b.z === 24.5 ? [b.y] : []))
  assert.ok(ys.length >= 3 && ys[0]! < 18 && ys.at(-1)! > 22, `${ys}`)
  // Under it, no deck's: the tunnel's and the rail's alone; so too past the stream's bed, within
  // the path's core's 3.05 m of it (the coast's 326011444, 3.99 m under Via Bassagrande's bridge at
  // −1.53 m).
  assert.deepEqual(kinds(clears(deck(18, 2))), ["min 17.0", "max 24.5"])
  assert.deepEqual(kinds(clears(deck(18, 6))), ["min 17.0", "max 24.5"])
  assert.deepEqual(kinds(clears(deck(18, 6.1))), ["max 18.0", "min 17.0", "max 24.5"])
  // A wet deck drops its own, not another's; nor does a step past its reach alone over the water.
  assert.deepEqual(kinds(clears(deck(18, 2), deck(18, 12))), ["max 18.0", "min 17.0", "max 24.5"])
  assert.deepEqual(kinds(clears(deck(18, 7, [7, 9]))), ["max 18.0", "min 17.0", "max 24.5"])
})
