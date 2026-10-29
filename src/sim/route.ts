/**
 * Route geometry on the map graph for traffic and pedestrians: lanes (edge
 * centreline offset to the right of travel by `side`), the next edge at a
 * node, and nearest-edge lookups. Static, derived once from `graph`.
 *
 * @module route
 */
import { Ops, type Random } from "@typeonce/ritmo-math"

import { carCircles, carRadius, clearOf } from "./body.ts"
import { edgeIndex } from "./edges.ts"
import {
  graph,
  laneOffset,
  MAP,
  roadClassOf,
  type Road,
  type Segment,
  vergeOf,
  wallsNear,
} from "./map/index.ts"
import { residentsAlong } from "./population/density.ts"
import { VEHICLES, type VehicleModel } from "./vehicles.ts"

// The edge lookups live in ./edges.ts (density reads them without a cycle); route stays their public home.
export { distanceToEdge, edgeIndex } from "./edges.ts"

/** An edge as travelled: start point, unit direction, length, and the right-hand normal. */
export interface Lane {
  readonly x: number
  readonly y: number
  readonly dx: number
  readonly dy: number
  readonly length: number
  /** Right of travel (x = east, y = north): (dy, −dx). */
  readonly rx: number
  readonly ry: number
}

/** The road an edge belongs to. */
export const roadOf = (edge: number): Road => MAP.roads[graph.edges[edge]!.road]!

/** Edge `edge` travelled a -> b when `forward`, else b -> a. */
export const laneOf = (edge: number, forward: boolean): Lane => {
  const e = graph.edges[edge]!
  const from = graph.nodes[forward ? e.a : e.b]!,
    to = graph.nodes[forward ? e.b : e.a]!
  const length = Math.max(e.length, 1e-6)
  const dx = (to.x - from.x) / length,
    dy = (to.y - from.y) / length
  return { x: from.x, y: from.y, dx, dy, length, rx: dy, ry: -dx }
}

/** The point `along` metres down the lane, `side` metres to its right. */
export const lanePoint = (lane: Lane, along: number, side: number) => ({
  x: lane.x + lane.dx * along + lane.rx * side,
  y: lane.y + lane.dy * along + lane.ry * side,
})

/** How far (x, y) has come along the lane (projection, unclamped). */
export const alongLane = (lane: Lane, x: number, y: number): number =>
  (x - lane.x) * lane.dx + (y - lane.y) * lane.dy

/** The node a lane ends at. */
export const endNode = (edge: number, forward: boolean): number =>
  forward ? graph.edges[edge]!.b : graph.edges[edge]!.a

/** Drive on the right: the nominal traffic lane offset for a road. */
const trafficSide = (road: Road): number => laneOffset(road.w)

/** Pedestrians keep to the verge of roads and to the middle of paths, steps and tracks, or where the road's `verge` says (off the railway). */
export const walkSide = (road: Road): number => road.verge ?? vergeOf(roadClassOf(road), road.w)

/** Cruising speed of AI traffic by road class, m/s. */
export const cruiseSpeed = (road: Road): number => {
  const cls = roadClassOf(road)
  return cls === "tertiary" ? 12 : cls === "unclassified" ? 9 : cls === "residential" ? 7 : 5
}

/** Trucks keep to the wide roads (lanes through the village arches are too narrow). */
const classAllows = (edge: number, model: VehicleModel): boolean => {
  if (model !== "truck") return true
  const cls = roadClassOf(roadOf(edge))
  return cls === "tertiary" || cls === "unclassified"
}

const walkSet: ReadonlySet<number> = new Set(graph.walkEdges)

/** Whether heading `angle` points along `edge` travelled a -> b (rather than b -> a). */
export const facesForward = (edge: number, angle: number): boolean => {
  const ab = laneOf(edge, true)
  return ab.dx * Ops.cos(angle) + ab.dy * Ops.sin(angle) >= 0
}

/** A choice of edge and direction leaving a node. */
export interface Step {
  readonly edge: number
  readonly forward: boolean
}

