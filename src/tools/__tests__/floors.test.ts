import assert from "node:assert/strict"
import { test } from "node:test"

import { floorsOf } from "../floors.ts"

// Regression: a building's floor was read off the grid the paths' approaches carved: Cesena's
// station (185180766) sank 4.8 m into its plaza with the footways down to the underpass on its wall.
test("floorsOf reads each building's floor off the ground as it stood before the approaches, and leaves the grid as finished", () => {
  // Flat ground at 34.8 m, the node at x 4, y 0 carved to 29.1 m by an approach: a 3 × 2 grid, dm.
  const g = {
    cell: 4,
    cols: 3,
    rows: 2,
    x0: 0,
    y0: 0,
    ax: 0,
    ay: 0,
    dm: Int16Array.from([348, 291, 348, 348, 348, 348]),
  }
  const shed = { outer: [1, 1, 3, 1, 3, 3, 1, 3] },
    station = { outer: [3, 1, 7, 1, 7, 3, 3, 3] }
  assert.deepEqual(floorsOf(g, new Map([[1, 34.8]]), [shed, station]), [34.8, 34.8])
  assert.equal(g.dm[1], 291, "the grid keeps the approach's level")
  assert.ok(floorsOf(g, new Map(), [station])[0]! < 34, "on the carved grid it sinks")
})
