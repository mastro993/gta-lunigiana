import assert from "node:assert/strict"
import { test } from "node:test"

import { cellTile, gridTiles } from "../grid-tiles.ts"
import { gridLattice } from "../terrain.ts"

const lattice = gridLattice()

test("gridTiles gives each tile its 501 × 501 nodes cut to the grid, neighbours sharing a border", () => {
  const tiles = gridTiles(lattice, 0)
  const byKey = new Map(tiles.map((t) => [t.key, t.span]))
  for (const { i, j, span } of tiles) {
    assert.ok(span.cols <= 501 && span.rows <= 501 && span.cols > 1 && span.rows > 1)
    const east = byKey.get(`${i + 1}_${j}`),
      north = byKey.get(`${i}_${j + 1}`)
    if (east !== undefined) assert.equal(east.i0, span.i0 + span.cols - 1)
    if (north !== undefined) assert.equal(north.j0, span.j0 + span.rows - 1)
  }
  // Together they hold every node, and a halo widens each window but never past the grid.
  const firstCol = Math.min(...tiles.map((t) => t.span.i0)),
    lastCol = Math.max(...tiles.map((t) => t.span.i0 + t.span.cols - 1)),
    lastRow = Math.max(...tiles.map((t) => t.span.j0 + t.span.rows - 1))
  assert.deepEqual([firstCol, lastCol, lastRow], [0, lattice.cols - 1, lattice.rows - 1])
  gridTiles(lattice, 3).forEach(({ span }, k) => {
    const own = tiles[k]!.span
    assert.ok(span.i0 === Math.max(0, own.i0 - 3) && span.j0 === Math.max(0, own.j0 - 3))
    assert.ok(span.i0 + span.cols <= lattice.cols && span.j0 + span.rows <= lattice.rows)
  })
})

test("cellTile names the tile whose window holds all four nodes of the cell read at a point", () => {
  const spans = new Map(gridTiles(lattice, 0).map((t) => [t.key, t.span]))
  const tileOf = cellTile(lattice)
  const { x0, y0, cell, cols, rows } = lattice
  const xs = [x0 - 50, x0, x0 + 0.5, 0, -0.01, 2000, 1999.99, 2003.9, x0 + (cols - 1) * cell, 1e5],
    ys = [y0 - 50, y0, -2000, -2000.01, 0, 1996, 1999.9, y0 + (rows - 1) * cell, 1e5]
  for (const x of xs)
    for (const y of ys) {
      const span = spans.get(tileOf(x, y))!
      const i = Math.min(cols - 2, Math.max(0, Math.floor((x - x0) / cell))),
        j = Math.min(rows - 2, Math.max(0, Math.floor((y - y0) / cell)))
      assert.ok(i >= span.i0 && i + 1 < span.i0 + span.cols, `x ${x} in ${tileOf(x, y)}`)
      assert.ok(j >= span.j0 && j + 1 < span.j0 + span.rows, `y ${y} in ${tileOf(x, y)}`)
    }
})
