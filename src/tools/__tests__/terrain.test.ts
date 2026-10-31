import assert from "node:assert/strict"
import { test } from "node:test"

import { gridLattice, sampleGrid, type Grid } from "../terrain.ts"
import { first, grown, points } from "./grounds.ts"

test("sampleGrid reads the same height on two grids round one anchor where they share nodes", () => {
  /** The whole grid over `ground`, each node's height worked out from its position alone. */
  const whole = (ground: typeof first): Grid => {
    const g = gridLattice(ground)
    const z = Float64Array.from({ length: g.cols * g.rows }, (_, k) => {
      const x = g.x0 + (k % g.cols) * g.cell,
        y = g.y0 + Math.floor(k / g.cols) * g.cell
      return 300 + 0.37 * x - 0.11 * y + ((x * 7919 + y * 104729) % 97) / 10
    })
    return { ...g, z }
  }
  const a = whole(first),
    b = whole(grown)
  for (const [x, y] of points(2000))
    if (!Object.is(sampleGrid(a, x, y), sampleGrid(b, x, y)))
      assert.fail(`(${x}, ${y}): ${sampleGrid(a, x, y)} != ${sampleGrid(b, x, y)}`)
})
