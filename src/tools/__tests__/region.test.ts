import assert from "node:assert/strict"
import { test } from "node:test"

import { PARTS, type Rect, inRects, partOf, rectsBox, regionFromArgs } from "../region.ts"

test("the default build keeps the pinned Lunigiana map", () => {
  const region = regionFromArgs([])
  assert.equal(region.id, "lunigiana")
  assert.equal(region.file, "monzone")
  assert.deepEqual(region.origin, { lat: 44.16175, lon: 10.13 })
})

test("Cesena is a separate city-centre map", () => {
  const region = regionFromArgs(["--region", "cesena"])
  assert.equal(region.file, "cesena")
  assert.ok(region.origin.lat > 44.13 && region.origin.lat < 44.15)
  assert.ok(region.origin.lon > 12.23 && region.origin.lon < 12.26)
  assert.equal(region.bounds.maxX - region.bounds.minX, 4000)
  assert.equal(region.bounds.maxY - region.bounds.minY, 4000)
})

test("unknown regions and incomplete arguments fail before a fetch or build", () => {
  assert.throws(() => regionFromArgs(["--region", "unknown"]), /region/)
  assert.throws(() => regionFromArgs(["--region"]), /region/)
})

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
