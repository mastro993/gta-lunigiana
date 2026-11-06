/**
 * The bridge-level tests' spot: the SR445's viaduct west of Gragnola (OSM way 552592654) over the
 * residential road under it (OSM way 140780578), both found by their OSM ids and the deck's lane by
 * geometry, so the fixtures survive a map rebuild; traffic coming along a run of lanes with no
 * junction; the player staged there with their `Footing` set on a level (`stage` and `teleport`
 * keep it from where the player was); a spot out of everyone's way; and an unmanned Panda rolling
 * along the deck over the road below.
 *
 * @module sim/__tests__/viaduct
 */
import assert from "node:assert/strict"

import { Ops } from "@typeonce/ritmo-math"

import { Footing, Game, Player, Pose, type PoseValue, type RouteValue } from "../index.ts"
import { atGrade, groundZ, roadLevel } from "../map/ground.ts"
import { graph, MAP } from "../map/index.ts"
import { LEVEL } from "../rail/bodies.ts"
import { alongLane, edgeIndex, laneOf, lanePoint, laneSide, type Step } from "../route.ts"
import { rollingChassis, trafficCar } from "../spawning.ts"
import { press, rolling, type stage, start, type Timeline } from "../testing.ts"
import type { VehicleModel } from "../vehicles.ts"

/** The index into `MAP.roads` of the road whose OSM way is `id`. */
export const roadById = (id: number): number => {
  const road = MAP.roads.findIndex((r) => r.id === id)
  assert.ok(road >= 0, `OSM way ${id} on the map`)
  return road
}

/** The viaduct (a primary road's bridge) and the residential road under it, indices into `MAP.roads`. */
const VIADUCT = roadById(552592654),
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

/** The road below's traffic edge nearest OVER, travelled a -> b (northward): it runs under the deck there. */
export const BELOW = edgeIndex(
  graph.trafficEdges.filter((e) => graph.edges[e]!.road === UNDER),
).nearest(OVER.x, OVER.y)

/** The point of its lane nearest OVER, at a Panda's side, heading along it: 0.64 m off OVER in plan. */
export const BENEATH: PoseValue = (() => {
  const l = laneOf(BELOW, true)
  return {
    ...lanePoint(
      l,
      alongLane(l, OVER.x, OVER.y),
      laneSide({ edge: BELOW, forward: true }, "panda"),
    ),
    angle: Ops.atan2(l.dy, l.dx),
  }
})()

const traffic = new Set(graph.trafficEdges)

/**
 * The traffic edges travelled a -> b in order, from `back` edges before `edge` to `ahead` after it: each one's b end the next one's
 * a end, a node no other traffic edge meets (no junction for a driver to turn off at).
 */
export const lanesThrough = (edge: number, back: number, ahead: number): Array<number> => {
  const chain = [edge]
  const step = (from: number, before: boolean) => {
    const node = before ? graph.edges[from]!.a : graph.edges[from]!.b,
      on = graph.adjacency[node]!.filter((f) => f !== from && traffic.has(f))
    assert.ok(
      on.length === 1 && (before ? graph.edges[on[0]!]!.b : graph.edges[on[0]!]!.a) === node,
      `one way on from edge ${from} at node ${node}, travelled a -> b`,
    )
    return on[0]!
  }
  for (let k = 0; k < back; k++) chain.unshift(step(chain[0]!, true))
  for (let k = 0; k < ahead; k++) chain.push(step(chain.at(-1)!, false))
  return chain
}

/** A traffic Panda at `at` on `step`, at `speed` m/s along its lane, its next step `next`. */
export const trafficPanda = (
  at: { readonly x: number; readonly y: number },
  speed: number,
  step: Step,
  next: Step,
) => {
  const l = laneOf(step.edge, step.forward)
  return trafficCar(
    "panda",
    0xd4a85e,
    { ...at, angle: Ops.atan2(l.dy, l.dx) },
    speed,
    { ...step, side: laneSide(step, "panda") },
    next,
  )
}

/**
 * A traffic Panda coming to `edge` (travelled a -> b) at `speed` m/s: at the start of the lane two edges before it, its next step
 * the edge between (on the deck 41 m short of OVER, on the road below 29 m short of BENEATH).
 */
export const comingTo = (edge: number, speed: number) => {
  const [first, next] = lanesThrough(edge, 2, 0) as [number, number]
  return trafficPanda(
    lanePoint(laneOf(first, true), 0, laneSide({ edge: first, forward: true }, "panda")),
    speed,
    { edge: first, forward: true },
    { edge: next, forward: true },
  )
}

/** A standing `model`'s chassis at `pose` on the level nearest `level` (m a.s.l.): the deck's or the road's under it. */
export const standingOn = (model: VehicleModel, pose: PoseValue, level: number) =>
  rollingChassis(model, pose, 0, level)

/** Sets the player's `Footing` to `z`, m a.s.l. (`runtime.tick` it after `start`). */
const footing = (z: number) =>
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

/** The player at `at` with their `Footing` on `z`, the `keys` played, and `cast` round them; nobody else comes. */
export const staged = (
  at: PoseValue,
  z: number,
  cast: Parameters<typeof stage>[1],
  keys: Timeline = press(5, "action"),
) => {
  const game = start(keys, [at, cast], { alone: true })
  assert.ok(game.runtime.tick(footing(z)).ok)
  return game
}

/** Out of everyone's way: 40 m to the right of the deck's lane at OVER, at the terrain's level. */
export const AWAY = (() => {
  const x = OVER.x + lane.rx * 40,
    y = OVER.y + lane.ry * 40
  return { pose: { x, y, angle: 0 }, z: atGrade(x, y) }
})()

/**
 * An unmanned Panda on the deck 25 m short of OVER along its lane's heading there, rolling at 10 m/s at a fifth of its
 * throttle: it passes over OVER at 11 m/s. No `Traffic`: a driver would brake for what stands in its way on the deck.
 */
export const overDeck = () =>
  rolling(
    "panda",
    {
      x: OVER.x - Ops.cos(OVER.angle) * 25,
      y: OVER.y - Ops.sin(OVER.angle) * 25,
      angle: OVER.angle,
    },
    10,
    0.2,
    0,
    DECK_Z,
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
