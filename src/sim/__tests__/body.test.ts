import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { carCircles, carClear, clearSpot, standClear } from "../body.ts"
import { buildingsIn } from "../map/vectors.ts"
import { indoors } from "../population/farms.ts"
import { ON_BATTISTI } from "../testing.ts"

/** The middle of the largest house within 150 m of the Battisti lane, found by geometry, and the half-diagonal of its box (m). */
const INSIDE = (() => {
  let best = { x: 0, y: 0, area: 0, reach: 0 }
  buildingsIn(
    ON_BATTISTI.x - 150,
    ON_BATTISTI.y - 150,
    ON_BATTISTI.x + 150,
    ON_BATTISTI.y + 150,
    (_, b, [x0, y0, x1, y1]) => {
      if (b.ruins === true || (x1 - x0) * (y1 - y0) <= best.area) return
      const x = (x0 + x1) / 2,
        y = (y0 + y1) / 2
      if (indoors(x, y))
        best = { x, y, area: (x1 - x0) * (y1 - y0), reach: Ops.hypot(x1 - x0, y1 - y0) / 2 }
    },
  )
  assert.ok(best.area > 0, "a house by the Battisti lane")
  return best
})()

test("clearSpot: a spot already clear is kept, on foot and in a car", () => {
  assert.deepEqual(clearSpot(ON_BATTISTI, undefined), { x: ON_BATTISTI.x, y: ON_BATTISTI.y })
  assert.ok(carClear("panda", ON_BATTISTI), "the lane fits a Panda")
  assert.deepEqual(clearSpot(ON_BATTISTI, "panda"), { x: ON_BATTISTI.x, y: ON_BATTISTI.y })
})

test("clearSpot: inside a house, on foot, the player is put on the nearest spot out of it and clear of its walls", () => {
  assert.ok(indoors(INSIDE.x, INSIDE.y))
  const spot = clearSpot({ ...INSIDE, angle: 0 }, undefined)!
  assert.ok(spot !== undefined)
  assert.ok(!indoors(spot.x, spot.y), "out of the house")
  assert.ok(standClear(spot), "clear of its walls")
  // Just out of it: no farther than its box's corners and a body's width.
  assert.ok(Vec2.distance(spot, INSIDE) <= INSIDE.reach + 2)
})

test("clearSpot: inside a house, in a car, the whole car is put out of it and clear of every wall", () => {
  for (const angle of [0, Math.PI / 3, Math.PI / 2]) {
    const spot = clearSpot({ ...INSIDE, angle }, "panda")!
    assert.ok(spot !== undefined)
    const pose = { ...spot, angle }
    assert.ok(carClear("panda", pose), `clear of the walls at ${angle}`)
    for (const o of carCircles("panda", angle))
      assert.ok(!indoors(spot.x + o.x, spot.y + o.y), `out of the house at ${angle}`)
    assert.ok(Vec2.distance(spot, INSIDE) <= INSIDE.reach + 8)
  }
})
