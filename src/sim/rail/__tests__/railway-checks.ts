// The checks lines.test.ts, crossings.test.ts and roads.test.ts (the railway within 4 km of Monzone
// station) and lines.map-test.ts, crossings.map-test.ts and roads.map-test.ts (all of the map's)
// share: the lines, their level crossings and stations as the game reads them.
import assert from "node:assert/strict"

import { Ops } from "@typeonce/ritmo-math"

import { segDist2 } from "../../collide.ts"
import { graph, type LevelCrossing, MAP, RAIL_LIFT } from "../../map/index.ts"
import { endNode, laneOf, lanePoint } from "../../route.ts"
import { strikeIn } from "../barriers.ts"
import { approachesOf, APPROACHES, CROSSINGS, linesAtGrade } from "../crossings.ts"
import {
  DRAWN_RUN,
  LINES,
  linesNear,
  nextStop,
  pointAt,
  runOut,
  SHARED,
  speedAt,
  stopPoint,
} from "../lines.ts"
import { trainLength } from "../models.ts"
import { nearCrossing, SPAWN_CLEAR } from "../roads.ts"

/** A part of the map's railway, by index: what the checks below visit. */
export interface RailwayPart {
  /** The lines with a point in it: indices into `LINES`. */
  readonly lines: ReadonlyArray<number>
  /** Its level crossings: indices into `MAP.railway.crossings` and `CROSSINGS`. */
  readonly boxes: ReadonlyArray<number>
  /** Its stations, by their middle: indices into `MAP.railway.stations`. */
  readonly stations: ReadonlyArray<number>
  /** Whether (x, y) lies in it. */
  readonly holds: (x: number, y: number) => boolean
}

/** The railway within `reach` m of `spot` (all of the map's with no spot). */
export const railwayAround = (
  spot?: { readonly x: number; readonly y: number },
  reach = Infinity,
): RailwayPart => {
  const holds = (x: number, y: number) =>
    spot === undefined || Ops.hypot(x - spot.x, y - spot.y) <= reach
  return {
    lines: LINES.filter((line) => line.x.some((x, k) => holds(x, line.y[k]!))).map((l) => l.index),
    boxes: [...MAP.railway.crossings.keys()].filter((b) =>
      holds(MAP.railway.crossings[b]!.x, MAP.railway.crossings[b]!.y),
    ),
    stations: [...MAP.railway.stations.keys()].filter((s) => {
      const { line, s0, s1 } = MAP.railway.stations[s]!,
        at = pointAt(LINES[line]!, (s0 + s1) / 2)
      return holds(at.x, at.y)
    }),
    holds,
  }
}

const { bounds } = MAP
const onEdge = (x: number, y: number) =>
  Math.min(x - bounds.minX, bounds.maxX - x, y - bounds.minY, bounds.maxY - y) < 0.5

/** Each of `lines` runs its pieces terminal to terminal from s 0, then its run-out straight on past each, level. */
export const checkTerminals = (lines: ReadonlyArray<number>): void => {
  for (const line of lines.map((l) => LINES[l]!)) {
    const pieces = MAP.railway.lines[line.index]!.pieces
    let length = 0
    for (const { rail } of pieces) {
      const { pts } = MAP.rail[rail]!
      for (let k = 2; k < pts.length; k += 2)
        length += Ops.hypot(pts[k]! - pts[k - 2]!, pts[k + 1]! - pts[k - 1]!)
    }
    assert.ok(Math.abs(line.length - length) < 0.01, `${line.length} m against ${length} m`)
    assert.deepEqual(
      [line.start, line.end],
      [-runOut(speedAt(line, 0)), line.length + runOut(speedAt(line, line.length))],
    )
    for (const s of [0, line.length]) {
      const end = pointAt(line, s)
      assert.ok(onEdge(end.x, end.y), `terminal at (${end.x}, ${end.y}) on the map's edge`)
      // Straight on and level past it, over the drawn run to the run-out's end.
      const way = s === 0 ? -1 : 1
      for (const out of [DRAWN_RUN, s === 0 ? -line.start : line.end - line.length]) {
        const far = pointAt(line, s + way * out)
        assert.ok(Math.abs(Ops.hypot(far.x - end.x, far.y - end.y) - out) < 1e-6)
        assert.ok(Math.abs(far.angle - pointAt(line, s + (way * out) / 2).angle) < 1e-9)
        assert.equal(far.z, end.z)
        assert.ok(!far.bridge && !far.tunnel)
      }
    }
  }
}