const leaving = (node: number, edge: number): Step => ({
  edge,
  forward: graph.edges[edge]!.a === node,
})
/** A directed step's key in the per-step tables (lane sides, dead ends, the crossings' approaches): `edge * 2`, plus 1 when forward. */
export const stepKey = (step: Step) => step.edge * 2 + (step.forward ? 1 : 0)

/**
 * Peels degree-1 nodes off the edges `usable` allows until only loops (and
 * the paths between them) remain: the edges peeled, and for each the key of
 * its direction toward the node it was peeled at (into a dead end).
 */
const peel = (usable: (edge: number) => boolean) => {
  const degree = graph.adjacency.map((edges) => edges.filter(usable).length)
  const removed = new Set<number>()
  const toward = new Set<number>()
  const leaves = degree.flatMap((d, node) => (d === 1 ? [node] : []))
  for (let leaf = leaves.pop(); leaf !== undefined; leaf = leaves.pop()) {
    const edge = graph.adjacency[leaf]!.find((e) => usable(e) && !removed.has(e))
    if (edge === undefined) continue
    removed.add(edge)
    const e = graph.edges[edge]!
    const other = e.a === leaf ? e.b : e.a
    toward.add(stepKey({ edge, forward: e.b === leaf }))
    if (--degree[other]! === 1) leaves.push(other)
  }
  return { removed, toward }
}

/** Trucks cannot turn round on these roads, so they keep to the loops of their network: every spur peeled off. */
const loopsOnly = (sides: Float64Array): Float64Array => {
  for (const edge of peel((e) => sides[e * 2]! >= 0).removed) sides.fill(-1, edge * 2, edge * 2 + 2)
  return sides
}

/** A car's body must clear the walls every LANE_SAMPLE metres along the middle 80% of a lane; its offset shrinks by SIDE_STEP until it does. */
const LANE_SAMPLE = 1.5
const SIDE_STEP = 0.25
/** A car passes an oncoming Panda (most traffic) where the drive walls across a lane are both bodies plus this much apart, m; the walls are looked for this far out. */
const PASS_MARGIN = 0.3
const PASS_REACH = 3

/**
 * Copies of the drive walls (`wallsNear` reuses its answer) around `edge` that reach within `pad` m
 * of the line through `ab`, its lane a -> b: one query per edge. The lane tests take a min or a max
 * over walls, so given every wall that can narrow or block a sample they answer as they would over
 * a query per sample and side step, at a fraction of the cost.
 */
const wallsBeside = (edge: number, ab: Lane, pad: number): ReadonlyArray<Segment> => {
  const { a, b } = graph.edges[edge]!,
    p = graph.nodes[a]!,
    q = graph.nodes[b]!
  const across = (x: number, y: number) => (x - ab.x) * ab.rx + (y - ab.y) * ab.ry
  return wallsNear(
    "traffic",
    Math.min(p.x, q.x) - pad,
    Math.min(p.y, q.y) - pad,
    Math.max(p.x, q.x) + pad,
    Math.max(p.y, q.y) + pad,
  )
    .filter(
      (s) =>
        Math.max(across(s.ax, s.ay), across(s.bx, s.by)) >= -pad &&
        Math.min(across(s.ax, s.ay), across(s.bx, s.by)) <= pad,
    )
    .map(({ ax, ay, bx, by }) => ({ ax, ay, bx, by }))
}

/** Free width across `walls` at `along` metres down `lane` (up to 2 × PASS_REACH where a side is open). */
const freeWidth = (walls: ReadonlyArray<Segment>, lane: Lane, along: number): number => {
  const p = lanePoint(lane, along, 0)
  let left = PASS_REACH,
    right = PASS_REACH
  for (const s of walls) {
    // Where the line across the lane, p + t·(rx, ry), meets the wall at a + u·(b − a).
    const ex = s.bx - s.ax,
      ey = s.by - s.ay,
      den = lane.rx * ey - lane.ry * ex
    if (den === 0) continue
    const qx = s.ax - p.x,
      qy = s.ay - p.y,
      t = (qx * ey - qy * ex) / den,
      u = (qx * lane.ry - qy * lane.rx) / den
    if (u < 0 || u > 1) continue
    if (t >= 0) right = Math.min(right, t)
    else left = Math.min(left, -t)
  }
  return left + right
}

