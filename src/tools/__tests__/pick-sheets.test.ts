import assert from "node:assert/strict"
import { test } from "node:test"

import type { P } from "../geometry.ts"
import { areaInRects, disjointRects, pickSheets } from "../pick-sheets.ts"
import type { Rect } from "../region.ts"

/** A clockwise square (a shapefile's outer ring) from (x, y), `s` metres a side, closed. */
const square = (x: number, y: number, s: number): Array<P> => [
  [x, y],
  [x, y + s],
  [x + s, y + s],
  [x + s, y],
  [x, y],
]
const PLAY: ReadonlyArray<Rect> = [[0, 0, 1000, 1000]]

test("areaInRects counts only the area inside the play area", () => {
  assert.equal(areaInRects([[square(100, 100, 200)]], PLAY), 40_000)
  assert.equal(areaInRects([[square(900, 900, 200)]], PLAY), 10_000)
  assert.equal(areaInRects([[square(1100, 0, 200)]], PLAY), 0)
})

test("a hole, wound against its outer ring, is not mapped area", () => {
  const hole = square(200, 200, 100).toReversed()
  assert.equal(areaInRects([[square(100, 100, 300), hole]], PLAY), 80_000)
  assert.equal(areaInRects([[square(100, 100, 300)], [square(600, 600, 100)]], PLAY), 100_000)
})

test("a sheet that only touches the play area's edge meets it by no area and drops", () => {
  const areas = [
    { sheet: "23D05", azr: areaInRects([[square(1000, 200, 300)]], PLAY) },
    { sheet: "23D14", azr: areaInRects([[square(990, 200, 300)]], PLAY) },
    { sheet: "23D11", azr: areaInRects([[square(10, 10, 10)]], PLAY) },
  ]
  assert.equal(areas[0]!.azr, 0)
  assert.equal(areas[1]!.azr, 3000)
  assert.deepEqual(pickSheets(areas), ["23D11", "23D14"])
})

test("overlapping rectangles count shared ground once", () => {
  const rects = disjointRects([
    [0, 0, 1000, 1000],
    [500, 500, 1500, 1500],
  ])
  assert.equal(
    rects.reduce((s, [x0, y0, x1, y1]) => s + (x1 - x0) * (y1 - y0), 0),
    1_750_000,
  )
  assert.equal(areaInRects([[square(400, 400, 200)]], rects), 40_000)
  assert.equal(areaInRects([[square(-100, -100, 2000)]], rects), 1_750_000)
})
