// The tile pass's first carving (build-grid.ts): a river line carves no breakwater raised over the
// water it runs out into.
import assert from "node:assert/strict"
import { test } from "node:test"

import { firstCarving } from "../build-grid.ts"
import type { WaterF } from "../features.ts"
import { ringBox } from "../geometry.ts"
import { gridLattice, makeGrid, type Span } from "../terrain.ts"
import { waterProfiles } from "../water.ts"

/** The lattice's 26 × 26 nodes (4 m apart) from its node at x = 0, y = 0, on ground at 0.5 m. */
const lattice = gridLattice(),
  COLS = 26,
  SPAN: Span = {
    i0: -lattice.x0 / lattice.cell,
    j0: -lattice.y0 / lattice.cell,
    cols: COLS,
    rows: COLS,
  }
const ground = () => 0.5
/** A river along y = 50 from x 0 to 100, through a jetty from x 41 to 59 either side of it. */
const RIVER: WaterF = {
  id: 1,
  kind: "river",
  w: 4,
  bed: 3,
  depth: 2.5,
  pts: [
    { x: 0, y: 50 },
    { x: 100, y: 50 },
  ],
  from: 0,
}
const JETTY = [41, 41, 59, 41, 59, 59, 41, 59]

test("the first carving raises a breakwater over the water and carves a river line through none of its nodes", () => {
  const win = makeGrid(ground, SPAN)
  const rock = firstCarving(
    win,
    [],
    [{ rings: [JETTY], box: ringBox(JETTY), top: 1.5 }],
    [RIVER],
    waterProfiles([RIVER], ground),
  )
  let raised = 0,
    carved = 0
  win.z.forEach((z, k) => {
    const x = 4 * (k % COLS),
      y = 4 * Math.floor(k / COLS)
    if (rock[k] === 1) {
      assert.equal(z, 1.5, `(${x}, ${y}) on the jetty`)
      raised++
    } else if (y === 48 || y === 52) {
      assert.ok(z < 0, `(${x}, ${y}) in the river's bed`)
      carved++
    }
  })
  // The jetty's cells touch the nodes from x 40 to 60 and y 40 to 60; the river's bed the rest of its rows.
  assert.equal(raised, 6 * 6)
  assert.equal(carved, 2 * (COLS - 6))
})
