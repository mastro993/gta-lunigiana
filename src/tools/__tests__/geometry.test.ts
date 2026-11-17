import assert from "node:assert/strict"
import { test } from "node:test"

import { staticGrid } from "../../sim/collide.ts"
import { latLonToGaussBoaga } from "../crs.ts"
import {
  type P,
  clipRing,
  fromLocal,
  gaussBoagaBox,
  hash01,
  segIndex,
  staticPoints,
  staticSegs,
} from "../geometry.ts"
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

test("staticSegs visits the segments segIndex visits, in the same order, at the same distances", () => {
  // 400 segments up to 30 m long over a 200 m square on both sides of the origin, short and
  // degenerate ones among them, asked at 2000 points over it and past its edges.
  const xy: Array<number> = []
  for (let k = 0; k < 400; k++) {
    const ax = 200 * hash01(k, 1) - 100,
      ay = 200 * hash01(k, 2) - 100,
      len = k % 10 === 0 ? 0 : 30 * hash01(k, 3),
      angle = 2 * Math.PI * hash01(k, 4)
    xy.push(ax, ay, ax + len * Math.cos(angle), ay + len * Math.sin(angle))
  }
  const index = segIndex<number>()
  for (let k = 0; k < 400; k++)
    index.add(xy[4 * k]!, xy[4 * k + 1]!, xy[4 * k + 2]!, xy[4 * k + 3]!, 3, k)
  const packed = staticSegs(xy, 3)
  let hits = 0
  for (let n = 0; n < 2000; n++) {
    const x = 240 * hash01(n, 5) - 120,
      y = 240 * hash01(n, 6) - 120
    const want: Array<readonly [number, number]> = [],
      got: Array<readonly [number, number]> = []
    index.within(x, y, (s, d2) => want.push([s.data, d2]))
    packed(x, y, (k, d2) => got.push([k, d2]))
    assert.deepEqual(got, want)
    hits += got.length
  }
  assert.ok(hits > 500, `the points meet segments (${hits})`)
  staticSegs([], 3)(0, 0, () => assert.fail("no segments, no visit"))
})

test("staticPoints visits the points staticGrid visits as boxes, in the same order", () => {
  // 3000 points (x, y, scale) over 300 × 200 m, some on one spot, asked over boxes of every size,
  // some past the points' box.
  const xy: Array<number> = []
  for (let i = 0; i < 3000; i++)
    xy.push(Math.round(300 * hash01(i, 1)) - 150, Math.round(200 * hash01(i, 2)) + 40, i)
  const boxes = staticGrid(
      3000,
      (i) => [xy[3 * i]!, xy[3 * i + 1]!, xy[3 * i]!, xy[3 * i + 1]!],
      16,
    ),
    points = staticPoints(xy, 3, 16)
  let hits = 0
  for (let n = 0; n < 500; n++) {
    const x = 400 * hash01(n, 3) - 200,
      y = 300 * hash01(n, 4) - 10,
      r = 40 * hash01(n, 5)
    const want: Array<number> = [],
      got: Array<number> = []
    boxes(x - r, y - r, x + r, y + r, (i) => want.push(i))
    points(x - r, y - r, x + r, y + r, (i) => got.push(i))
    assert.deepEqual(got, want)
    hits += got.length
  }
  assert.ok(hits > 5000, `the boxes meet points (${hits})`)
  staticPoints([], 3, 16)(-1, -1, 1, 1, () => assert.fail("no points, no visit"))
})
