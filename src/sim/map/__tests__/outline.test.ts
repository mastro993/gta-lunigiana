import assert from "node:assert/strict"
import { test } from "node:test"

import { edgeDistance, insideRings, ringsDistance } from "../outline.ts"

/** An L: a 200 by 100 m foot and a 100 by 200 m leg on its west half, the notch at its north-east. */
const L = [[0, 0, 200, 0, 200, 100, 100, 100, 100, 300, 0, 300]]

test("insideRings: margins round a reflex corner are discs, beside an edge bands; an edge is inside", () => {
  // 7.07 m from the notch's corner (100, 100), beside neither of its edges
  assert.ok(insideRings(L, 95, 95, 7) && !insideRings(L, 95, 95, 7.1))
  // 3 m under the notch's south side, 3 m west of its west side
  assert.ok(insideRings(L, 150, 97, 3) && !insideRings(L, 150, 97, 3.01))
  assert.ok(insideRings(L, 97, 150, 3) && !insideRings(L, 97, 150, 3.01))
  assert.ok(!insideRings(L, 105, 105) && !insideRings(L, 150, 100.001))
  for (const [x, y] of [
    [150, 100],
    [100, 250],
    [200, 50],
    [0, 300],
    [100, 100],
  ] as const)
    assert.ok(insideRings(L, x, y), `${x}, ${y} on the outline`)
  assert.equal(ringsDistance(L, 95, 95), Math.sqrt(50))
  assert.equal(ringsDistance(L, 150, 97), 3)
})

test("insideRings: a clockwise hole is out of the area, its edge in it", () => {
  const frame = [
    [0, 0, 300, 0, 300, 300, 0, 300],
    [100, 100, 100, 200, 200, 200, 200, 100],
  ]
  assert.ok(insideRings(frame, 50, 150) && !insideRings(frame, 150, 150))
  assert.ok(insideRings(frame, 100, 150) && !insideRings(frame, 98, 150, 3))
  assert.equal(ringsDistance(frame, 150, 160), 40)
})

test("edgeDistance: beside a vertical or horizontal edge a plain difference, past its end the end's distance", () => {
  assert.equal(edgeDistance(97.3, 150, 100, 0, 100, 300), Math.abs(97.3 - 100))
  assert.equal(edgeDistance(50, -0.1, 0, 0, 200, 0), 0.1)
  assert.equal(edgeDistance(103, 304, 100, 0, 100, 300), 5)
  // a slanted edge: the foot of (300, 0) on (0, 0)–(300, 400) is (108, 144)
  assert.ok(Math.abs(edgeDistance(300, 0, 0, 0, 300, 400) - 240) < 1e-9)
  assert.equal(edgeDistance(400, -300, 0, 0, 300, 400), 500)
})
