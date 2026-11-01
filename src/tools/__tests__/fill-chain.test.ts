import assert from "node:assert/strict"
import { test } from "node:test"

import { fillStep, NONE } from "../fill-chain.ts"
import { holed, plane, tenMetre } from "./fill-cases.ts"
import { largestStep } from "./seam-steps.ts"

test("a filler bent into a 100 m hole in a tilted LiDAR meets it with no step over 0.1 m", () => {
  const m = holed(300, 100)
  const report = fillStep(m, tenMetre())
  assert.equal(report.cells, 100 * 100)
  assert.ok(m.src.every((s) => s === 0 || s === 1))
  // The rim's residual is minus the filler's error there, 25 to 27.4 m.
  assert.ok(report.residual[0] >= -275 && report.residual[1] <= -250, `${report.residual}`)
  const { step, seams } = largestStep(m.cols, m.rows, m.dm, m.src)
  assert.equal(seams, 4 * 100)
  assert.ok(step <= 1, `step ${step / 10} m`)
  // The bend leaves the plane's tilt across the hole: its middle within 0.5 m of the plane.
  assert.ok(Math.abs(m.dm[150 * 300 + 150]! - plane(150, 150)) < 5)
})

test("the band carries the LiDAR's relief below the lattice's 50 m into the fill: no step", () => {
  // A 20 m ripple of ±0.5 m on the LiDAR, which the lattice cannot fit; the filler is the plane.
  const ripple = (c: number, r: number) => plane(c, r) + 5 * Math.sin((2 * Math.PI * c) / 20)
  const m = holed(400, 200, ripple)
  const report = fillStep(m, { source: 1, at: plane })
  assert.ok(report.leftover > 3, `leftover ${report.leftover}`)
  assert.ok(report.band > 0 && report.band < 200 * 200)
  const { step } = largestStep(m.cols, m.rows, m.dm, m.src)
  assert.ok(step <= 1, `step ${step / 10} m`)
  // Past the band, the fill is the filler with the lattice's bend: the plane, give or take what
  // the lattice made of the ripple.
  const middle = 200 * 400 + 200
  assert.ok(Math.abs(m.dm[middle]! - plane(200, 200)) < 1)
})

test("a filler fills only the cells it may and has data for, leaving the rest empty", () => {
  const m = holed(200, 100)
  // Data only west of column 100; allowed only south of row 100.
  const report = fillStep(m, {
    source: 3,
    at: (c, r) => (c < 100 ? plane(c, r) : Number.NaN),
    where: (k) => Math.floor(k / 200) < 100,
  })
  assert.equal(report.cells, 50 * 50)
  for (let r = 50; r < 150; r++)
    for (let c = 50; c < 150; c++) {
      const k = r * 200 + c,
        filled = c < 100 && r < 100
      assert.equal(m.src[k], filled ? 3 : NONE)
      assert.equal(Number.isNaN(m.dm[k]!), !filled)
    }
})

test("a second filler bends onto the LiDAR and the first filler both", () => {
  const m = holed(300, 120)
  // The first fills a 60 m disc touching the hole's west edge, 5 m off the plane.
  fillStep(m, {
    source: 1,
    at: (c, r) => plane(c, r) + 50,
    where: (k) => ((k % 300) - 120) ** 2 + (Math.floor(k / 300) - 150) ** 2 < 30 ** 2,
  })
  const second = fillStep(m, tenMetre(2))
  assert.ok(second.cells > 0)
  assert.ok(m.src.every((s) => s === 0 || s === 1 || s === 2))
  const { step } = largestStep(m.cols, m.rows, m.dm, m.src)
  assert.ok(step <= 1, `step ${step / 10} m`)
})

test("a filler with no rim is not bent", () => {
  // A crop with no LiDAR at all.
  const m = holed(120, 120)
  const report = fillStep(m, tenMetre())
  assert.equal(report.rim, 0)
  assert.deepEqual(report.residual, [0, 0])
  assert.ok(Math.abs(m.dm[60 * 120 + 60]! - tenMetre().at(60, 60)) < 1e-3)
})
