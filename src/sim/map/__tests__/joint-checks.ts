// The joint check joints.map-test.ts, joints-cesena.map-test.ts and joints-l.map-test.ts share, on
// the map their process loaded: where a road comes onto or off a bridge or into or out of a tunnel,
// or one bridge way meets the next, a driver coming along judges a car standing in its lane past the
// joint by the ground its wheels come to rolling there (`onPathLevel`, src/sim/systems/traffic.ts):
// read on another level, it would drive into the car (as through the sag onto the SR445's viaduct
// from the east, where the old reading carried along the driver's pitch read the ground under the
// deck). The reading follows the map's surfaces, so a joint whose two profiles meet a step apart, or
// a deck whose start stands off its approach, breaks it.
import assert from "node:assert/strict"

import { Ops } from "@typeonce/ritmo-math"

import { distanceToEdge } from "../../edges.ts"
import { allowsModel, laneOf, lanePoint, laneSide, roadOf } from "../../route.ts"
import { onPathLevel } from "../../systems/traffic.ts"
import { roadLevel } from "../ground.ts"
import { graph, MAP } from "../index.ts"

/**
 * How far apart (m, along their lanes) the driver and the car it judges stand at most: a Panda at the primary roads' 16 m/s starts
 * braking for a car standing in its lane 27.1 m off, middle to middle (`followSpeed`).
 */
const REACH = 40
/** The two stand this far apart along their lanes, m. */
const SPACING = 2
/** A joint, or a node on either side of it, turning more than this is a junction's corner, not a way on: a driver steers it. */
const TURN = Ops.cos(Math.PI / 6)

const traffic = new Set(graph.trafficEdges)
const lifted = (edge: number) => roadOf(edge).bridge === true || roadOf(edge).tunnel === true
/** Whether a Panda may drive `edge` from `node` (a oneway road only a -> b). */
const drivable = (edge: number, forward: boolean) =>
  allowsModel(edge, "panda") && (forward || roadOf(edge).oneway !== true)

/** A lane as travelled: its edge and direction. */
interface Run {
  readonly edge: number
  readonly forward: boolean
}

/** From `run`, the runs on along the road away from `node` (back when `back`), while no junction and no corner: up to REACH m. */
const chain = (run: Run, back: boolean): Array<Run> => {
  const out = [run]
  let length = laneOf(run.edge, run.forward).length
  while (length < REACH) {
    const last = out.at(-1)!,
      e = graph.edges[last.edge]!,
      node = back === last.forward ? e.a : e.b,
      on = graph.adjacency[node]!.filter((f) => f !== last.edge && traffic.has(f))
    if (on.length !== 1) break
    const next = {
      edge: on[0]!,
      forward: back ? graph.edges[on[0]!]!.b === node : graph.edges[on[0]!]!.a === node,
    }
    const a = laneOf(last.edge, last.forward),
      b = laneOf(next.edge, next.forward)
    if (!drivable(next.edge, next.forward) || a.dx * b.dx + a.dy * b.dy < TURN) break
    out.push(next)
    length += b.length
  }
  return out
}

/** The point `s` m along `runs` from where they start (back from their end when `back`), at a Panda's side, with its lane and road. */
const along = (runs: ReadonlyArray<Run>, s: number, back: boolean) => {
  let left = s
  for (const run of runs) {
    const lane = laneOf(run.edge, run.forward)
    if (left <= lane.length) {
      const p = lanePoint(lane, back ? lane.length - left : left, laneSide(run, "panda"))
      return { ...p, lane, road: graph.edges[run.edge]!.road }
    }
    left -= lane.length
  }
  return undefined
}

/** Whether the arc from `p` (heading along its lane) round (0, `circle`) to `front`, `across` keeps on one of `runs`' carriageways. */
const onCarriageway = (
  p: {
    readonly x: number
    readonly y: number
    readonly lane: { readonly dx: number; readonly dy: number }
  },
  front: number,
  across: number,
  circle: number,
  runs: ReadonlyArray<Run>,
) => {
  const sweep = circle === 0 ? 0 : Ops.atan2(circle * front, circle * (circle - across)),
    n = Math.ceil(circle === 0 ? front : Math.abs(sweep * circle))
  for (let k = 1; k <= n; k++) {
    const f = circle === 0 ? (front * k) / n : circle * Ops.sin((sweep * k) / n),
      a = circle === 0 ? 0 : circle * (1 - Ops.cos((sweep * k) / n)),
      x = p.x + p.lane.dx * f - p.lane.dy * a,
      y = p.y + p.lane.dy * f + p.lane.dx * a
    if (!runs.some((r) => distanceToEdge(r.edge, x, y) <= roadOf(r.edge).w / 2)) return false
  }
  return true
}

