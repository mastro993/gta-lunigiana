import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { carCircles, carClear, clearSpot, standClear, vehicleInReach } from "../body.ts"
import { settle } from "../chassis.ts"
import { buildingsIn } from "../map/vectors.ts"
import { indoors } from "../population/farms.ts"
import { LEVEL } from "../rail/bodies.ts"
import type { PoseValue } from "../schema.ts"
import { door, ON_BATTISTI } from "../testing.ts"
import { VEHICLES, type VehicleModel } from "../vehicles.ts"

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

/** A `model` standing at `pose` on ground at 100 m a.s.l. under its middle, rising `grade` m a metre along its heading. */
const onGrade = (model: VehicleModel, pose: PoseValue, grade = 0) => {
  const fx = Ops.cos(pose.angle),
    fy = Ops.sin(pose.angle)
  const ground = (x: number, y: number) => 100 + grade * ((x - pose.x) * fx + (y - pose.y) * fy)
  return { model, pose, chassis: settle(model, pose, ground), damage: 0 }
}

test("vehicleInReach: a car within ENTER_GAP is in reach only from ground on its wheels' level (within 2 m, LEVEL): not from a road under its deck, nor from a deck over it", () => {
  const car = onGrade("panda", ON_BATTISTI),
    at = door(ON_BATTISTI)
  const reach = (ground: number) => vehicleInReach(at, ground, [car], (c) => c)
  assert.equal(reach(100), car, "beside it")
  assert.equal(reach(100 + LEVEL - 0.05), car, "a step up")
  assert.equal(reach(100 - LEVEL + 0.05), car, "a step down")
  // The SR445's viaduct by Gragnola stands 6.07 m over the road under it.
  assert.equal(reach(100 - 6.07), undefined, "from the road under its deck")
  assert.equal(reach(100 + 6.07), undefined, "from a deck over it")
})

test("vehicleInReach: on a 40% lane the truck is in reach from the ground 1.8 m off either bumper, on its wheels' level under the end of its axis", () => {
  const truck = onGrade("truck", ON_BATTISTI, 0.4),
    off = VEHICLES.truck.length / 2 + 1.8,
    middle = truck.chassis.z - VEHICLES.truck.cg
  for (const end of [1, -1]) {
    const at = {
        x: ON_BATTISTI.x + Ops.cos(ON_BATTISTI.angle) * off * end,
        y: ON_BATTISTI.y + Ops.sin(ON_BATTISTI.angle) * off * end,
      },
      ground = 100 + 0.4 * off * end
    assert.ok(
      Math.abs(ground - middle) > LEVEL,
      `${(ground - middle).toFixed(2)} m off its middle's`,
    )
    assert.equal(
      vehicleInReach(at, ground, [truck], (t) => t),
      truck,
      `off its ${end > 0 ? "front" : "rear"}`,
    )
  }
})
