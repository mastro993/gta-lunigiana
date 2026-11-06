/**
 * The bridge-level tests' spot: the SR445's viaduct west of Gragnola (OSM way 552592654) over the
 * residential road under it (OSM way 140780578), both found by their OSM ids and the deck's lane by
 * geometry, so the fixtures survive a map rebuild; and a setter for the player's `Footing`, which
 * `stage` and `teleport` keep from where the player was.
 *
 * @module sim/__tests__/viaduct
 */
import assert from "node:assert/strict"

import { Ops } from "@typeonce/ritmo-math"

import { Footing, Game, Player, Pose, type PoseValue, type RouteValue } from "../index.ts"
import { groundZ, roadLevel } from "../map/ground.ts"
import { graph, MAP } from "../map/index.ts"
import { LEVEL } from "../rail/bodies.ts"
import { alongLane, edgeIndex, laneOf, lanePoint, laneSide } from "../route.ts"
import { rollingChassis } from "../spawning.ts"
import type { VehicleModel } from "../vehicles.ts"

/** The index into `MAP.roads` of the road whose OSM way is `id`. */
const roadById = (id: number): number => {
  const road = MAP.roads.findIndex((r) => r.id === id)
  assert.ok(road >= 0, `OSM way ${id} on the map`)
  return road
}

/** The viaduct (a primary road's bridge) and the residential road under it, indices into `MAP.roads`. */
export const VIADUCT = roadById(552592654),
  UNDER = roadById(140780578)

/** About where the road under it passes under the deck's westbound lane. */
const SPOT = { x: -2674.3, y: 4584.0 }
const edge = edgeIndex(graph.trafficEdges.filter((e) => graph.edges[e]!.road === VIADUCT)).nearest(
  SPOT.x,
  SPOT.y,
)
const lane = laneOf(edge, true)

/** The deck's lane over the road below: the viaduct's traffic edge nearest SPOT, travelled a -> b, at a Panda's side. */
export const DECK_LANE: RouteValue = {
  edge,
  forward: true,
  side: laneSide({ edge, forward: true }, "panda"),
}

/** The point of that lane nearest SPOT, heading along it: right over the road below, at (−2673.3, 4587.9). */
export const OVER: PoseValue = {
  ...lanePoint(lane, alongLane(lane, SPOT.x, SPOT.y), DECK_LANE.side),
  angle: Ops.atan2(lane.dy, lane.dx),
}

/** The deck's surface at OVER and the road's under it, m a.s.l. (148.49 and 142.41). */
const road = roadLevel(UNDER, OVER.x, OVER.y)
assert.ok(road !== undefined, "the road under the deck passes under OVER")
export const DECK_Z = roadLevel(VIADUCT, OVER.x, OVER.y)!,
  ROAD_Z = groundZ(OVER.x, OVER.y, road)
assert.ok(DECK_Z - ROAD_Z > 3 * LEVEL, `the deck ${(DECK_Z - ROAD_Z).toFixed(2)} m over the road`)

/** The road under the deck's lane nearest `at` (its traffic edge nearest it, travelled a -> b), at a Panda's side: that lane's point nearest `at`, heading along it. */
export const underLane = (at: { readonly x: number; readonly y: number }): PoseValue => {
  const below = edgeIndex(graph.trafficEdges.filter((e) => graph.edges[e]!.road === UNDER)).nearest(
      at.x,
      at.y,
    ),
    l = laneOf(below, true)
  return {
    ...lanePoint(l, alongLane(l, at.x, at.y), laneSide({ edge: below, forward: true }, "panda")),
    angle: Ops.atan2(l.dy, l.dx),
  }
}

/** A standing `model`'s chassis at `pose` on the level nearest `level` (m a.s.l.): the deck's or the road's under it. */
export const standingOn = (model: VehicleModel, pose: PoseValue, level: number) =>
  rollingChassis(model, pose, 0, level)

/** Sets the player's `Footing` to `z`, m a.s.l. (`runtime.tick` it after `start`). */
export const footing = (z: number) =>
  Game.Schedule(
    Game.System(
      "Test/Footing",
      {
        queries: {
          player: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Player] }),
        },
        commands: Game.System.commands(Game.System.inserts(Footing)),
      },
      ({ queries, commands }) => {
        for (const { entity } of queries.player.each()) commands.insert(entity, [Footing, { z }])
      },
    ),
    Game.Schedule.applyDeferred(),
  )

/** The player's `Footing`, m a.s.l. (undefined with none yet). */
export const PlayerFooting = Game.Inspector(
  "Test/PlayerFooting",
  {
    queries: {
      player: Game.Query({ selection: { footing: Game.Query.optional(Footing) }, with: [Player] }),
    },
  },
  ({ queries }) => queries.player.each()[0]?.data.footing.value()?.z,
)