/** Its crossings and stations lie at their s, the rail head `RAIL_LIFT` over the bed, and a box's road meets the rail at its level. */
export const checkAtTheirS = ({ boxes, stations }: RailwayPart): void => {
  for (const crossing of boxes.map((b) => MAP.railway.crossings[b]!).filter((c) => c.line >= 0)) {
    const at = pointAt(LINES[crossing.line]!, crossing.s)
    const node = crossing.nodes
      .map((n) => graph.nodes[n]!)
      .find((n) => Ops.hypot(n.x - at.x, n.y - at.y) < 0.05)
    assert.ok(node !== undefined, `a node of the box at s ${crossing.s}`)
    assert.ok(!at.bridge && !at.tunnel, "at grade")
    const road = MAP.roads[crossing.road]!
    const k = road.pts.findIndex(
      (v, i) => i % 2 === 0 && v === node.x && road.pts[i + 1] === node.y,
    )
    assert.ok(Math.abs(at.z - RAIL_LIFT - road.z[k / 2]!) < 0.01, `rail and road meet at the box`)
  }
  for (const station of stations.map((s) => MAP.railway.stations[s]!)) {
    const mid = (station.s0 + station.s1) / 2,
      at = pointAt(LINES[station.line]!, mid)
    const platform = MAP.railway.platforms.find(
      (p) => p.name === station.name && p.walkway !== true,
    )
    assert.ok(platform !== undefined)
    // The platform's axis is the running track beside it: the line runs along it at the platform's middle.
    let near = Number.MAX_VALUE
    for (let k = 0; k + 3 < platform.axis.length; k += 2) {
      const [ax, ay, bx, by] = platform.axis.slice(k, k + 4) as [number, number, number, number]
      near = Math.min(near, Math.sqrt(segDist2(at.x, at.y, ax, ay, bx, by).d2))
    }
    assert.ok(near < 0.05, `${station.name}'s platform beside the line at its middle (${near} m)`)
  }
}

/** For each of `lines`, `linesNear` finds its s and the distance off it beside its longest straight, and nothing out of reach. */
export const checkLinesNear = (lines: ReadonlyArray<number>): void => {
  for (const line of lines.map((l) => LINES[l]!)) {
    // The middle of its longest straight between its terminals.
    let k = 1
    for (let j = 2; j + 2 < line.s.length; j++)
      if (line.s[j + 1]! - line.s[j]! > line.s[k + 1]! - line.s[k]!) k = j
    const s = (line.s[k]! + line.s[k + 1]!) / 2,
      at = pointAt(line, s)
    const off = {
      x: at.x - 5 * Ops.sin(at.angle),
      y: at.y + 5 * Ops.cos(at.angle),
    }
    const [found, ...more] = linesNear(off.x, off.y, 8)
    assert.ok(found?.line === line.index && more.length === 0)
    assert.ok(Math.abs(found.s - s) < 0.05 && Math.abs(found.distance - 5) < 0.05)
    assert.deepEqual(linesNear(off.x, off.y, 4), [])
  }
}

/** On each of `lines` with two stations or more, a train stops centred on the platforms and calls next at the first station ahead past its stop reach. */
export const checkStops = (lines: ReadonlyArray<number>): void => {
  const length = trainLength("atr220")
  for (const line of lines.map((l) => LINES[l]!).filter((l) => l.stations.length >= 2)) {
    const [first, second] = line.stations
    const a = MAP.railway.stations[first!]!
    assert.ok(Math.abs(stopPoint(a, 1, length) - length / 2 - (a.s0 + a.s1) / 2) < 1e-9)
    assert.ok(Math.abs(stopPoint(a, -1, length) + length / 2 - (a.s0 + a.s1) / 2) < 1e-9)
    assert.equal(nextStop(line, 0, 1, length), first)
    assert.equal(nextStop(line, stopPoint(a, 1, length), 1, length), second)
    assert.equal(nextStop(line, stopPoint(a, -1, length), -1, length), -1)
    assert.equal(nextStop(line, line.length, -1, length), line.stations.at(-1))
  }
}

/** No two of `lines` share track (true of the map's lines today). */
export const checkNoSharedTrack = (lines: ReadonlyArray<number>): void => {
  for (const i of lines)
    for (const j of lines) assert.deepEqual(SHARED[i]![j], [], `lines ${i} and ${j}`)
}

