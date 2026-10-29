import assert from "node:assert/strict"
import { test } from "node:test"

import { clearVerges, type ClearInput } from "../rail-clear.ts"

/** A straight running track along y = 0, its bed at 100 m. */
const track = [{ pts: [-100, 0, 100, 0], z: [100, 100] }]
/** A graph of one road along a polyline: nodes at its vertices, one edge per segment, all walked (and driven when `drive`). */
const graphOf = (pts: ReadonlyArray<number>, drive: boolean): ClearInput["graph"] => {
  const edges = Array.from({ length: pts.length / 2 - 1 }, (_, k) => [k, k + 1, 0]).flat()
  const ids = Array.from({ length: edges.length / 3 }, (_, e) => e)
  return { xy: pts, edges, walk: ids, traffic: drive ? ids : [] }
}
const road = (pts: ReadonlyArray<number>, z: number, cls = "residential", w = 4.5) => ({
  cls,
  w,
  pts,
  z: Array.from({ length: pts.length / 2 }, () => z),
})

test("clearVerges pulls in the verge of a road beside the track until it clears 2.8 m", () => {
  // A residential street (4.5 m) 5 m from the line: its verge (3.05 m out) runs 1.95 m from it.
  const pts = [-40, 5, 0, 5, 40, 5]
  const { verges, report } = clearVerges({
    graph: graphOf(pts, false),
    roads: [road(pts, 100.2)],
    track,
    boxes: [],
    platforms: [],
  })
  assert.equal(verges.get(0), 2.15, "5 − 2.8 − 0.05")
  assert.ok(Math.abs(report.verges[0]!.before - 1.95) < 1e-9)
})

test("clearVerges leaves a road at another level, in a crossing box or on a platform alone, and throws for a traffic lane", () => {
  const pts = [-40, 5, 0, 5, 40, 5]
  const leftAlone = (input: Partial<ClearInput>) =>
    clearVerges({
      graph: graphOf(pts, false),
      roads: [road(pts, 100)],
      track,
      boxes: [],
      platforms: [],
      ...input,
    }).verges.size
  assert.equal(leftAlone({ roads: [road(pts, 103)] }), 0, "3 m above the rail")
  assert.equal(
    leftAlone({ platforms: [[[-50, 1, 50, 1, 50, 3, -50, 3]]] }),
    0,
    "its verge on a platform",
  )
  // A road crossing the line is its own box's: its verges cross the track there.
  const across = [0, -40, 0, 0, 0, 40]
  assert.equal(
    leftAlone({
      graph: graphOf(across, false),
      roads: [road(across, 100)],
      boxes: [{ road: 0, at: [[0, 0]] }],
    }),
    0,
  )
  assert.throws(
    () => leftAlone({ graph: graphOf(across, false), roads: [road(across, 100)] }),
    /road 0: its verge would come within 0.3 m of its middle beside the railway/,
    "outside a box no verge clears a track it crosses",
  )
  // A two-lane road (6.5 m: lanes 1.83 m out) 4 m from the line: its lane runs 2.17 m from it.
  const near = [-40, 4, 40, 4]
  assert.throws(
    () =>
      clearVerges({
        graph: graphOf(near, true),
        roads: [road(near, 100, "tertiary", 6.5)],
        track,
        boxes: [],
        platforms: [],
      }),
    /traffic lane of edge 0 at .* is 2\.17 m from the running track/,
  )
})
