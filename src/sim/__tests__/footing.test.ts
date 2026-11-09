import assert from "node:assert/strict"
import { test } from "node:test"

import { carFooting, firstFooting, settleFooting } from "../footing.ts"
import { atGrade } from "../map/ground.ts"
import { ONE_LEVEL } from "../map/kinds.ts"
import { alongLane, laneOf, lanePoint } from "../route.ts"
import { BELOW, BENEATH, DECK_LANE, DECK_Z, OVER, ROAD_Z, standingOn } from "./viaduct.ts"

/** Whether `z` (m a.s.l.) is the deck's surface at OVER or the road's under it. */
const level = (z: number) =>
  Math.abs(z - DECK_Z) < 0.1 ? "deck" : Math.abs(z - ROAD_Z) < 0.1 ? "road" : z.toFixed(2)

/** The footings of a body walking `route`'s lane from `from` to `to` m along it (0.05 m steps, a walk's step), from its first footing there, and where it ends. */
const walked = (route: typeof DECK_LANE, from: number, to: number) => {
  const lane = laneOf(route.edge, route.forward)
  const at = (s: number) => lanePoint(lane, s, route.side)
  let end = at(from),
    z = firstFooting(end.x, end.y, route)
  const heights: Array<number> = []
  for (let s = from; s <= to; s += 0.05) {
    end = at(s)
    z = settleFooting(end.x, end.y, z)
    heights.push(z)
  }
  return { z, heights, end }
}

test("first footing under the SR445's viaduct: on its way's road, the deck on the deck's lane and the road on the road under it; with no way (an animal), at the terrain's level", () => {
  assert.equal(level(firstFooting(OVER.x, OVER.y, DECK_LANE)), "deck")
  assert.equal(
    level(firstFooting(BENEATH.x, BENEATH.y, { edge: BELOW, forward: true, side: 0 })),
    "road",
  )
  assert.equal(firstFooting(OVER.x, OVER.y), atGrade(OVER.x, OVER.y))
})

test("settled footing: walking the road under the viaduct stays on the road, walking its deck stays on the deck, and each is a fixed point where it ends", () => {
  const below = laneOf(BELOW, true),
    under = alongLane(below, BENEATH.x, BENEATH.y)
  const road = walked({ edge: BELOW, forward: true, side: 0 }, under - 20, under + 20)
  assert.ok(
    road.heights.every((z) => DECK_Z - z > ONE_LEVEL),
    "never up on the deck from the road under it",
  )
  assert.equal(settleFooting(road.end.x, road.end.y, road.z), road.z)
  const deck = laneOf(DECK_LANE.edge, DECK_LANE.forward),
    over = alongLane(deck, OVER.x, OVER.y)
  const top = walked(DECK_LANE, over - 10, over + 10)
  assert.ok(
    top.heights.every((z) => z - ROAD_Z > ONE_LEVEL),
    "never down on the road from the deck over it",
  )
  assert.equal(settleFooting(top.end.x, top.end.y, top.z), top.z)
})

test("driving footing: a Panda on the deck over the road and one on the road under it each stand the player on their own level", () => {
  assert.equal(level(carFooting(OVER, "panda", standingOn("panda", OVER, DECK_Z))), "deck")
  assert.equal(level(carFooting(OVER, "panda", standingOn("panda", OVER, ROAD_Z))), "road")
})
