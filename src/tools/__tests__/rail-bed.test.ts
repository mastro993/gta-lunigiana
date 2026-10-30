import assert from "node:assert/strict"
import { test } from "node:test"

import type { RailF } from "../features.ts"
import { bedLimits, bedReport, extraLevels, railBed } from "../rail-bed.ts"
import type { Grid } from "../terrain.ts"

/** A 4 m grid of 21 × 11 nodes from (0, 0), all at 10 m. */
const flat = (): Grid => ({
  cell: 4,
  cols: 21,
  rows: 11,
  x0: 0,
  y0: 0,
  z: new Float64Array(21 * 11).fill(10),
})
const node = (g: Grid, i: number, j: number) => j * g.cols + i
/** The rail bed of `lines` laid into `g`, what it moved summed up. */
const lay = (
  g: Grid,
  lines: ReadonlyArray<{ readonly pts: ReadonlyArray<number>; readonly z: ReadonlyArray<number> }>,
  crossings: ReadonlyArray<readonly [number, number]>,
  keep?: (k: number) => boolean,
) => bedReport(railBed(g, bedLimits(g, lines, crossings), keep))

test("railBed lowers the corners of every cell the at-grade rail runs through, away from level crossings", () => {
  const g = flat()
  // A road beside the line left nodes 0.8 m over it (Via Riolo); one node two cells off stays.
  for (const [i, j] of [
    [3, 5],
    [4, 6],
    [10, 5],
    [10, 6],
    [6, 8],
  ] as const)
    g.z[node(g, i, j)] = 10.8
  // The rail at y 21 (inside row 5 of cells), level at 10 m; a level crossing at x 40.
  const result = lay(g, [{ pts: [0, 21, 80, 21], z: [10, 10] }], [[40, 21]])
  assert.equal(g.z[node(g, 3, 5)], 10)
  assert.equal(g.z[node(g, 4, 6)], 10)
  assert.equal(g.z[node(g, 6, 8)], 10.8, "two cells off the line")
  // Within 6 m of the crossing the road decides: the cells x 36–44 keep their corners.
  assert.equal(g.z[node(g, 10, 5)], 10.8)
  assert.equal(g.z[node(g, 10, 6)], 10.8)
  assert.equal(result.nodes, 2)
  assert.ok(Math.abs(result.deepest - 0.8) < 1e-9)
  // Terrain 1 m over a rail rising 0.1 m per cell: each corner takes the lowest rail end of the cells
  // it is a corner of, plus 0.05 m floored to the grid's 0.1 m.
  const h = flat()
  h.z.fill(13)
  lay(h, [{ pts: [0, 21, 80, 21], z: [10, 12] }], [])
  assert.deepEqual(
    [node(h, 1, 5), node(h, 19, 6), node(h, 20, 5), node(h, 10, 8)].map((n) => h.z[n]),
    [10, 11.8, 11.9, 13],
  )
})

// Regression: a corner of a cell the line clips stood outside the profile's core,
// left 7 m down in a river's carve north of the Aulella bridge.
test("railBed raises the corners under the rail to 0.5 m below it, but not a road's or a river's", () => {
  const g = flat()
  for (const [i, j] of [
    [3, 5],
    [4, 6],
    [7, 5],
  ] as const)
    g.z[node(g, i, j)] = 3
  const kept = node(g, 7, 5)
  const result = lay(g, [{ pts: [0, 21, 80, 21], z: [10, 10] }], [], (n) => n === kept)
  assert.deepEqual(
    [node(g, 3, 5), node(g, 4, 6), kept].map((n) => g.z[n]),
    [9.5, 9.5, 3],
  )
  assert.equal(result.raised, 2)
  assert.ok(Math.abs(result.fill - 6.5) < 1e-9)
})

test("railBed moves a window's nodes as it moves the whole grid's", () => {
  const whole = flat(),
    span = { i0: 5, j0: 3, cols: 9, rows: 6 }
  whole.z.forEach((_, n) => (whole.z[n] = 9 + ((n * 7) % 13) / 5))
  const part: Grid = {
    ...whole,
    span,
    z: Float64Array.from({ length: span.cols * span.rows }, (_, k) => {
      const i = span.i0 + (k % span.cols),
        j = span.j0 + Math.floor(k / span.cols)
      return whole.z[node(whole, i, j)]!
    }),
  }
  const lines = [{ pts: [0, 21, 80, 23], z: [10, 10.6] }]
  const moved = railBed(whole, bedLimits(whole, lines, [[60, 22]]))
  const inside = railBed(part, bedLimits(part, lines, [[60, 22]]))
  assert.ok(inside.length > 0 && inside.length < moved.length)
  assert.deepEqual(
    inside,
    moved.filter(([n]) => {
      const i = n % whole.cols,
        j = Math.floor(n / whole.cols)
      return i >= 5 && i < 14 && j >= 3 && j < 9
    }),
  )
  part.z.forEach((z, k) =>
    assert.equal(z, whole.z[node(whole, 5 + (k % 9), 3 + Math.floor(k / 9))]),
  )
})

test("extraLevels gives an extra track the nearest running track's level, and its switch vertex the line's own", () => {
  const line: RailF = {
    id: 1,
    pts: [
      { x: 0, y: 0 },
      { x: 100, y: 0, id: "sw" },
    ],
  }
  const siding: RailF = {
    id: -1,
    pts: [
      { x: 100, y: 0, id: "sw" },
      { x: 20, y: 6 },
      { x: 0, y: 8, id: "lc" },
    ],
  }
  const nodeZ = new Map([["sw", 12.05]])
  const levels = extraLevels(
    [siding],
    [{ piece: line, dense: { pts: line.pts, z: [10, 12] } }],
    nodeZ,
  )
  const { z, dense } = levels.get(siding)!
  assert.equal(z[0], 12.05, "the switch: the line's own elevation there")
  assert.ok(Math.abs(z[1]! - 10.4) < 1e-9, "beside x 20 of a line rising from 10 to 12 m")
  assert.ok(Math.abs(z[2]! - 10) < 1e-9)
  assert.equal(nodeZ.get("lc"), z[2], "a road crossing the siding is pinned to it")
  assert.deepEqual(dense.pts[0], siding.pts[0])
})
