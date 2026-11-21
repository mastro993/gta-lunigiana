import assert from "node:assert/strict"
import { test } from "node:test"

import { staticGrid } from "../../sim/collide.ts"
import { latLonToGaussBoaga } from "../crs.ts"
import {
  type P,
  boxesMeet,
  clipRing,
  fromLocal,
  gaussBoagaBox,
  hash01,
  nearBoxes,
  segDist2,
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

test("segIndex visits every segment whose buffer holds the point, in the order added, at segDist2's distance", () => {
  // 600 segments up to 40 m long, radii 0.5-12 m, over a 300 m square round the origin, short and
  // degenerate ones among them, added one by one and as lines of points and of numbers, asked at
  // 3000 points over it and past its edges, against a scan of them all.
  const segs: Array<readonly [number, number, number, number, number]> = []
  const index = segIndex<number>(),
    wide = segIndex<number>(32)
  for (let k = 0; k < 600; k++) {
    const ax = 300 * hash01(k, 1) - 150,
      ay = 300 * hash01(k, 2) - 150,
      len = k % 13 === 0 ? 0 : 40 * hash01(k, 3),
      angle = 2 * Math.PI * hash01(k, 4),
      r = 0.5 + 11.5 * hash01(k, 7),
      bx = ax + len * Math.cos(angle),
      by = ay + len * Math.sin(angle)
    segs.push([ax, ay, bx, by, r])
    if (k % 3 === 0) index.add(ax, ay, bx, by, r, k)
    else if (k % 3 === 1)
      index.addLine(
        [
          { x: ax, y: ay },
          { x: bx, y: by },
        ],
        r,
        k,
      )
    else index.addLine([ax, ay, bx, by], r, k)
    wide.add(ax, ay, bx, by, r, k)
  }
  let hits = 0
  for (let n = 0; n < 3000; n++) {
    const x = 360 * hash01(n, 5) - 180,
      y = 360 * hash01(n, 6) - 180
    const want: Array<ReadonlyArray<number>> = []
    segs.forEach(([ax, ay, bx, by, r], k) => {
      const { d2, t } = segDist2(x, y, ax, ay, bx, by)
      if (d2 < r * r) want.push([k, d2, t, ax, ay, bx, by, r])
    })
    for (const ix of [index, wide]) {
      const got: Array<ReadonlyArray<number>> = []
      ix.within(x, y, (s, d2, t) => got.push([s.data, d2, t, s.ax, s.ay, s.bx, s.by, s.r]))
      assert.deepEqual(got, want)
      assert.equal(
        ix.covers(x, y, (k) => k % 2 === 0),
        want.some(([k]) => k! % 2 === 0),
      )
    }
    hits += want.length
  }
  assert.ok(hits > 1000, `the points meet segments (${hits})`)
  segIndex<null>().within(0, 0, () => assert.fail("no segments, no visit"))
})

test("staticSegs visits the segments segIndex visits, in the same order, at the same distances", () => {
  // 400 segments up to 30 m long over a 200 m square on both sides of the origin, short and
  // degenerate ones among them, in three parts (one empty), asked at 2000 points over it and past
  // its edges.
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
  const packed = staticSegs([xy.slice(0, 4 * 150), [], xy.slice(4 * 150)], 3)
  let hits = 0
  for (let n = 0; n < 2000; n++) {
    const x = 240 * hash01(n, 5) - 120,
      y = 240 * hash01(n, 6) - 120
    const want: Array<ReadonlyArray<number>> = [],
      got: Array<ReadonlyArray<number>> = []
    index.within(x, y, (s, d2) => want.push([s.data, d2, s.ax, s.ay, s.bx, s.by]))
    packed(x, y, (...seen) => got.push(seen))
    assert.deepEqual(got, want)
    hits += got.length
  }
  assert.ok(hits > 500, `the points meet segments (${hits})`)
  staticSegs([[]], 3)(0, 0, () => assert.fail("no segments, no visit"))
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

test("nearBoxes is true for every box that meets one of its boxes, and false far from them all", () => {
  /** A box from a pseudo-random point in a 2 km square, up to 300 m a side, k its seed. */
  const box = (k: number, at = 0): [number, number, number, number] => {
    const x = at + 2000 * hash01(k, 1) - 1000,
      y = at + 2000 * hash01(k, 2) - 1000
    return [x, y, x + 300 * hash01(k, 3), y + 300 * hash01(k, 4)]
  }
  const boxes = Array.from({ length: 40 }, (_, k) => box(k))
  const near = nearBoxes(boxes)
  let meeting = 0
  for (let k = 100; k < 3100; k++) {
    const q = box(k)
    if (!boxes.some((b) => boxesMeet(b, q))) continue
    meeting++
    assert.ok(near(...q), `box ${k} meets one`)
  }
  assert.ok(meeting > 1000, `${meeting} boxes met one`)
  for (let k = 0; k < 100; k++) assert.equal(near(...box(k, 5000)), false, `box ${k} far off`)
})
