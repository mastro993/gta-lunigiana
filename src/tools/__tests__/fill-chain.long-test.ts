import assert from "node:assert/strict"
import { test } from "node:test"

import { type Mosaic, fillStep } from "../fill-chain.ts"
import { holed, tenMetre } from "./fill-cases.ts"
import { largestStep } from "./seam-steps.ts"

/** Seconds to fill a `hole` m square hole in a crop 200 m wider, the fastest of `runs`. */
const timed = (hole: number, runs: number) => {
  let best = Infinity,
    m: Mosaic | undefined
  for (let i = 0; i < runs; i++) {
    m = holed(hole + 200, hole)
    const t0 = performance.now()
    fillStep(m, tenMetre())
    best = Math.min(best, (performance.now() - t0) / 1000)
  }
  return { m: m!, seconds: best, cells: (hole + 200) ** 2 }
}

test("a 5 km hole fills with no step over 0.1 m, in time linear in its cells", () => {
  const small = timed(100, 5),
    large = timed(5000, 1)
  const { step } = largestStep(large.m.cols, large.m.rows, large.m.dm, large.m.src)
  assert.ok(step <= 1, `step ${step / 10} m`)
  // 2 500 times the hole's cells, 300 times the crop's, in at most 3 times the time a cell; the
  // inverse squared distance fill before took a time a cell that grew with the rim (20 000 cells
  // round the 5 km hole, 400 round the 100 m one).
  const perCell = (r: typeof small) => r.seconds / r.cells
  assert.ok(
    perCell(large) < 3 * perCell(small),
    `${(perCell(large) * 1e9).toFixed(0)} ns a cell against ${(perCell(small) * 1e9).toFixed(0)}`,
  )
})
