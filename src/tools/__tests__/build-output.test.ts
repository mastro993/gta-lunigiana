import assert from "node:assert/strict"
import { test } from "node:test"

import { decimetres } from "../build-output.ts"

/** A 3 × 2 grid of heights `z`, m. */
const grid = (z: ReadonlyArray<number>) => ({
  cell: 4,
  cols: 3,
  rows: 2,
  x0: 0,
  y0: 0,
  z: Float64Array.from(z),
})

test("decimetres rounds the grid to whole decimetres, from -3276.8 m to 3276.7 m", () => {
  assert.deepEqual(
    Array.from(decimetres(grid([0, 12.34, 12.36, -3276.8, 3276.7, -0.04]))),
    [0, 123, 124, -32768, 32767, 0],
  )
})

test("decimetres throws for a height that does not fit int16, rather than wrapping it", () => {
  for (const bad of [4000, -4000, 3276.75, Number.NaN, Infinity])
    assert.throws(
      () => decimetres(grid([0, 0, 0, 0, 0, 0].map((z, k) => (k === 4 ? bad : z)))),
      /heightmap: .* at node \(1, 1\) does not fit int16/,
    )
})
