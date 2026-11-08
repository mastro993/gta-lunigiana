import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Vec2 } from "@typeonce/ritmo-math"

import {
  carCircles,
  carClear,
  clearSpot,
  crossesAny,
  standClear,
  vehicleInReach,
  wallsAlong,
} from "../body.ts"
import { settle } from "../chassis.ts"
import { atGrade } from "../map/ground.ts"
import { ONE_LEVEL } from "../map/kinds.ts"
import { buildingsIn } from "../map/vectors.ts"
import { wallsNear } from "../map/walls.ts"
import { indoors } from "../population/farms.ts"
import type { PoseValue } from "../schema.ts"
import { door, ON_BATTISTI } from "../testing.ts"
import { VEHICLES, type VehicleModel } from "../vehicles.ts"
import { OVER } from "./viaduct.ts"

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
  assert.ok(
    carClear("panda", ON_BATTISTI, atGrade(ON_BATTISTI.x, ON_BATTISTI.y)),
    "the lane fits a Panda",
  )
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
    assert.ok(carClear("panda", pose, atGrade(pose.x, pose.y)), `clear of the walls at ${angle}`)
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

test("vehicleInReach: a car within ENTER_GAP is in reach only from ground on its wheels' level (within 2 m, ONE_LEVEL): not from a road under its deck, nor from a deck over it", () => {
  const car = onGrade("panda", ON_BATTISTI),
    at = door(ON_BATTISTI)
  const reach = (ground: number) => vehicleInReach(at, ground, [car], (c) => c)
  assert.equal(reach(100), car, "beside it")
  assert.equal(reach(100 + ONE_LEVEL - 0.05), car, "a step up")
  assert.equal(reach(100 - ONE_LEVEL + 0.05), car, "a step down")
  // The SR445's viaduct by Gragnola stands 6.07 m over the road under it.
  assert.equal(reach(100 - 6.07), undefined, "from the road under its deck")
  assert.equal(reach(100 + 6.07), undefined, "from a deck over it")
})

// Merge of #98 and #99: getting in reads only the walk walls the person meets on their own level (`meets`), so a wall round the
// low space under a deck does not keep someone on the deck from a car beside them there.
test("vehicleInReach: a walk wall on another level between the person and a car on theirs keeps them out only on its own level", () => {
  const w = VEHICLES.panda.width / 2
  /** Across `wall`, a Panda parallel to it 0.6 m off one side and the person 0.3 m off the other, both on ground at `z`. */
  const across = (wall: { ax: number; ay: number; bx: number; by: number }, z: number) => {
    const length = Ops.hypot(wall.bx - wall.ax, wall.by - wall.ay),
      nx = -(wall.by - wall.ay) / length,
      ny = (wall.bx - wall.ax) / length,
      mx = (wall.ax + wall.bx) / 2,
      my = (wall.ay + wall.by) / 2,
      pose = {
        x: mx + nx * (w + 0.6),
        y: my + ny * (w + 0.6),
        angle: Ops.atan2(wall.by - wall.ay, wall.bx - wall.ax),
      }
    return {
      at: { x: mx - nx * 0.3, y: my - ny * 0.3 },
      axis: { x: pose.x, y: pose.y },
      car: { model: "panda" as const, pose, chassis: settle("panda", pose, () => z), damage: 0 },
    }
  }
  // The walls round the low space under the SR445's viaduct by Gragnola carry their ground's level; the first, found by geometry,
  // with nothing else on the deck's level or on its own between the two.
  const blocked = (z: number, p: ReturnType<typeof across>) =>
    crossesAny(
      wallsAlong("walk", p.at.x, p.at.y, p.axis.x - p.at.x, p.axis.y - p.at.y, 0.5, z),
      p.at,
      p.axis,
    )
  const wall = wallsNear("walk", OVER.x - 150, OVER.y - 150, OVER.x + 150, OVER.y + 150)
    .filter((s) => s.level !== undefined && Ops.hypot(s.bx - s.ax, s.by - s.ay) > 1)
    .map((s) => ({ ax: s.ax, ay: s.ay, bx: s.bx, by: s.by, level: s.level! }))
    .find(
      (s) =>
        !blocked(s.level + ONE_LEVEL + 1, across(s, s.level + ONE_LEVEL + 1)) &&
        blocked(s.level, across(s, s.level)),
    )
  assert.ok(wall !== undefined, "a wall with a level under the viaduct")
  const deck = wall.level + ONE_LEVEL + 1,
    over = across(wall, deck)
  assert.equal(
    vehicleInReach(over.at, deck, [over.car], (c) => c),
    over.car,
    "on a level over the wall, it stands between them in plan only",
  )
  const own = across(wall, wall.level)
  assert.equal(
    vehicleInReach(own.at, wall.level, [own.car], (c) => c),
    undefined,
    "on the wall's own level, it keeps them out",
  )
})
