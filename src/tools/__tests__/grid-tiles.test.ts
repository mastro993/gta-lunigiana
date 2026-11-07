import assert from "node:assert/strict"
import { test } from "node:test"

import { tileRange } from "../../sim/map/kinds.ts"
import { BOUNDS } from "../geometry.ts"
import { cellTile, extendEdges, gridTiles, listedNodes } from "../grid-tiles.ts"
import { REGION, regionFromArgs } from "../region.ts"
import { gridLattice } from "../terrain.ts"

const lattice = gridLattice()

/** The L test region (region.ts): x −2400…2400 by y 0…3900, its notch's tiles 0_1 and 1_1 unlisted. */
const L = regionFromArgs(["--region", "lunigiana-l"])
const lLattice = gridLattice(L)
/** Node (x, y) of the L's grid: its index. */
const lNode = (x: number, y: number) =>
  ((y - lLattice.y0) / lLattice.cell) * lLattice.cols + (x - lLattice.x0) / lLattice.cell

test("gridTiles gives each tile its 501 × 501 nodes cut to the grid, neighbours sharing a border", () => {
  const tiles = gridTiles(lattice)
  const byKey = new Map(tiles.map((t) => [t.key, t.span]))
  for (const { i, j, span } of tiles) {
    assert.ok(span.cols <= 501 && span.rows <= 501 && span.cols > 1 && span.rows > 1)
    const east = byKey.get(`${i + 1}_${j}`),
      north = byKey.get(`${i}_${j + 1}`)
    if (east !== undefined) assert.equal(east.i0, span.i0 + span.cols - 1)
    if (north !== undefined) assert.equal(north.j0, span.j0 + span.rows - 1)
  }
  // Together they hold every node.
  const firstCol = Math.min(...tiles.map((t) => t.span.i0)),
    lastCol = Math.max(...tiles.map((t) => t.span.i0 + t.span.cols - 1)),
    lastRow = Math.max(...tiles.map((t) => t.span.j0 + t.span.rows - 1))
  assert.deepEqual([firstCol, lastCol, lastRow], [0, lattice.cols - 1, lattice.rows - 1])
})

test("cellTile names the tile whose window holds all four nodes of the cell read at a point", () => {
  // Every tile of the box has a window, listed or not: a point in a notch is read in a tile off the
  // list (a corner of Lunigiana's box is one, found from the list: its north-west and south-east today).
  const { i0, i1, j0, j1 } = tileRange(BOUNDS),
    box: Array<{ i: number; j: number }> = []
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) box.push({ i, j })
  const spans = new Map(gridTiles(lattice, box).map((t) => [t.key, t.span]))
  const tileOf = cellTile(lattice)
  const listed = new Set(REGION.tiles.map(({ i, j }) => `${i}_${j}`))
  const { x0, y0, cell, cols, rows } = lattice
  const x1 = x0 + (cols - 1) * cell,
    y1 = y0 + (rows - 1) * cell
  assert.ok(listed.has(tileOf(0, 0)))
  assert.ok(
    [x0, x1].some((x) => [y0, y1].some((y) => !listed.has(tileOf(x, y)))),
    "a corner of the box in a notch",
  )
  const xs = [x0 - 50, x0, x0 + 0.5, 0, -0.01, 2000, 1999.99, 2003.9, x1, 1e5],
    ys = [y0 - 50, y0, -2000, -2000.01, 0, 1996, 1999.9, y1, 1e5]
  for (const x of xs)
    for (const y of ys) {
      const span = spans.get(tileOf(x, y))!
      const i = Math.min(cols - 2, Math.max(0, Math.floor((x - x0) / cell))),
        j = Math.min(rows - 2, Math.max(0, Math.floor((y - y0) / cell)))
      assert.ok(i >= span.i0 && i + 1 < span.i0 + span.cols, `x ${x} in ${tileOf(x, y)}`)
      assert.ok(j >= span.j0 && j + 1 < span.j0 + span.rows, `y ${y} in ${tileOf(x, y)}`)
    }
})

test("gridTiles gives an L its listed tiles alone, and listedNodes every node they hold: none of its notch's", () => {
  assert.deepEqual(
    gridTiles(lLattice, L.tiles).map((t) => t.key),
    ["-2_0", "-1_0", "0_0", "1_0", "-2_1", "-1_1"],
  )
  const listed = listedNodes(lLattice, L.tiles)
  let notch = 0
  for (let gj = 0; gj < lLattice.rows; gj++)
    for (let gi = 0; gi < lLattice.cols; gi++) {
      const x = lLattice.x0 + gi * lLattice.cell,
        y = lLattice.y0 + gj * lLattice.cell
      // The notch's tiles hold x 0…4000 by y 2000…4000, but their west and south sides are the
      // listed tiles' borders too.
      assert.equal(listed[gj * lLattice.cols + gi], x > 0 && y > 2000 ? 0 : 1, `node at ${x}, ${y}`)
      if (x > 0 && y > 2000) notch++
    }
  // x 4…2400 by y 2004…3900
  assert.equal(notch, 600 * 475)
})

test("extendEdges gives each node no listed tile holds the listed node the game reads there, and leaves the rest", () => {
  const z = Float64Array.from({ length: lLattice.cols * lLattice.rows }, (_, k) => k)
  const listed = listedNodes(lLattice, L.tiles)
  extendEdges({ ...lLattice, z }, listed, L.tiles)
  for (let k = 0; k < z.length; k++) if (listed[k] === 1) assert.equal(z[k], k, `node ${k}`)
  const at = (x: number, y: number) => z[lNode(x, y)]
  // Beside the notch's west side, the leg's edge (tile -1_1); beside its south side, the foot's (0_0)
  assert.equal(at(4, 3000), lNode(0, 3000))
  assert.equal(at(1000, 2004), lNode(1000, 2000))
  // 100 m in from the west side and 1000 m up from the south side, the west side is nearer
  assert.equal(at(100, 3000), lNode(0, 3000))
  assert.equal(at(1000, 2100), lNode(1000, 2000))
  // By its corner, as near the two sides: the first tile in key order, 0_0 (`tilesRound`)
  assert.equal(at(4, 2004), lNode(4, 2000))
  // Its far corner, in tile 1_1, past the box's edge: tile 1_0's nearest node, on its last column
  assert.equal(at(2400, 3900), lNode(2400, 2000))
})
