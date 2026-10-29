import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { segDist2 } from "../../collide.ts"
import { graph, type LevelCrossing, MAP } from "../../map/index.ts"
import { endNode } from "../../route.ts"
import { strikeIn } from "../barriers.ts"
import { approachesOf, APPROACHES, CROSSINGS, linesAtGrade } from "../crossings.ts"
import { LINES, linesNear, pointAt, speedAt } from "../lines.ts"

test("crossings: each box holds every line crossing it at grade, at the map's s, its carriageway's reach along it and its strike-in at line speed", () => {
  assert.equal(CROSSINGS.length, MAP.railway.crossings.length)
  for (const [i, box] of CROSSINGS.entries()) {
    const record = MAP.railway.crossings[i]!
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
})

test("crossings: level-aware: a line on a bridge over a road crosses nothing there, though it passes right over it", () => {
  // Where a line bridges a traffic road.
  let under: { line: number; x: number; y: number } | undefined
  for (const line of LINES)
    for (let k = 0; k + 1 < line.s.length && under === undefined; k++) {
      if (line.level[k] !== 1) continue
      const mid = { x: (line.x[k]! + line.x[k + 1]!) / 2, y: (line.y[k]! + line.y[k + 1]!) / 2 }
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
  // At every box's nodes the line it crosses is at grade.
  for (const [i, record] of MAP.railway.crossings.entries())
    for (const at of CROSSINGS[i]!.on)
      assert.ok(
        record.nodes.some((n) =>
          linesAtGrade(graph.nodes[n]!.x, graph.nodes[n]!.y).some((g) => g.line === at.line),
        ),
      )
})

test("crossings: the map's boxes: stop lines 3.5–4 m from the nearest track, arms on the right spanning the road, approaches leading in, the foot crossing armless", () => {
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
  for (const [i, c] of CROSSINGS.entries()) {
    const width = MAP.roads[c.road]!.w
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
  assert.ok(APPROACHES.size >= 8)
  for (const [key, step] of APPROACHES) {
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
})

test("crossings: with two boxes along one road, each traffic step leads into the box it reaches first", () => {
  const traffic = new Set(graph.trafficEdges)
  const degree = (n: number) => graph.adjacency[n]!.filter((e) => traffic.has(e)).length
  // A second box on a road box's own road, 20–60 m on along a chain of plain nodes, the chain going on beyond it.
  const pair = MAP.railway.crossings.flatMap((real, i): Array<[LevelCrossing, LevelCrossing]> => {
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
})