/**
 * `sides` with only the largest connected part of its usable edges (≥ 0)
 * kept: where narrow roads cut a model's network in two, it keeps off the
 * smaller piece rather than bounce between its dead ends.
 */
const largestPart = (sides: Float64Array): Float64Array => {
  const usable = (edge: number) => sides[edge * 2]! >= 0
  const part = new Int32Array(graph.nodes.length).fill(-1)
  const sizes: Array<number> = []
  graph.nodes.forEach((_, seed) => {
    if (part[seed]! >= 0 || !graph.adjacency[seed]!.some(usable)) return
    const id = sizes.length
    const open = [seed]
    part[seed] = id
    let size = 0
    for (let node = open.pop(); node !== undefined; node = open.pop()) {
      size++
      for (const edge of graph.adjacency[node]!) {
        if (!usable(edge)) continue
        const e = graph.edges[edge]!
        const other = e.a === node ? e.b : e.a
        if (part[other]! < 0) {
          part[other] = id
          open.push(other)
        }
      }
    }
    sizes.push(size)
  })
  const main = sizes.indexOf(Math.max(...sizes))
  graph.edges.forEach((e, edge) => {
    if (usable(edge) && part[e.a] !== main) sides.fill(-1, edge * 2, edge * 2 + 2)
  })
  return sides
}

/**
 * Per model, the lane offset of each traffic edge and direction: the nominal
 * keep-right offset, shrunk toward the centreline until the body clears every
 * wall along the lane (houses that crowd one side of the road); −1 where it
 * does not fit even on the centreline, two cars could not pass between the
 * walls (they would meet head-on with no room to back out or turn round), its
 * class is off limits, or the edge is cut off from the rest.
 */
const lanesFor = (model: VehicleModel): Float64Array => {
  const sides = new Float64Array(graph.edges.length * 2).fill(-1)
  const { width, length } = VEHICLES[model],
    r = carRadius(model)
  const passing = width + VEHICLES.panda.width + PASS_MARGIN
  for (const edge of graph.trafficEdges) {
    if (!classAllows(edge, model)) continue
    // Samples every LANE_SAMPLE m over the middle 80%: the same points travelled either way.
    const samples = Math.max(2, Math.ceil((graph.edges[edge]!.length * 0.8) / LANE_SAMPLE))
    const at = (lane: Lane, i: number) => lane.length * (0.1 + (0.8 * i) / samples)
    const nominal = trafficSide(roadOf(edge))
    const ab = laneOf(edge, true)
    // Every wall `freeWidth` can meet within PASS_REACH, and every one a body circle can touch (half the body length out) at any side offset, with 1 m to spare.
    const walls = wallsBeside(edge, ab, Math.max(PASS_REACH, nominal + length / 2) + 1)
    let singleFile = false
    for (let i = 0; i <= samples && !singleFile; i++)
      singleFile = freeWidth(walls, ab, at(ab, i)) < passing
    if (singleFile) continue
    for (const forward of [false, true]) {
      const lane = laneOf(edge, forward)
      const circles = carCircles(model, Ops.atan2(lane.dy, lane.dx))
      // `carClear` with no slack: every body circle at least r from every wall.
      const fits = (side: number) => {
        for (let i = 0; i <= samples; i++) {
          const c = lanePoint(lane, at(lane, i), side)
          if (!circles.every((o) => clearOf(walls, c.x + o.x, c.y + o.y, r))) return false
        }
        return true
      }
      let side = nominal
      while (side > 0 && !fits(side)) side = Math.max(0, side - SIDE_STEP)
      if (side > 0 || fits(0)) sides[stepKey({ edge, forward })] = side
    }
  }
  return largestPart(sides)
}
const laneSides = {
  panda: lanesFor("panda"),
  ape: lanesFor("ape"),
  truck: loopsOnly(lanesFor("truck")),
  carabinieri: lanesFor("carabinieri"),
} satisfies Record<VehicleModel, Float64Array>

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
