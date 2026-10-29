/**
 * Route geometry on the map graph for traffic and pedestrians: lanes (edge
 * centreline offset to the right of travel by `side`), the next edge at a
 * node, and nearest-edge lookups. Static, derived once from `graph` and the lane tables the map
 * file holds (`MAP.lanes`, baked by `./lanes.ts`).
 *
 * @module route
 */
import { Ops, type Random } from "@typeonce/ritmo-math"

import { edgeIndex } from "./edges.ts"
import { type Lane, laneOf, peel, roadOf, type Step, stepKey } from "./lanes.ts"
import { graph, MAP, roadClassOf, type Road, vergeOf } from "./map/index.ts"
import { residentsAlong } from "./population/density.ts"
import { VEHICLE_MODELS, type VehicleModel } from "./vehicles.ts"

// The edge lookups live in ./edges.ts (density reads them without a cycle) and the lane geometry in
// ./lanes.ts (the build bakes the lane tables with it); route stays their public home.
export { distanceToEdge, edgeIndex } from "./edges.ts"
export { type Lane, laneOf, lanePoint, roadOf, type Step, stepKey } from "./lanes.ts"

/**
 * Per model, the lane offset of each traffic edge and direction (by `stepKey`), baked into the map
 * (`MAP.lanes`, `bakeLanes`): the nominal keep-right offset, shrunk toward the centreline until the
 * body clears every wall along the lane; −1 where it does not fit even on the centreline, two cars
 * could not pass between the walls, its class is off limits, or the edge is cut off from the rest
 * (trucks keep to the loops of their network).
 */
const laneSides = Object.fromEntries(
  VEHICLE_MODELS.map((model) => {
    const sides = new Float64Array(graph.edges.length * 2).fill(-1),
      baked = MAP.lanes[model]
    if (baked.length !== 2 * graph.trafficEdges.length)
      throw new Error(
        `map: ${model} lanes hold ${baked.length} values for ${graph.trafficEdges.length} traffic edges; run pnpm map`,
      )
    graph.trafficEdges.forEach((edge, k) => {
      sides[edge * 2] = baked[2 * k]!
      sides[edge * 2 + 1] = baked[2 * k + 1]!
    })
    return [model, sides]
  }),
) as Record<VehicleModel, Float64Array>

/** How far (x, y) has come along the lane (projection, unclamped). */
export const alongLane = (lane: Lane, x: number, y: number): number =>
  (x - lane.x) * lane.dx + (y - lane.y) * lane.dy

/** The node a lane ends at. */
export const endNode = (edge: number, forward: boolean): number =>
  forward ? graph.edges[edge]!.b : graph.edges[edge]!.a

/** Pedestrians keep to the verge of roads and to the middle of paths, steps and tracks, or where the road's `verge` says (off the railway). */
export const walkSide = (road: Road): number => road.verge ?? vergeOf(roadClassOf(road), road.w)

/** Cruising speed of AI traffic by road class, m/s. */
export const cruiseSpeed = (road: Road): number => {
  const cls = roadClassOf(road)
  return cls === "tertiary" ? 12 : cls === "unclassified" ? 9 : cls === "residential" ? 7 : 5
}

const walkSet: ReadonlySet<number> = new Set(graph.walkEdges)

/** Whether heading `angle` points along `edge` travelled a -> b (rather than b -> a). */
export const facesForward = (edge: number, angle: number): boolean => {
  const ab = laneOf(edge, true)
  return ab.dx * Ops.cos(angle) + ab.dy * Ops.sin(angle) >= 0
}

const leaving = (node: number, edge: number): Step => ({
  edge,
  forward: graph.edges[edge]!.a === node,
})

/** Drive on the right: the lane offset of `model` on `step` (nominal, or less where walls crowd the road). */
export const laneSide = (step: Step, model: VehicleModel): number =>
  Math.max(0, laneSides[model][stepKey(step)]!)

/** Whether AI `model` may drive `edge`: where the body fits between the walls, trucks only on the loops of the wide roads. */
export const allowsModel = (edge: number, model: VehicleModel): boolean =>
  laneSides[model][stepKey({ edge, forward: true })]! >= 0 &&
  laneSides[model][stepKey({ edge, forward: false })]! >= 0