/** A joint where a driver reads a car past it off its level: the OSM ids of the road before it and the one past it, and a line saying where. */
export interface Misread {
  readonly from: number
  readonly onto: number
  readonly line: string
}

/**
 * The joints of the map this process loaded and the driver's and car's places checked there (`pairs`), and every joint where a
 * driver reads a Panda standing in its lane past it off its level (one per joint, the first place found).
 */
export const jointMisreads = () => {
  const out: Array<Misread> = []
  let joints = 0,
    pairs = 0
  for (let node = 0; node < graph.nodes.length; node++) {
    const here = graph.adjacency[node]!.filter((e) => traffic.has(e))
    for (const i of here)
      for (const o of here) {
        const into = { edge: i, forward: graph.edges[i]!.b === node },
          past = { edge: o, forward: graph.edges[o]!.a === node }
        const ri = graph.edges[i]!.road,
          ro = graph.edges[o]!.road
        if (i === o || ri === ro || (!lifted(i) && !lifted(o))) continue
        if (!drivable(i, into.forward) || !drivable(o, past.forward)) continue
        const a = laneOf(i, into.forward),
          b = laneOf(o, past.forward)
        if (a.dx * b.dx + a.dy * b.dy < TURN) continue
        const before = chain(into, true),
          after = chain(past, false)
        joints++
        let miss: string | undefined
        for (let d = SPACING; d < REACH && miss === undefined; d += SPACING)
          for (let s = SPACING; d + s <= REACH && miss === undefined; s += SPACING) {
            const p = along(before, d, true),
              q = along(after, s, false)
            if (p === undefined || q === undefined) break
            const ground = roadLevel(p.road, p.x, p.y),
              z = roadLevel(q.road, q.x, q.y)
            if (ground === undefined || z === undefined) continue
            const rx = q.x - p.x,
              ry = q.y - p.y,
              front = rx * p.lane.dx + ry * p.lane.dy,
              across = ry * p.lane.dx - rx * p.lane.dy
            if (front <= 0) continue
            // The arc a driver at p steers to reach q, tangent to its lane there: where it leaves the carriageways, the lanes bend
            // away from it, and the driver steers them, not it.
            const circle =
              Math.abs(across) < 1e-3 ? 0 : (front * front + across * across) / (2 * across)
            if (!onCarriageway(p, front, across, circle, [...before, ...after])) continue
            const driver = { x: p.x, y: p.y, angle: Ops.atan2(p.lane.dy, p.lane.dx), ground }
            pairs++
            if (!onPathLevel(driver, { front, across, off: 0, wide: 0, circle }, z))
              miss = `${MAP.roads[ri]!.cls} ${MAP.roads[ri]!.id} onto ${MAP.roads[ro]!.cls} ${MAP.roads[ro]!.id} at ${q.x.toFixed(0)},${q.y.toFixed(0)}: from ${d} m before the joint (its way at ${ground.toFixed(2)} m), a car ${s} m past it (at ${z.toFixed(2)} m) off its level`
          }
        if (miss !== undefined)
          out.push({ from: MAP.roads[ri]!.id, onto: MAP.roads[ro]!.id, line: miss })
      }
  }
  return { joints, pairs, misreads: out }
}

/**
 * Asserts the joint check over the map this process loaded: no misread but the `known` ones (OSM ids of the road before the joint
 * and the one past it), each of which must still misread, and at least `least` places checked, so the check is not empty.
 */
export const assertJoints = (known: ReadonlyArray<readonly [number, number]>, least: number) => {
  const { joints, pairs, misreads } = jointMisreads()
  assert.ok(pairs >= least, `${pairs} places at ${joints} joints`)
  const isKnown = (m: Misread) => known.some(([from, onto]) => m.from === from && m.onto === onto)
  assert.deepEqual(
    misreads.filter((m) => !isKnown(m)).map((m) => m.line),
    [],
  )
  for (const [from, onto] of known)
    assert.ok(
      misreads.some((m) => m.from === from && m.onto === onto),
      `${from} onto ${onto} reads on its level now: drop it from the known misreads`,
    )
  return { joints, pairs }
}
