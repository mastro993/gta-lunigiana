// The checks route.test.ts (the roads by Monzone) and route.map-test.ts (every road of the map)
// share, each over the graph's nodes, edges or points it is handed.
import assert from "node:assert/strict"

import { Ops } from "@typeonce/ritmo-math"

import { carClear } from "../body.ts"
import { graph } from "../map/index.ts"
import {
  allowsModel,
  distanceToEdge,
  type edgeIndex,
  laneOf,
  lanePoint,
  laneSide,
  leadsToDeadEnd,
} from "../route.ts"

/** Asserts that driving into each of `nodes` that is a Panda's dead end is flagged and driving out is not; returns how many. */
export const assertDeadEnds = (nodes: Iterable<number>): number => {
  let checked = 0
  for (const node of nodes) {
    const own = graph.adjacency[node]!.filter((e) => allowsModel(e, "panda"))
    if (own.length !== 1) continue
    const into = { edge: own[0]!, forward: graph.edges[own[0]!]!.b === node }
    assert.ok(leadsToDeadEnd(into, "panda"))
    assert.ok(!leadsToDeadEnd({ edge: into.edge, forward: !into.forward }, "panda"))
    checked++
  }
  return checked
}

/** Asserts that every lane of `edges` the Panda, the Ape and the truck may drive keeps the body out of the walls; returns each model's lanes. */
export const assertLanesClear = (edges: ReadonlyArray<number>): Record<string, number> => {
  const lanes: Record<string, number> = {}
  for (const model of ["panda", "ape", "truck"] as const) {
    lanes[model] = 0
    for (const edge of edges)
      for (const forward of [true, false]) {
        if (!allowsModel(edge, model)) continue
        const lane = laneOf(edge, forward)
        const angle = Ops.atan2(lane.dy, lane.dx)
        for (let f = 0.15; f < 0.9; f += 0.1) {
          const at = lanePoint(lane, lane.length * f, laneSide({ edge, forward }, model))
          assert.ok(
            carClear(model, { ...at, angle }, 0.05),
            `${model} on edge ${edge} (${forward ? "a -> b" : "b -> a"}) at ${f.toFixed(2)}`,
          )
        }
        lanes[model]++
      }
  }
  return lanes
}

/** Asserts that `index` answers at each of `points` the nearest of `edges` by brute force (the first on a tie). */
export const assertNearest = (
  index: ReturnType<typeof edgeIndex>,
  edges: ReadonlyArray<number>,
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): void => {
  for (const p of points) {
    let best = edges[0]!,
      distance = Infinity
    for (const e of edges) {
      const d = distanceToEdge(e, p.x, p.y)
      if (d < distance) [best, distance] = [e, d]
    }
    assert.equal(index.nearest(p.x, p.y), best, `at ${p.x.toFixed(1)},${p.y.toFixed(1)}`)
  }
}
