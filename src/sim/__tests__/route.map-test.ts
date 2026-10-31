import assert from "node:assert/strict"
import { test } from "node:test"

import { midpointOf } from "../edges.ts"
import { graph, MAP } from "../map/index.ts"
import { trafficIndex, walkIndex } from "../route.ts"
import { assertDeadEnds, assertLanesClear, assertNearest } from "./route-checks.ts"

// Map checks (pnpm test:map): every node, lane and edge of the map; route.test.ts checks those by Monzone.
test("dead ends: driving into a dead-end node is flagged, driving out of it is not, all over the map", () => {
  assert.ok(assertDeadEnds(graph.nodes.keys()) > 0)
})

// Regression: lanes a quarter of the road right of centre ran through houses that crowd the road (traffic wedged for minutes).
test("lanes: every lane AI traffic may drive keeps its body out of the walls, all over the map", () => {
  const lanes = assertLanesClear(graph.trafficEdges)
  for (const [model, count] of Object.entries(lanes))
    assert.ok(count > 100, `${model}: ${count} lanes`)
})

test("edgeIndex.nearest: the nearest edge by brute force (first on a tie), all over the map and far outside it", () => {
  const { minX, minY, maxX, maxY } = MAP.bounds
  for (const [index, edges] of [
    [trafficIndex, graph.trafficEdges],
    [walkIndex, graph.walkEdges],
  ] as const) {
    // A 20 x 15 lattice from 300 m outside the bounds, plus a point on every 97th edge's midpoint.
    const points = Array.from({ length: 300 }, (_, k) => ({
      x: minX - 300 + ((maxX - minX + 600) * (k % 20)) / 19,
      y: minY - 300 + ((maxY - minY + 600) * Math.floor(k / 20)) / 14,
    }))
    for (let k = 0; k < edges.length; k += 97) points.push(midpointOf(edges[k]!))
    assertNearest(index, edges, points)
  }
})