/** Each of `boxes` holds every line crossing it at grade, at the map's s, its carriageway's reach along it and its strike-in at line speed. */
export const checkBoxLines = (boxes: ReadonlyArray<number>): void => {
  assert.equal(CROSSINGS.length, MAP.railway.crossings.length)
  for (const i of boxes) {
    const box = CROSSINGS[i]!,
      record = MAP.railway.crossings[i]!
    // The build names the first line through the box (−1 for a loop or siding only); today no box has two.
    assert.deepEqual(
      box.on.map((at) => at.line),
      record.line < 0 ? [] : [record.line],
    )
    for (const at of box.on) {
      assert.ok(Math.abs(at.s - record.s) < 0.06, `box ${i}: s ${at.s} against ${record.s}`)
      const width = MAP.roads[record.road]!.w
      assert.ok(at.half >= width / 2 && at.half <= width / 2 / 0.3, `box ${i}: half ${at.half}`)
      assert.equal(at.reach, strikeIn(speedAt(LINES[at.line]!, at.s)))
    }
  }
}

/** Level-aware: a line on a bridge over a traffic road in it crosses nothing there, though it passes right over it; at each of its boxes' nodes the line it crosses is at grade. */
export const checkLevels = ({ lines, boxes, holds }: RailwayPart): void => {
  // Where a line bridges a traffic road.
  let under: { line: number; x: number; y: number } | undefined
  for (const line of lines.map((l) => LINES[l]!))
    for (let k = 0; k + 1 < line.s.length && under === undefined; k++) {
      if (line.level[k] !== 1) continue
      const mid = { x: (line.x[k]! + line.x[k + 1]!) / 2, y: (line.y[k]! + line.y[k + 1]!) / 2 }
      if (!holds(mid.x, mid.y)) continue
      const road = graph.trafficEdges.find((e) => {
        const p = graph.nodes[graph.edges[e]!.a]!,
          q = graph.nodes[graph.edges[e]!.b]!
        return segDist2(mid.x, mid.y, p.x, p.y, q.x, q.y).d2 < 1
      })
      if (road !== undefined) under = { line: line.index, ...mid }
    }
  assert.ok(under !== undefined, "a rail bridge over a traffic road")
  const over = linesNear(under.x, under.y, 0.5).find((p) => p.line === under.line)
  assert.ok(over?.line === under.line && over.distance < 1e-6)
  assert.ok(pointAt(LINES[under.line]!, over.s).bridge)
  assert.deepEqual(linesAtGrade(under.x, under.y), [])
  for (const i of boxes)
    for (const at of CROSSINGS[i]!.on)
      assert.ok(
        MAP.railway.crossings[i]!.nodes.some((n) =>
          linesAtGrade(graph.nodes[n]!.x, graph.nodes[n]!.y).some((g) => g.line === at.line),
        ),
      )
}

/**
 * Each of `boxes`: stop lines 3.5–4 m from the nearest track, arms on the right spanning the road,
 * a foot crossing armless; each traffic step into one (at least `least`) leading in.
 */
