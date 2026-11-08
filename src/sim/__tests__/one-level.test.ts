import assert from "node:assert/strict"
import { test } from "node:test"

import { ONE_LEVEL } from "../map/kinds.ts"
import { onOneLevel, type Pitched } from "../one-level.ts"
import { VEHICLES } from "../vehicles.ts"

/** A deck 6.07 m over flat ground at 100 m (the SR445's viaduct over the road under it), along x and 8 m wide; which of the two a point is on goes by the level nearest `near`, as `groundZ` does. */
const DECK = 106.07
const deckOver = (x: number, y: number, near: number) =>
  Math.abs(y) <= 4 && Math.abs(x) <= 60 && Math.abs(near - DECK) < Math.abs(near - 100) ? DECK : 100

/** A `model` heading east (+x) with its middle at (x, 0), its wheels' ground there `ground` rising `rise` a metre ahead. */
const east = (model: "panda" | "truck", x: number, ground: number, rise = 0): Pitched => ({
  x,
  y: 0,
  angle: 0,
  ground,
  rise,
  reach: VEHICLES[model].length / 2,
})

test("one level: two point levels are on one level within ONE_LEVEL of each other, and not at ONE_LEVEL", () => {
  assert.equal(onOneLevel(100, 100 + ONE_LEVEL - 0.01), true)
  assert.equal(onOneLevel(100 + ONE_LEVEL - 0.01, 100), true)
  assert.equal(onOneLevel(100, 100 + ONE_LEVEL), false)
  assert.equal(onOneLevel(100, 100 - ONE_LEVEL), false)
})

test("one level: two trucks bumper to bumper on a 30% lane meet where they touch, though the ground under their middles stands more than ONE_LEVEL apart", () => {
  const slope = (x: number) => 100 - 0.3 * x
  const { length } = VEHICLES.truck,
    upper = east("truck", 0, slope(0), -0.3),
    lower = east("truck", length + 0.1, slope(length + 0.1), -0.3)
  assert.ok(upper.ground - lower.ground > ONE_LEVEL, "their middles' ground apart")
  assert.equal(onOneLevel(upper.ground, lower.ground), false, "read under their middles")
  const at = { x: length / 2 + 0.05, y: 0 }
  assert.equal(onOneLevel(upper, lower, at, slope), true, "read where they touch")
})

test("one level: on a 40% lane a truck meets someone 1.8 m off either bumper on the ground there, along its pitch and on along its heading", () => {
  const lane = (x: number) => 100 + 0.4 * x
  const truck = east("truck", 0, lane(0), 0.4),
    off = truck.reach + 1.8
  for (const end of [1, -1]) {
    const at = { x: off * end, y: 0 }
    assert.ok(Math.abs(lane(at.x) - truck.ground) > ONE_LEVEL, "off its middle's ground")
    assert.equal(
      onOneLevel(truck, lane(at.x), at, lane),
      true,
      end > 0 ? "off its front" : "off its rear",
    )
  }
})

test("one level: a vehicle's level is never rolled sideways: one thrown into the air over an embankment's foot meets a train on the rail head beside its nose, and a car on a deck nobody on the ground beside it", () => {
  // A Panda in the air 2.5 m over flat ground at 100 m, a train's rail head 0.2 m over its wheels, touching it at its nose's side.
  const flat = () => 100
  const thrown = east("panda", 0, 102.5),
    nose = { x: thrown.reach - 0.2, y: 0.9 }
  assert.equal(onOneLevel(thrown, 102.7, nose, flat), true, "the train at its nose")
  // Someone on the ground 3 m off the deck's side, abeam the car on it: past the deck's edge the ground is 6.07 m under it.
  const on = east("panda", 0, DECK)
  assert.equal(
    onOneLevel(on, 100, { x: 0, y: 7 }, deckOver),
    false,
    "beside the deck, on the ground",
  )
})

test("one level: a Panda on a deck meets someone standing on the deck beside it and not someone on the ground under it; under the deck, the other way round", () => {
  const on = east("panda", 0, DECK),
    under = east("panda", 0, 100),
    beside = { x: 1.5, y: 1.2 }
  assert.equal(onOneLevel(on, DECK, beside, deckOver), true, "on the deck, someone on it")
  assert.equal(onOneLevel(on, 100, beside, deckOver), false, "on the deck, someone under it")
  assert.equal(onOneLevel(under, DECK, beside, deckOver), false, "under the deck, someone on it")
  assert.equal(onOneLevel(under, 100, beside, deckOver), true, "under the deck, someone under it")
})

test("one level: past a Panda's end its level follows the ground through a sag, where carried along its pitch it loses it", () => {
  // 15% down into a dip at x = 0 and 15% up out of it, as the SR445's east of the viaduct; the Panda coming down 5 m short of it.
  const dip = (x: number) => 100 + 0.15 * Math.abs(x)
  const car = east("panda", -5, dip(-5), -0.15),
    at = { x: 10, y: 0 }
  const end = -5 + car.reach
  assert.ok(Math.abs(dip(end) - 0.15 * (10 - end) - dip(10)) > ONE_LEVEL, "carried along its pitch")
  assert.equal(onOneLevel(car, dip(10), at, dip), true, "rolled through the sag")
})

test("one level: over a crest into a tunnel a Panda's level keeps to the road into it, not the hill over it", () => {
  // A road climbing 10% to x = 0, then level into a tunnel whose floor stays at 100 m while the hill over it rises 10% on.
  const hill = (x: number) => 100 + 0.1 * x,
    crest = (x: number, _y: number, near: number) =>
      x < 0 || Math.abs(near - hill(x)) < Math.abs(near - 100) ? hill(x) : 100
  const car = east("panda", -3, crest(-3, 0, 0), 0.1),
    at = { x: 25, y: 0 }
  assert.equal(onOneLevel(car, 100, at, crest), true, "someone in the tunnel")
  assert.equal(onOneLevel(car, hill(25), at, crest), false, "someone on the hill over it")
})
