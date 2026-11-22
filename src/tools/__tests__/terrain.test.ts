import assert from "node:assert/strict"
import { test } from "node:test"

import { decimetre, gridLattice, sampleGrid, type Grid } from "../terrain.ts"
import { first, grown, points } from "./grounds.ts"

test("decimetre rounds a height to whole decimetres, from -3276.8 m to 3276.7 m", () => {
  assert.deepEqual(
    [0, 12.34, 12.36, -3276.8, 3276.7, -0.04].map((z) => decimetre(z, 0, 0)),
    [0, 123, 124, -32768, 32767, -0],
  )
})

test("decimetre throws for a height that does not fit int16, rather than wrapping it", () => {
  for (const bad of [4000, -4000, 3276.75, Number.NaN, Infinity])
    assert.throws(() => decimetre(bad, 1, 1), /heightmap: .* at node \(1, 1\) does not fit int16/)
})

test("sampleGrid reads a grid in decimetres as it reads the metres they were rounded from, bit for bit", () => {
  const g = gridLattice(first)
  const z = Float64Array.from(
    { length: g.cols * g.rows },
    (_, k) =>
      Math.round(10 * (300 + 0.37 * (k % g.cols) - 0.11 * Math.floor(k / g.cols)) + (k % 7)) / 10,
  )
  const metres = { ...g, z },
    dm = { ...g, dm: Int16Array.from(z, (h, k) => decimetre(h, k % g.cols, 0)) }
  for (const [x, y] of points(2000))
    if (!Object.is(sampleGrid(metres, x, y), sampleGrid(dm, x, y)))
      assert.fail(`(${x}, ${y}): ${sampleGrid(metres, x, y)} != ${sampleGrid(dm, x, y)}`)
})

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
