import assert from "node:assert/strict"
import { test } from "node:test"

import { latLonToGaussBoaga } from "../crs.ts"
import { fromLocal } from "../geometry.ts"
import { PARTS, type Rect, gaussBoagaBox, inRects, partOf, rectsBox } from "../region.ts"

/** An L: a 200 by 100 m foot and a 100 by 200 m leg on its west half, the notch at its north-east. */
const L: ReadonlyArray<Rect> = [
  [0, 0, 200, 100],
  [0, 100, 100, 300],
]

test("partOf gives the part with the key: lucido is today's map", () => {
  const lucido = partOf("lucido")
  assert.equal(lucido.title, "Valle del Lucido")
  assert.deepEqual(lucido.rects, [[-2900, -6100, 4900, 3900]])
})

test("partOf without a known key throws naming every key", () => {
  const keys = PARTS.map((p) => p.key)
  for (const key of [undefined, "nope"]) {
    assert.throws(
      () => partOf(key),
      (error: Error) =>
        error.message.startsWith(`unknown part ${key}: use one of `) &&
        keys.every((k) => error.message.includes(k)),
    )
  }
})

test("every part has a unique key and rectangles on 100 m multiples", () => {
  assert.equal(new Set(PARTS.map((p) => p.key)).size, PARTS.length)
  for (const { key, rects } of PARTS) {
    assert.ok(rects.length > 0, key)
    for (const [x0, y0, x1, y1] of rects) {
      assert.ok(x0 < x1 && y0 < y1, key)
      assert.ok(
        [x0, y0, x1, y1].every((v) => v % 100 === 0),
        key,
      )
    }
  }
})

test("inRects holds inside either rectangle and on their edges, not in the notch or outside", () => {
  assert.ok(inRects(L, 150, 50))
  assert.ok(inRects(L, 50, 250))
  assert.ok(inRects(L, 200, 100))
  assert.ok(inRects(L, 0, 300))
  assert.ok(!inRects(L, 150, 200))
  assert.ok(!inRects(L, 101, 101))
  assert.ok(!inRects(L, -1, 50))
  assert.ok(!inRects(L, 50, 301))
})

test("rectsBox is the box round every rectangle", () => {
  assert.deepEqual(rectsBox(L), [0, 0, 200, 300])
  assert.deepEqual(rectsBox(partOf("lucido").rects), [-2900, -6100, 4900, 3900])
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
