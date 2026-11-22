import assert from "node:assert/strict"
import { test } from "node:test"

import { latLonToGaussBoaga } from "../crs.ts"
import {
  type P,
  boxesMeet,
  clipRing,
  endsUnder,
  fromLocal,
  gaussBoagaBox,
  hash01,
  nearBoxes,
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

// Regression: the build dropped the culvert OSM maps under Via Pratolino's bridge (878660856), and
// the ditch 864556128 started under its deck without crossing it, so the deck never capped it.
test("endsUnder finds the ends of a line lying within reach of another, square to it between its ends", () => {
  const deck = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
  ]
  // A ditch starting 2.7 m off the deck's middle and running away from it; its end 40 m off.
  const ditch = [
    { x: 12, y: 2.7 },
    { x: 12, y: 42.7 },
  ]
  assert.deepEqual(endsUnder(ditch, deck, 3), [{ x: 12, y: 2.7, sa: 0, sb: 12 }])
  assert.deepEqual(endsUnder(ditch, deck, 2.5), [], "out of reach")
  // Ending past the deck's end, beyond its abutment: not under it.
  const beyond = [
    { x: 21, y: 30 },
    { x: 21, y: 1 },
  ]
  assert.deepEqual(endsUnder(beyond, deck, 3), [])
  // Both ends under it.
  assert.deepEqual(
    endsUnder(
      [
        { x: 2, y: -1 },
        { x: 6, y: 2 },
      ],
      deck,
      3,
    ),
    [
      { x: 2, y: -1, sa: 0, sb: 2 },
      { x: 6, y: 2, sa: 5, sb: 6 },
    ],
  )
})
