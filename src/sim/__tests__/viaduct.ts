/**
 * The bridge-level tests' spot: the SR445's viaduct west of Gragnola (OSM way 552592654) over the
 * residential road under it (OSM way 140780578), both found by their OSM ids and the deck's lane by
 * geometry, so the fixtures survive a map rebuild; traffic coming along a run of lanes with no
 * junction; a road coming down through a sag onto a bridge (the SR445 onto the viaduct from the
 * east); a setter for the player's or the animals' `Footing` (`stage` and `teleport` keep the
 * player's from where they were, and an animal's first is at the terrain's level); the player staged
 * there with their `Footing` set on a level; a spot out of everyone's way; an unmanned Panda
 * rolling along the deck over the road below; and the deck's centreline where the road below
 * crosses it, which the parapet tests (issue #91) drive across and under. Also a steep lane, where
 * what touches or scares a body must not be read under a vehicle's middle.
 *
 * @module sim/__tests__/viaduct
 */
import assert from "node:assert/strict"

import { Ops } from "@typeonce/ritmo-math"

import { segDist2 } from "../collide.ts"
import {
  type Animal,
  Footing,
  Game,
  Player,
  Pose,
  type PoseValue,
  type RouteValue,
} from "../index.ts"
import { atGrade, groundZ, roadLevel } from "../map/ground.ts"
import { graph, MAP } from "../map/index.ts"
import { ONE_LEVEL } from "../map/kinds.ts"
import { roadLineAt } from "../map/vectors.ts"
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

const road = roadLevel(UNDER, OVER.x, OVER.y)
assert.ok(road !== undefined, "the road under the deck passes under OVER")
/** The deck's surface at OVER, m a.s.l. (148.49). */
export const DECK_Z = roadLevel(VIADUCT, OVER.x, OVER.y)!
/** The road's surface under it, m a.s.l. (142.41). */
export const ROAD_Z = groundZ(OVER.x, OVER.y, road)
assert.ok(
  DECK_Z - ROAD_Z > 3 * ONE_LEVEL,
  `the deck ${(DECK_Z - ROAD_Z).toFixed(2)} m over the road`,
)

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

/**
 * The viaduct's centreline over the road below, from its segment nearest OVER: where BELOW's line crosses it (`at`), the deck's
 * half-width (`half`, m), its heading's unit vector (`along`) and its left (`across`), and the deck's surface there and the road
 * below's (`deck` 148.49, `road` 142.28, m a.s.l.).
 */
export const CENTRELINE = (() => {
  const { pts } = roadLineAt(VIADUCT, OVER.x, OVER.y)!
  let nearest = Infinity,
    k = 0
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const { d2 } = segDist2(OVER.x, OVER.y, pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!)
    if (d2 < nearest) [nearest, k] = [d2, i]
  }
  const [ax, ay, bx, by] = [pts[k]!, pts[k + 1]!, pts[k + 2]!, pts[k + 3]!],
    len = Ops.hypot(bx - ax, by - ay)
  const p = graph.nodes[graph.edges[BELOW]!.a]!,
    q = graph.nodes[graph.edges[BELOW]!.b]!
  const t =
    ((ax - p.x) * (by - ay) - (ay - p.y) * (bx - ax)) /
    ((q.x - p.x) * (by - ay) - (q.y - p.y) * (bx - ax))
  const at = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
  return {
    at,
    half: MAP.roads[VIADUCT]!.w / 2,
    along: { x: (bx - ax) / len, y: (by - ay) / len },
    across: { x: -(by - ay) / len, y: (bx - ax) / len },
    deck: roadLevel(VIADUCT, at.x, at.y)!,
    road: roadLevel(UNDER, at.x, at.y)!,
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

/**
 * A road coming onto a bridge (OSM way `approach` onto `deck`, found by their ids, travelled a -> b): `at(s)`, the point `s` m along
 * its lanes from the deck's start (before it, negative) at a Panda's side, heading along them, with its step and the next; `from`
 * where the lanes start, two edges before the deck's first; and `z(p)` the deck's surface at `p`, m a.s.l.
 */
export const onto = (approach: number, deck: number) => {
  const up = roadById(approach),
    on = roadById(deck)
  const first = graph.trafficEdges.find((e) => {
    const { road, a } = graph.edges[e]!
    return (
      road === on &&
      graph.adjacency[a]!.some(
        (f) => traffic.has(f) && graph.edges[f]!.road === up && graph.edges[f]!.b === a,
      )
    )
  })
  assert.ok(first !== undefined, `OSM way ${approach} comes onto ${deck}, a -> b`)
  const chain = lanesThrough(first, 2, 1),
    lengths = chain.map((e) => laneOf(e, true).length),
    starts = lengths.map((_, k) =>
      lengths.slice(0, k).reduce((sum, l) => sum + l, -lengths[0]! - lengths[1]!),
    )
  return {
    from: starts[0]!,
    at: (s: number) => {
      const k = starts.findLastIndex((start) => start <= s)
      assert.ok(k >= 0 && k + 1 < chain.length, `${s} m along the lanes onto OSM way ${deck}`)
      const step = { edge: chain[k]!, forward: true },
        lane = laneOf(step.edge, true)
      return {
        ...lanePoint(lane, s - starts[k]!, laneSide(step, "panda")),
        angle: Ops.atan2(lane.dy, lane.dx),
        step,
        next: { edge: chain[k + 1]!, forward: true },
      }
    },
    z: (p: { readonly x: number; readonly y: number }) => roadLevel(on, p.x, p.y)!,
  }
}

/** The SR445 coming down 15% from the east (OSM way 552592644) onto the viaduct's level deck (`onto`): a sag at its start. */
export const FROM_EAST = onto(552592644, 552592654)

/** A standing `model`'s chassis at `pose` on the level nearest `level` (m a.s.l.): the deck's or the road's under it. */
export const standingOn = (model: VehicleModel, pose: PoseValue, level: number) =>
  rollingChassis(model, pose, 0, level)

/** Sets the `Footing` of the player, or with `Animal` every animal's, to `z`, m a.s.l. (`runtime.tick` it after `start`). */
export const footing = (z: number, of: typeof Player | typeof Animal = Player) =>
  Game.Schedule(
    Game.System(
      "Test/Footing",
      {
        queries: {
          player: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [of] }),
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

/**
 * A service road's lane (OSM way 337406860), straight down at 30% over its 16 m: its traffic edge nearest (3160, 8920), travelled
 * downhill (`lane`), found by the way's OSM id and geometry; `at(s, model)` the pose `s` m down it at `model`'s side, heading
 * down, and `z(p)` the road's surface at `p`, m a.s.l.
 */
export const STEEP = (() => {
  const road = roadById(337406860),
    edge = edgeIndex(graph.trafficEdges.filter((e) => graph.edges[e]!.road === road)).nearest(
      3160,
      8920,
    ),
    ab = laneOf(edge, true),
    end = lanePoint(ab, ab.length, 0),
    forward = roadLevel(road, ab.x, ab.y)! > roadLevel(road, end.x, end.y)!,
    lane = laneOf(edge, forward)
  return {
    lane,
    step: { edge, forward },
    at: (s: number, model: VehicleModel): PoseValue => ({
      ...lanePoint(lane, s, laneSide({ edge, forward }, model)),
      angle: Ops.atan2(lane.dy, lane.dx),
    }),
    z: (p: { readonly x: number; readonly y: number }) => roadLevel(road, p.x, p.y)!,
  }
})()

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
