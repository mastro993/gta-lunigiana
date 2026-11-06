import assert from "node:assert/strict"
import { test } from "node:test"

import { Vec2 } from "@typeonce/ritmo-math"

import type { PoseValue } from "../index.ts"
import { footZ } from "../map/ground.ts"
import { parkedCar, trafficCar } from "../spawning.ts"
import { door, press, type stage, start } from "../testing.ts"
import { ENTER_GAP } from "../tuning.ts"
import { VEHICLES } from "../vehicles.ts"
import {
  DECK_LANE,
  DECK_Z,
  footing,
  OVER,
  PlayerFooting,
  ROAD_Z,
  standingOn,
  underLane,
} from "./viaduct.ts"

/** The player at `at` with their `Footing` on `z`, the action key pressed on frame 5, and `cast` round them; nobody else comes. */
const staged = (at: PoseValue, z: number, cast: Parameters<typeof stage>[1]) => {
  const game = start(press(5, "action"), [at, cast], { alone: true })
  assert.ok(game.runtime.tick(footing(z)).ok)
  return game
}

// Regression (#84): standing under a bridge, the player stole a traffic car on the deck right over them.
test("enter: under the SR445's viaduct the player cannot take a car on the deck over them, and the HUD offers none", () => {
  const car = trafficCar("panda", 0xd4a85e, OVER, 0, DECK_LANE, { ...DECK_LANE, forward: false })
  const { run, runtime, view, world } = staged({ ...OVER, angle: 0 }, ROAD_Z, { traffic: [car] })
  const wheels = world().vehicles[0]!.chassis.z - VEHICLES.panda.cg
  assert.ok(Math.abs(wheels - DECK_Z) < 0.1, `the car on the deck, its wheels at ${wheels}`)
  assert.equal(view()?.nearby, undefined)
  run(10)
  assert.ok(Math.abs(runtime.inspect(PlayerFooting)! - ROAD_Z) < 0.1, "still on the road below")
  assert.equal(view()?.mode, "foot")
  assert.deepEqual(
    world().vehicles.map((v) => [v.traffic, v.stolen]),
    [[true, false]],
  )
  assert.equal(world().score.stolen, 0)
})

test("enter: on the viaduct's deck the player cannot take a car on the road under them, and takes one beside them on the deck", () => {
  const below = underLane(OVER)
  assert.ok(Vec2.distance(below, OVER) < ENTER_GAP, "the car below within reach in plan")
  const under = staged(OVER, DECK_Z, {
    cars: [parkedCar("panda", 0xb8312b, below, standingOn("panda", below, ROAD_Z))],
  })
  assert.equal(under.view()?.nearby, undefined)
  under.run(10)
  assert.equal(under.view()?.mode, "foot")
  assert.equal(under.world().score.stolen, 0)

  const beside = door(OVER),
    on = staged(beside, footZ(beside.x, beside.y, DECK_Z), {
      cars: [parkedCar("panda", 0xb8312b, OVER, standingOn("panda", OVER, DECK_Z))],
    })
  assert.deepEqual(on.view()?.nearby, { label: "Fiat Panda", occupied: false, stolen: false })
  on.run(10)
  assert.equal(on.view()?.mode, "driving")
  assert.equal(on.world().score.stolen, 1)
})