export const checkBoxes = (boxes: ReadonlyArray<number>, least: number): void => {
  const near = (x: number, y: number) => {
    let best = Number.MAX_VALUE
    for (const piece of MAP.rail)
      for (let k = 0; k + 3 < piece.pts.length; k += 2)
        best = Math.min(
          best,
          segDist2(x, y, piece.pts[k]!, piece.pts[k + 1]!, piece.pts[k + 2]!, piece.pts[k + 3]!).d2,
        )
    return Math.sqrt(best)
  }
  for (const i of boxes) {
    const c = CROSSINGS[i]!,
      width = MAP.roads[c.road]!.w
    if (c.walk) {
      assert.deepEqual(c.approaches, [])
      continue
    }
    assert.equal(c.approaches.length, 2)
    for (const a of c.approaches) {
      const across = { x: -Ops.sin(a.heading), y: Ops.cos(a.heading) }
      // The stop line's nearer corner.
      const corner = Math.min(
        near(a.stop.x + (across.x * width) / 2, a.stop.y + (across.y * width) / 2),
        near(a.stop.x - (across.x * width) / 2, a.stop.y - (across.y * width) / 2),
      )
      assert.ok(
        corner > 3.5 - 0.05 && corner < 4 + 0.05,
        `box ${i}: stop line ${corner.toFixed(2)} m off`,
      )
      const right = (a.pivot.x - a.entry.x) * -across.x + (a.pivot.y - a.entry.y) * -across.y
      assert.ok(right > width / 2, "the post right of the way in")
      assert.ok(a.arm >= width && a.arm <= 8)
    }
  }
  // Each approach step leads into its box: it ends nearer the box than it starts, its stop line before the entry before the exit.
  let steps = 0
  for (const [key, step] of APPROACHES) {
    if (!boxes.includes(step.box)) continue
    steps++
    const edge = key >> 1,
      forward = (key & 1) === 1
    const { a, b } = graph.edges[edge]!,
      start = forward ? a : b,
      from = graph.nodes[start]!,
      to = graph.nodes[endNode(edge, forward)]!
    const c = CROSSINGS[step.box]!
    assert.ok(step.stop < step.entry && step.entry < step.exit)
    // Between a box's own nodes a step is inside it already; any other comes from outside toward it.
    if (MAP.railway.crossings[step.box]!.nodes.includes(start)) assert.ok(step.entry < 0)
    else assert.ok(Ops.hypot(to.x - c.x, to.y - c.y) < Ops.hypot(from.x - c.x, from.y - c.y))
  }
  assert.ok(steps >= least, `${steps} steps into the boxes`)
}

/** Where one of `boxes` has a plain node 20–60 m along its road, each traffic step with both leads into the box it reaches first. */
export const checkPairs = (boxes: ReadonlyArray<number>): void => {
  const traffic = new Set(graph.trafficEdges)
  const degree = (n: number) => graph.adjacency[n]!.filter((e) => traffic.has(e)).length
  // A second box on a road box's own road, 20–60 m on along a chain of plain nodes, the chain going on beyond it.
  const pair = boxes.flatMap((i): Array<[LevelCrossing, LevelCrossing]> => {
    const real = MAP.railway.crossings[i]!
    if (CROSSINGS[i]!.walk) return []
    for (const start of real.nodes) {
      let node = start,
        back = 0
      const seen = new Set(real.nodes)
      for (;;) {
        const edge = graph.adjacency[node]!.find((e) => {
          const { a, b, road } = graph.edges[e]!
          return traffic.has(e) && road === real.road && !seen.has(a === node ? b : a)
        })
        if (edge === undefined) break
        const { a, b, length } = graph.edges[edge]!
        node = a === node ? b : a
        back += length
        seen.add(node)
        if (back > 60 || degree(node) !== 2) break
        const on = graph.adjacency[node]!.some(
          (e) => e !== edge && traffic.has(e) && graph.edges[e]!.road === real.road,
        )
        if (back >= 20 && on) {
          const { x, y } = graph.nodes[node]!
          return [[real, { road: real.road, nodes: [node], x, y, line: -1, s: -1 }]]
        }
      }
    }
    return []
  })
  assert.ok(pair.length > 0, "a road box with a plain node 20–60 m along its road")
  for (const [real, other] of pair) {
    const alone = approachesOf([real]),
      lone = approachesOf([other]),
      both = approachesOf([real, other])
    assert.equal(both.size, new Set([...alone.keys(), ...lone.keys()]).size)
    for (const [key, step] of both) {
      const a = alone.get(key),
        b = lone.get(key)
      const first = b === undefined || (a !== undefined && a.stop < b.stop) ? a! : { ...b, box: 1 }
      assert.deepEqual(step, first, `step ${key}`)
    }
  }
}

/** Every traffic step tabled into one of `boxes` has its middle, where traffic is brought out, inside the box's clearance, or is long. */
export const checkStepsClear = (boxes: ReadonlyArray<number>): void => {
  let steps = 0
  for (const [key, entry] of APPROACHES) {
    if (!boxes.includes(entry.box)) continue
    steps++
    const lane = laneOf(key >> 1, (key & 1) === 1),
      mid = lanePoint(lane, lane.length / 2, 0),
      crossing = CROSSINGS[entry.box]!
    if (Ops.hypot(mid.x - crossing.x, mid.y - crossing.y) < SPAWN_CLEAR)
      assert.equal(nearCrossing(mid.x, mid.y), true)
  }
  assert.ok(steps > 0, "steps into the boxes")
}
