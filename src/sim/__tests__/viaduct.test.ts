import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Random } from "@typeonce/ritmo-math"

import { endNode, laneOf, lanePoint, laneSide, nextTrafficEdge } from "../route.ts"
import { trafficCar } from "../spawning.ts"
import { rolling, start } from "../testing.ts"
import { VEHICLES } from "../vehicles.ts"
import { BELOW, CENTRELINE } from "./viaduct.ts"

// The parapet tests (issue #91): the SR445's viaduct west of Gragnola over the residential road
// under it, at their crossing (`CENTRELINE`, viaduct.ts).

/** A pose on the viaduct's centreline over the road under it, facing its left (`side` 1) or its right (−1). */
const acrossDeck = (side: 1 | -1) => ({
  ...CENTRELINE.at,
  angle: Ops.atan2(side * CENTRELINE.across.y, side * CENTRELINE.across.x),
})

/** Where the player stands out of the way: on the viaduct, 30 m along it from the road under it. */
const ASIDE = {
  x: CENTRELINE.at.x + CENTRELINE.along.x * 30,
  y: CENTRELINE.at.y + CENTRELINE.along.y * 30,
  angle: 0,
}

/** How far `at` stands off the viaduct's centreline, m, to its left (positive) or its right. */
const offDeck = (at: { readonly x: number; readonly y: number }): number =>
  (at.x - CENTRELINE.at.x) * CENTRELINE.across.x + (at.y - CENTRELINE.at.y) * CENTRELINE.across.y

// Regression (issue #91): a deck's parapet opened wherever any road's carriageway reached it, the
// road under the bridge included, so a car on the SR445's viaduct west of Gragnola drove off it
// there and dropped 5–7 m onto the residential road under it. The parapet holds now, and stands at
// the deck's level alone: the road under it stays open.
test("parapets: a Panda driven across the SR445's viaduct over the road under it, either way, stays on the deck", () => {
  for (const side of [1, -1] as const) {
    const game = start(
      [],
      [ASIDE, { cars: [rolling("panda", acrossDeck(side), 8, 0.6, 0, CENTRELINE.deck)] }],
      { alone: true },
    )
    let widest = 0,
      lowest = Infinity
    game.run(180, () => {
      const car = game.world().vehicles[0]!
      widest = Math.max(widest, Math.abs(offDeck(car)))
      lowest = Math.min(lowest, car.chassis.z - VEHICLES.panda.cg)
    })
    assert.ok(
      widest < CENTRELINE.half + 0.25 && lowest > CENTRELINE.deck - 0.5,
      `driven to the ${side > 0 ? "left" : "right"}: ${widest.toFixed(2)} m off the centreline (the parapet at ${CENTRELINE.half + 0.25} m), its wheels down to ${lowest.toFixed(2)} m (the deck at ${CENTRELINE.deck.toFixed(2)} m)`,
    )
  }
})

test("parapets: a traffic car on the residential road under the SR445's viaduct passes under it", () => {
  const forward = true,
    lane = laneOf(BELOW, forward),
    side = laneSide({ edge: BELOW, forward }, "panda")
  const pose = { ...lanePoint(lane, 0, side), angle: Ops.atan2(lane.dy, lane.dx) }
  const next = nextTrafficEdge(endNode(BELOW, forward), BELOW, "panda", Random.make(1))
  const car = trafficCar("panda", 0x3d6155, pose, 5, { edge: BELOW, forward, side }, next)
  const game = start([], [ASIDE, { traffic: [car] }], { alone: true })
  const from = Math.sign(offDeck(pose))
  // Its wheels while under the deck.
  let highest = -Infinity
  game.run(360, () => {
    const it = game.world().vehicles[0]!
    if (Math.abs(offDeck(it)) < CENTRELINE.half)
      highest = Math.max(highest, it.chassis.z - VEHICLES.panda.cg)
  })
  const end = game.world().vehicles[0]!
  assert.ok(
    Math.sign(offDeck(end)) === -from && Math.abs(offDeck(end)) > CENTRELINE.half + 2,
    `the car ends ${offDeck(end).toFixed(1)} m off the viaduct's centreline, from ${offDeck(pose).toFixed(1)} m`,
  )
  assert.ok(
    highest < CENTRELINE.road + 0.5,
    `its wheels up to ${highest.toFixed(2)} m under a deck at ${CENTRELINE.deck.toFixed(2)} m (the road under it at ${CENTRELINE.road.toFixed(2)} m)`,
  )
})
