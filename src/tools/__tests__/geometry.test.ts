import assert from "node:assert/strict"
import { test } from "node:test"

import { latLonToGaussBoaga } from "../crs.ts"
import { BOUNDS, type P, clipRing, fromLocal, gaussBoagaBox } from "../geometry.ts"
import { partOf } from "../region.ts"

/** A square from (x, y), `s` metres a side. */
const square = (x: number, y: number, s: number): Array<P> => [
  [x, y],
  [x, y + s],
  [x + s, y + s],
  [x + s, y],
]
const sorted = (ring: ReadonlyArray<P>) => ring.toSorted((a, b) => a[0] - b[0] || a[1] - b[1])

test("clipRing keeps the part of a ring inside a box", () => {
  assert.deepEqual(sorted(clipRing(square(-50, 900, 200), [0, 0, 1000, 1000])), [
    [0, 900],
    [0, 1000],
    [150, 900],
    [150, 1000],
  ])
  assert.deepEqual(clipRing(square(2000, 0, 10), [0, 0, 1000, 1000]), [])
})

test("clipRing clips to the play area by default", () => {
  const x = BOUNDS.maxX - 10
  assert.deepEqual(sorted(clipRing(square(x, 0, 20))), [
    [x, 0],
    [x, 20],
    [BOUNDS.maxX, 0],
    [BOUNDS.maxX, 20],
  ])
})

test("gaussBoagaBox is the EPSG:3003 box round the corners, widened by pad on every side", () => {
  const [x0, y0, x1, y1] = partOf("lucido").rects[0]!
  const corners = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ].map(([x, y]) => latLonToGaussBoaga(...fromLocal(x!, y!)))
  const es = corners.map((c) => c[0]),
    ns = corners.map((c) => c[1])
  const box = [Math.min(...es), Math.min(...ns), Math.max(...es), Math.max(...ns)]
  assert.deepEqual(gaussBoagaBox(partOf("lucido").rects), box)
  assert.deepEqual(gaussBoagaBox(partOf("lucido").rects, 500), [
    box[0]! - 500,
    box[1]! - 500,
    box[2]! + 500,
    box[3]! + 500,
  ])
  // The box holds the 7.8 by 10 km rectangle with room to spare: the frames turn against each other.
  assert.ok(box[2]! - box[0]! > 7800 && box[3]! - box[1]! > 10_000)
})
