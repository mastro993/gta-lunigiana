import assert from "node:assert/strict"
import { test } from "node:test"

import { latLonToGaussBoaga } from "../crs.ts"
import { fromLocal } from "../geometry.ts"
import { dtmDem, gridLattice, makeGrid, type Span } from "../terrain.ts"

/**
 * A 2 m DTM of 400 × 300 cells round local (0, 0), its heights a rough hill in decimetres, so
 * every sample interpolates between four different heights.
 */
const dtm = () => {
  const [e, n] = latLonToGaussBoaga(...fromLocal(0, 0))
  const cols = 400,
    rows = 300
  const z = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      z[r * cols + c] = Math.round(2000 + 3 * c - 2 * r + ((c * 7919 + r * 104729) % 97)) / 10
  return { e0: Math.floor(e) - 401, n0: Math.floor(n) - 300, cols, rows, cell: 2, z }
}

test("a DTM's grid windows are makeGrid's nodes on its sampler, bit for bit", () => {
  const dem = dtmDem(dtm())
  const { x0, y0, cell, cols, rows } = gridLattice()
  const at = (x: number, y: number) => ({
    i0: Math.round((x - x0) / cell),
    j0: Math.round((y - y0) / cell),
  })
  const spans: ReadonlyArray<Span> = [
    // On the DTM, across several of the projection lattice's 50 m rows and columns.
    { ...at(-300, -250), cols: 151, rows: 126 },
    // Past its crop to the north-east, where it holds the edge value.
    { ...at(700, 500), cols: 40, rows: 31 },
    // The grid's south-west and north-east corners, whose boxes reach past the built terrain.
    { i0: 0, j0: 0, cols: 7, rows: 5 },
    { i0: cols - 6, j0: rows - 9, cols: 6, rows: 9 },
  ]
  for (const span of spans) {
    const fast = dem.grid(span),
      slow = makeGrid(dem.at, span)
    assert.deepEqual(fast.span, span)
    assert.equal(fast.z.length, slow.z.length)
    for (let k = 0; k < slow.z.length; k++)
      if (!Object.is(fast.z[k], slow.z[k]))
        assert.fail(`span ${JSON.stringify(span)} node ${k}: ${fast.z[k]} != ${slow.z[k]}`)
  }
})
