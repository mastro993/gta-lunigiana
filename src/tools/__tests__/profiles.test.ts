import assert from "node:assert/strict"
import { test } from "node:test"

import type { V } from "../geometry.ts"
import { makeProfiler, type Linear } from "../profiles.ts"
import type { Grid } from "../terrain.ts"

const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })
/** A 4 m grid over x −20…620, y −20…20. */
const grid = (): Grid => {
  const cols = 161,
    rows = 11
  return { cell: 4, cols, rows, x0: -20, y0: -20, z: new Float64Array(cols * rows).fill(100) }
}
const SPEC = { w: 4, rank: 1, grade: 0.025, half: 20, tol: 0.03 }

// Regression: the terrain model climbs a hill's face at a tunnel portal (3.6 m over
// the cutting at the Ugliancaldo tunnel's west portal), and the line's grade limit carried that 1.2–1.6
// m for 600 m past it; a bridge end on the slope of what it spans pulled Monzone's line 0.7 m down.
test("profile takes a tunnel portal's and a bridge end's level from the ground just outside them", () => {
  // Flat ground at 100 m. A hill over x 100–200 whose face stands 6 m high at the portals; a gap
  // over x 300–400 whose banks fall 8 m at the bridge's ends.
  const ground = (x: number) => (x >= 100 && x <= 200 ? 106 : x >= 300 && x <= 400 ? 92 : 100)
  const pieces: Array<Linear & { readonly id: number }> = [
    { id: 1, pts: [v(0, 0), v(100, 0, "p0")] },
    { id: 2, tunnel: true, pts: [v(100, 0, "p0"), v(200, 0, "p1")] },
    { id: 3, pts: [v(200, 0, "p1"), v(300, 0, "b0")] },
    { id: 4, bridge: true, pts: [v(300, 0, "b0"), v(400, 0, "b1")] },
    { id: 5, pts: [v(400, 0, "b1"), v(600, 0)] },
  ]
  const g = grid()
  const { profile, zOf } = makeProfiler(
    g,
    (x) => ground(x),
    new Uint8Array(g.z.length).fill(255),
    new Uint8Array(g.z.length),
  )
  profile(
    pieces.map((item) => ({ item, rev: false })),
    SPEC,
  )
  for (const p of pieces)
    for (const z of zOf.get(p)!) assert.ok(Math.abs(z - 100) < 1e-6, `piece ${p.id} at ${z}`)
})