/** Per model, the directions of travel that only lead into dead-end spurs (map exits, and roads too narrow for it, included). */
const deadEnds = {
  panda: peel((e) => allowsModel(e, "panda")).toward,
  ape: peel((e) => allowsModel(e, "ape")).toward,
  truck: peel((e) => allowsModel(e, "truck")).toward,
  carabinieri: peel((e) => allowsModel(e, "carabinieri")).toward,
} satisfies Record<VehicleModel, ReadonlySet<number>>

/** Whether travelling `edge` this way only leads `model` into a dead end. */
export const leadsToDeadEnd = (step: Step, model: VehicleModel): boolean =>
  deadEnds[model].has(stepKey(step))

/** Turns sharper than this (cosine between the directions in and out) are hairpins a car cannot follow. */
const HAIRPIN = -0.5

/**
 * The traffic edge to take after arriving at `node` along `arrived`: a random
 * legal one (oneway roads only a -> b, only roads the model fits), avoiding
 * dead-end spurs and then hairpins while there is another way on, and a
 * U-turn only at a dead end.
 */
export const nextTrafficEdge = (
  node: number,
  arrived: number,
  model: VehicleModel,
  random: Random.Random,
): Step => {
  const options = graph.adjacency[node]!.filter(
    (e) =>
      e !== arrived &&
      allowsModel(e, model) &&
      (roadOf(e).oneway !== true || graph.edges[e]!.a === node),
  ).map((e) => leaving(node, e))
  const into = laneOf(arrived, graph.edges[arrived]!.b === node)
  const gentle = (step: Step) => {
    const out = laneOf(step.edge, step.forward)
    return into.dx * out.dx + into.dy * out.dy > HAIRPIN
  }
  const onward = options.filter((step) => !leadsToDeadEnd(step, model))
  const pool = [onward.filter(gentle), onward, options].find((tier) => tier.length > 0) ?? []
  return random.pick(pool) ?? leaving(node, arrived)
}

/**
 * How far down each way a walker at a junction looks, m (TUNED: about a village block). Residents are counted within
 * `EDGE_REACH` (60 m) of each walk edge, so the edges meeting at a junction all count about the same houses: a way is weighed
 * by where it leads instead, so that a lane out of the village counts the fields it runs into, not the houses at its corner.
 */
const WALK_AHEAD = 120
/** `wayAhead` of every step (by `key`), filled in on first use: -1 until then. */
const ahead = new Float32Array(graph.edges.length * 2).fill(-1)
/**
 * The residents along the most lived-in walk edge `WALK_AHEAD` m down `step` (or at a dead end before that): where the way
 * leads. A breadth-first search over the walk edges, each edge visited once.
 */
const wayAhead = (step: Step): number => {
  const k = stepKey(step)
  if (ahead[k]! >= 0) return ahead[k]!
  let most = 0
  const seen = new Set([step.edge])
  const queue: Array<{ readonly step: Step; readonly gone: number }> = [
    { step, gone: graph.edges[step.edge]!.length },
  ]
  for (let i = 0; i < queue.length; i++) {
    const { step: s, gone } = queue[i]!
    const node = endNode(s.edge, s.forward)
    const on =
      gone < WALK_AHEAD ? graph.adjacency[node]!.filter((e) => walkSet.has(e) && !seen.has(e)) : []
    if (on.length === 0) most = Math.max(most, residentsAlong(s.edge))
    for (const e of on) {
      seen.add(e)
      queue.push({ step: leaving(node, e), gone: gone + graph.edges[e]!.length })
    }
  }
  return (ahead[k] = most)
}
/**
 * Every way out of a junction is taken with this weight on top of its `wayAhead` residents, TUNED: walkers keep to the streets
 * people live on, and a lane out into the fields (no residents ahead) still draws about one walker in 35 where a typical village
 * street (17 residents, the median of the peopled walk edges) is the other way.
 */
const WALK_FLOOR = 0.5

/** The walk edge to take after arriving at `node` along `arrived`: weighted by the residents the way leads to, turning back only at dead ends. */
export const nextWalkEdge = (node: number, arrived: number, random: Random.Random): Step => {
  const options = graph.adjacency[node]!.filter((e) => e !== arrived && walkSet.has(e)).map((e) =>
    leaving(node, e),
  )
  return random.weighted(options, (step) => wayAhead(step) + WALK_FLOOR) ?? leaving(node, arrived)
}

/** Lookups on the whole traffic and walk networks. */
export const trafficIndex = edgeIndex(graph.trafficEdges)
export const walkIndex = edgeIndex(graph.walkEdges)
