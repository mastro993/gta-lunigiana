import assert from "node:assert/strict"
import { test } from "node:test"

import { makeRaster, rasterPen, straightRgba } from "../paint-raster.ts"

/** A 40 × 40 px raster one metre a pixel, north up, and its pen (widths 1:1), and a reader of its pixels. */
const canvas = () => {
  const raster = makeRaster(40, 40)
  const pen = rasterPen(raster, { u: (x) => x, v: (y) => 40 - y }, 1)
  const at = (u: number, v: number) => [
    ...raster.pixels.subarray(4 * (v * 40 + u), 4 * (v * 40 + u) + 4),
  ]
  return { raster, pen, at }
}
const RED = 0xff0000
const square = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1]

test("a fill covers the pixels inside, and a pixel half inside by half, by either rule", () => {
  const { pen, at } = canvas()
  pen.fill([square(10, 10, 20.5, 20)], RED, "evenodd")
  assert.deepEqual(at(15, 25), [255, 0, 0, 255])
  assert.deepEqual(at(20, 25), [128, 0, 0, 128], "half covered")
  assert.deepEqual(at(21, 25), [0, 0, 0, 0])
  // a ring inside another, both counter-clockwise: a hole by the even-odd rule, filled by the non-zero
  const rings = [square(0, 0, 9, 9), square(3, 3, 6, 6)]
  const evenodd = canvas(),
    nonzero = canvas()
  evenodd.pen.fill(rings, RED, "evenodd")
  nonzero.pen.fill(rings, RED, "nonzero")
  assert.deepEqual(
    [evenodd.at(4, 35), nonzero.at(4, 35)],
    [
      [0, 0, 0, 0],
      [255, 0, 0, 255],
    ],
  )
  assert.deepEqual(evenodd.at(1, 38), [255, 0, 0, 255])
})

test("a stroke covers its width with round ends, each pixel once however many segments reach it", () => {
  const { raster, pen, at } = canvas()
  // 4 px wide along v = 20.5 from u = 10.5, there and most of the way back
  pen.stroke([10.5, 19.5, 30.5, 19.5, 12.5, 19.5], 4, RED, 0.5)
  const [full, half, none] = [
    [128, 0, 0, 128],
    [64, 0, 0, 64],
    [0, 0, 0, 0],
  ]
  assert.deepEqual(at(20, 20), full, "drawn once at half opacity")
  // pixel centres 1 px off it inside, 2 px off on its edge (half covered), 3 px off outside
  assert.deepEqual(
    [19, 21, 18, 22, 23].map((v) => at(20, v)),
    [full, full, half, half, none],
  )
  assert.deepEqual(
    [31, 32, 33].map((u) => at(u, 20)),
    [full, half, none],
    "a round end",
  )
  assert.deepEqual(
    straightRgba(raster).subarray(4 * (20 * 40 + 20), 4 * (20 * 40 + 21)),
    Uint8Array.from([255, 0, 0, 128]),
  )
})

test("a clip lets paint through by its coverage", () => {
  const { pen, at } = canvas()
  pen.clip([square(0, 0, 20.5, 40)])
  pen.fill([square(0, 0, 40, 40)], RED, "evenodd")
  assert.deepEqual(
    [at(10, 10), at(20, 10), at(30, 10)],
    [
      [255, 0, 0, 255],
      [128, 0, 0, 128],
      [0, 0, 0, 0],
    ],
  )
})
