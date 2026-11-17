import assert from "node:assert/strict"
import { test } from "node:test"

import type { RoadF } from "../features.ts"
import { buildGraph } from "../graph.ts"

const road = (id: number, pts: ReadonlyArray<readonly [number, number, string]>): RoadF => ({
  id,
  cls: "service",
  w: 3.5,
  surface: "asphalt",
  private: false,
  pts: pts.map(([x, y, id]) => ({ x, y, id })),
})

// Regression: a driveway OSM ends 2.39 m from the Lucca–Aulla line by Aulla station put a lane and
// a verge on the track, and the build threw. A dead end on the track is no place to stop or walk to.
test("buildGraph drops a dead end's tip on the running track from traffic and walkers", () => {
  // A square loop of four 20 m roads, and a 20 m spur off it whose tip (x 40) stands on the track.
  const roads = [
    road(1, [
      [0, 0, "a"],
      [20, 0, "b"],
    ]),
    road(2, [
      [20, 0, "b"],
      [20, 20, "c"],
    ]),
    road(3, [
      [20, 20, "c"],
      [0, 20, "d"],
    ]),
    road(4, [
      [0, 20, "d"],
      [0, 0, "a"],
    ]),
    road(5, [
      [20, 0, "b"],
      [40, 0, "e"],
    ]),
  ]
  const roadsOf = (g: ReturnType<typeof buildGraph>, ids: ReadonlyArray<number>) =>
    new Set(ids.map((e) => roads[g.edges[3 * e + 2]!]!.id))
  const open = buildGraph(roads, () => true)
  assert.deepEqual(roadsOf(open, open.traffic), new Set([1, 2, 3, 4, 5]))
  const railed = buildGraph(
    roads,
    () => true,
    (x) => x > 39,
  )
  assert.deepEqual(roadsOf(railed, railed.traffic), new Set([1, 2, 3, 4]))
  assert.deepEqual(roadsOf(railed, railed.walk), new Set([1, 2, 3, 4]))
})
