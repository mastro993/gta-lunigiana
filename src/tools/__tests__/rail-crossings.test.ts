import assert from "node:assert/strict"
import { test } from "node:test"

import type { RailF, RoadF } from "../features.ts"
import type { V } from "../geometry.ts"
import { underRail } from "../rail-crossings.ts"

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
