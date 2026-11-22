import assert from "node:assert/strict"
import { test } from "node:test"

import type { RailF, RoadF } from "../features.ts"
import type { V } from "../geometry.ts"
import { slideCrossing, underRail } from "../rail-crossings.ts"

const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })
const road = (id: number, pts: ReadonlyArray<V>, more: Partial<RoadF> = {}): RoadF => ({
  id,
  cls: "track",
  w: 3,
  surface: "unpaved",
  private: false,
  pts,
  ...more,
})

/** `slideCrossing` on node "lc" of `roads`, the moved rail running along y −1.5 m: its result, the rail and the moves. */
const slid = (roads: ReadonlyArray<RoadF>) => {
  const holders = roads.flatMap((r, at) =>
    r.pts.flatMap((p, i) => (p.id === "lc" ? [{ road: at, i }] : [])),
  )
  const line = [v(400, -1.5), v(600, -1.5)],
    moves = new Map<string, V>()
  return { slid: slideCrossing(line, "lc", new Map([["lc", holders]]), roads, moves), line, moves }
}

// OSM's rail crosses the roads below at node "lc" (500, 1); the CTR moves it 2.5 m south.
test("slideCrossing takes a road that only ends on the rail to where the moved rail is nearest", () => {
  // As driveway 1455968336 at Santo Stefano di Magra, which ends on the Pontremolese short of the CTR's track.
  const r = slid([road(10, [v(500, 20, "r0"), v(500, 1, "lc")])])
  assert.deepEqual(r.slid, { id: "lc", road: 10, shift: 2.5, x: 500, y: -1.5 })
  assert.deepEqual(r.moves.get("lc"), { x: 500, y: -1.5, id: "lc" })
  assert.deepEqual(r.line[1], { x: 500, y: -1.5, id: "lc" })
})

// Regression: a road through the rail that OSM splits into two ways at the crossing node ends on it
// twice, and was taken for one that ends there: bent onto the moved rail where one it does not split
// throws.
test("slideCrossing throws when the moved rail no longer crosses a road through it, split at the node or not", () => {
  // Crossing at 3°: the CTR's track passes south of the road's next vertex.
  const [west, east] = [v(460, 3, "r0"), v(540, -1, "r1")]
  const through = /level crossing lc: the rail no longer crosses its road$/
  assert.throws(() => slid([road(10, [west, v(500, 1, "lc"), east])]), through)
  assert.throws(
    () => slid([road(10, [west, v(500, 1, "lc")]), road(11, [v(500, 1, "lc"), east])]),
    through,
  )
})

// Regression: OSM maps the farm track 205932314 under the Genova–Pisa's bank by Sarzana at layer −1 with no tunnel tag, and the
// build drew it across both tracks at grade, between their vertices, with no level crossing.
test("underRail puts a road OSM lays under at-grade track it crosses with no node in common into a tunnel, and no other", () => {
  const rail: Array<RailF> = [
    { id: 1, pts: [v(0, 0), v(50, 0, "lc"), v(100, 0)] },
    { id: 2, bridge: true, pts: [v(100, 0), v(200, 0)] },
  ]
  const roads = [
    road(10, [v(20, -10), v(20, 10)], { layer: -1 }), // under the track at grade: a tunnel
    road(11, [v(50, -10), v(50, 0, "lc"), v(50, 10)], { layer: -1 }), // a level crossing on a node both share
    road(12, [v(30, -10), v(30, 10)]), // at grade, crossing with no node in common: left to the checks
    road(13, [v(150, -10), v(150, 10)], { layer: -1 }), // under a bridge: at grade already
    road(14, [v(20, 20), v(80, 20)], { layer: -1 }), // crossing no track
  ]
  assert.deepEqual(
    underRail(roads, rail).map((r) => [r.id, r.tunnel === true]),
    [
      [10, true],
      [11, false],
      [12, false],
      [13, false],
      [14, false],
    ],
  )
  // Under or level with the track's own layer: a track on an embankment OSM lays at layer 1 has a road at layer 0 under it,
  // one in a cutting at layer −1 none at −1.
  const raised = [{ ...rail[0]!, layer: 1 }],
    cut = [{ ...rail[0]!, layer: -1 }]
  assert.deepEqual(
    [
      underRail([road(15, [v(20, -10), v(20, 10)])], raised)[0]!.tunnel,
      underRail([roads[0]!], cut)[0]!.tunnel,
    ],
    [true, undefined],
  )
})
