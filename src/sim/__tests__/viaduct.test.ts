import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Random } from "@typeonce/ritmo-math"

import { segDist2 } from "../collide.ts"
import { roadLevel } from "../map/ground.ts"
import { graph, isDrivable, MAP, roadClassOf } from "../map/index.ts"
import { placeAt } from "../map/tiles.ts"
import { edgeIndex, endNode, laneOf, lanePoint, laneSide, nextTrafficEdge } from "../route.ts"
import { trafficCar } from "../spawning.ts"
import { rolling, start } from "../testing.ts"
import { VEHICLES } from "../vehicles.ts"

// The SR445's viaduct west of Gragnola (OSM 552592654) and the residential road under it (OSM
// 140780578), found by geometry, for the parapet tests (issue #91). They read tile −2_2 alone.

/** Where the issue drove a Panda off the deck, over the road under it. */
const AT = { x: -2674.3, y: 4584 }

/** The drivable bridge whose line passes nearest AT: its index and its segment there. */
const deckRoad = (() => {
  const { ids, items } = placeAt(AT.x, AT.y).vectors.roads
  let best: { road: number; d2: number; ax: number; ay: number; bx: number; by: number } | null =
    null
  for (const [k, road] of ids.entries()) {
    const info = MAP.roads[road]!
    if (info.bridge !== true || !isDrivable(roadClassOf(info))) continue
    const { pts } = items[k]!
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const [ax, ay, bx, by] = [pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!]
      const { d2 } = segDist2(AT.x, AT.y, ax, ay, bx, by)
      if (best === null || d2 < best.d2) best = { road, d2, ax, ay, bx, by }
    }
  }
  if (best === null) throw new Error("no bridge by the SR445's viaduct")
  return best
})()

/** The traffic edge nearest AT on a road at grade: the residential road under the viaduct. */
const underEdge = edgeIndex(
  graph.trafficEdges.filter((e) => MAP.roads[graph.edges[e]!.road]!.bridge !== true),
).nearest(AT.x, AT.y)

const { ax, ay, bx, by } = deckRoad,
  len = Ops.hypot(bx - ax, by - ay)
const under = graph.edges[underEdge]!,
  p = graph.nodes[under.a]!,
  q = graph.nodes[under.b]!
// Where the road under crosses the deck's centreline.
const t =
  ((ax - p.x) * (by - ay) - (ay - p.y) * (bx - ax)) /
  ((q.x - p.x) * (by - ay) - (q.y - p.y) * (bx - ax))
const cross = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }

/** The viaduct: its road's index, its half-width (m), its heading's unit vector and its left (`across`), and its surface over the road under it (m a.s.l.). */
const VIADUCT = {
  road: deckRoad.road,
  half: MAP.roads[deckRoad.road]!.w / 2,
  along: { x: (bx - ax) / len, y: (by - ay) / len },
  across: { x: -(by - ay) / len, y: (bx - ax) / len },
  level: roadLevel(deckRoad.road, cross.x, cross.y)!,
}

/** The road under the viaduct: its traffic edge there, and its surface where it passes under (m a.s.l.). */
const UNDER = {
  edge: underEdge,
  level: roadLevel(under.road, cross.x, cross.y)!,
}

/** Where the road under crosses the viaduct's centreline. */
const CROSSING = cross

/** A pose on the viaduct's centreline over the road under it, facing its left (`side` 1) or its right (−1). */
const acrossDeck = (side: 1 | -1) => ({
  ...CROSSING,
  angle: Ops.atan2(side * VIADUCT.across.y, side * VIADUCT.across.x),
})

/** Where the player stands out of the way: on the viaduct, 30 m along it from the road under it. */
const ASIDE = {
  x: CROSSING.x + VIADUCT.along.x * 30,
  y: CROSSING.y + VIADUCT.along.y * 30,
  angle: 0,
}

/** How far `at` stands off the viaduct's centreline, m, to its left (positive) or its right. */
const offDeck = (at: { readonly x: number; readonly y: number }): number =>
  (at.x - CROSSING.x) * VIADUCT.across.x + (at.y - CROSSING.y) * VIADUCT.across.y

// Regression (issue #91): a deck's parapet opened wherever any road's carriageway reached it, the
// road under the bridge included, so a car on the SR445's viaduct west of Gragnola drove off it
// there and dropped 5–7 m onto the residential road under it. The parapet holds now, and stands at
// the deck's level alone: the road under it stays open.
test("parapets: a Panda driven across the SR445's viaduct over the road under it, either way, stays on the deck", () => {
  for (const side of [1, -1] as const) {
    const game = start(
      [],
      [ASIDE, { cars: [rolling("panda", acrossDeck(side), 8, 0.6, 0, VIADUCT.level)] }],
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
      widest < VIADUCT.half + 0.25 && lowest > VIADUCT.level - 0.5,
      `driven to the ${side > 0 ? "left" : "right"}: ${widest.toFixed(2)} m off the centreline (the parapet at ${VIADUCT.half + 0.25} m), its wheels down to ${lowest.toFixed(2)} m (the deck at ${VIADUCT.level.toFixed(2)} m)`,
    )
  }
})

test("parapets: a traffic car on the residential road under the SR445's viaduct passes under it", () => {
  const forward = true,
    lane = laneOf(UNDER.edge, forward),
    side = laneSide({ edge: UNDER.edge, forward }, "panda")
  const pose = { ...lanePoint(lane, 0, side), angle: Ops.atan2(lane.dy, lane.dx) }
  const next = nextTrafficEdge(endNode(UNDER.edge, forward), UNDER.edge, "panda", Random.make(1))
  const car = trafficCar("panda", 0x3d6155, pose, 5, { edge: UNDER.edge, forward, side }, next)
  const game = start([], [ASIDE, { traffic: [car] }], { alone: true })
  const from = Math.sign(offDeck(pose))
  // Its wheels while under the deck.
  let highest = -Infinity
  game.run(360, () => {
    const it = game.world().vehicles[0]!
    if (Math.abs(offDeck(it)) < VIADUCT.half)
      highest = Math.max(highest, it.chassis.z - VEHICLES.panda.cg)
  })
  const end = game.world().vehicles[0]!
  assert.ok(
    Math.sign(offDeck(end)) === -from && Math.abs(offDeck(end)) > VIADUCT.half + 2,
    `the car ends ${offDeck(end).toFixed(1)} m off the viaduct's centreline, from ${offDeck(pose).toFixed(1)} m`,
  )
  assert.ok(
    highest < UNDER.level + 0.5,
    `its wheels up to ${highest.toFixed(2)} m under a deck at ${VIADUCT.level.toFixed(2)} m (the road under it at ${UNDER.level.toFixed(2)} m)`,
  )
})
