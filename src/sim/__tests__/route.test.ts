import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { midpointOf } from "../edges.ts"
import { graph, MAP } from "../map/index.ts"
import { allowsModel, distanceToEdge, roadOf, trafficIndex, walkIndex } from "../route.ts"
import { assertDeadEnds, assertLanesClear, assertNearest } from "./route-checks.ts"

// route.map-test.ts (pnpm test:map) checks every node, lane and edge of the map; these, those by Monzone.
/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }
const REACH = 800
const near = (p: { readonly x: number; readonly y: number }) =>
  Ops.hypot(p.x - STATION.x, p.y - STATION.y) < REACH

test("dead ends: driving into a dead-end node is flagged, driving out of it is not, by Monzone", () => {
  const nodes = graph.nodes.flatMap((n, i) => (near(n) ? [i] : []))
  assert.ok(assertDeadEnds(nodes) > 5)
})

// Regression: lanes a quarter of the road right of centre ran through houses that crowd the road (traffic wedged for minutes).
test("lanes: every lane AI traffic may drive by Monzone keeps its body out of the walls", () => {
  const lanes = assertLanesClear([...trafficIndex.around(STATION.x, STATION.y, [0, REACH])])
  for (const [model, count] of Object.entries(lanes))
    assert.ok(count > 50, `${model}: ${count} lanes`)
})

// Regression: in walled single-file lanes AI cars met head-on, or turned into a corner they could not take, and wedged for good.
test("lanes: AI traffic keeps off lanes where the walls leave no room to pass an oncoming car", () => {
  // Where cars wedged: Gragnola's alley between the houses by the Lucido, Via Bezzecca in Terma, Via Carlo del Prete in Fazzano.
  for (const [x, y] of [
    [-1774, 3335],
    [-1525, 652],
    [428, 2029],
  ] as const) {
    const edge = trafficIndex.nearest(x, y)
    assert.ok(distanceToEdge(edge, x, y) < 2)
    for (const model of ["panda", "ape", "carabinieri"] as const)
      assert.ok(
        !allowsModel(edge, model),
        `${model} on ${roadOf(edge).name ?? roadOf(edge).id} at ${x},${y}`,
      )
  }
  assert.ok(
    graph.trafficEdges
      .filter((e) => roadOf(e).name === "Via Cesare Battisti")
      .every((e) => allowsModel(e, "panda")),
    "two cars pass on Via Cesare Battisti",
  )
})

test("edgeIndex.nearest: the nearest edge by brute force (first on a tie), by Monzone and far outside the map", () => {
  const { minX, minY, maxX, maxY } = MAP.bounds
  for (const [index, edges] of [
    [trafficIndex, graph.trafficEdges],
    [walkIndex, graph.walkEdges],
  ] as const) {
    // A 10 x 8 lattice over Monzone, every 7th edge's midpoint there, and the map's corners 300 m out.
    const points = Array.from({ length: 80 }, (_, k) => ({
      x: STATION.x - REACH + (2 * REACH * (k % 10)) / 9,
      y: STATION.y - REACH + (2 * REACH * Math.floor(k / 10)) / 7,
    }))
    const there = [...index.around(STATION.x, STATION.y, [0, REACH])]
    for (let k = 0; k < there.length; k += 7) points.push(midpointOf(there[k]!))
    for (const x of [minX - 300, maxX + 300])
      for (const y of [minY - 300, maxY + 300]) points.push({ x, y })
    assert.ok(points.length > 100, `${points.length} points`)
    assertNearest(index, edges, points)
  }
})
