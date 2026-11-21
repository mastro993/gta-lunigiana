import assert from "node:assert/strict"
import { test } from "node:test"

import { fieldsOf, offSegment, RES, segmentsOf, valueAt } from "../deck-space.ts"
import { segIndex } from "../geometry.ts"

test("fieldsOf holds a value at every lattice node within reach of a long diagonal deck and at no other, its rows cut to the deck's band", () => {
  // A deck 300 m long, 35° off the x axis, its walls 4 m off its line: its box is 246 × 172 m.
  const line = { pts: [10, 20, 10 + 300 * 0.819, 20 + 300 * 0.574], z: [30, 36] }
  const deck = { road: 0, segs: segmentsOf(line, 0.9) },
    side = 4,
    reach = side + 2 * RES
  const { low, onLevel } = fieldsOf([0], [deck], [side], 2.65, [segIndex()], () => 25)
  const s = deck.segs[0]!
  let within = 0
  for (let j = Math.floor(10 / RES); j <= Math.ceil(200 / RES); j++)
    for (let i = 0; i <= Math.ceil(270 / RES); i++) {
      const near = offSegment(s, i * RES, j * RES).d <= reach
      if (near) within++
      for (const field of [low, onLevel])
        assert.equal(valueAt(field, i, j) !== undefined, near, `node (${i}, ${j})`)
    }
  // The band holds the nodes within reach and some to spare (64,355 for 44,214), not the box's
  // 677,000.
  assert.ok(within > 40_000, `${within} nodes within reach`)
  assert.ok(low.values.length < 1.5 * within, `${low.values.length} slots for ${within} nodes`)
})

test("valueAt gives a field's value at a node it holds, and none past its rows or columns or where it holds NaN", () => {
  const field = {
    j0: 5,
    lo: Int32Array.from([2, 3]),
    start: Int32Array.from([0, 3, 5]),
    values: Float64Array.from([0.5, Number.NaN, -1, 2, 3]),
  }
  assert.equal(valueAt(field, 2, 5), 0.5)
  assert.equal(valueAt(field, 4, 5), -1)
  assert.equal(valueAt(field, 3, 5), undefined, "NaN: none")
  assert.equal(valueAt(field, 4, 6), 3)
  for (const [i, j] of [
    [1, 5],
    [5, 5],
    [2, 6],
    [5, 6],
    [3, 4],
    [3, 7],
  ] as const)
    assert.equal(valueAt(field, i, j), undefined, `(${i}, ${j})`)
})
