import assert from "node:assert/strict"
import { test } from "node:test"

import { latLonToGaussBoaga } from "../crs.ts"
import { type Crop, MARGIN, ascHeader, cropOf, eachCell } from "../dtm-mosaic.ts"
import { BOUNDS, fromLocal } from "../geometry.ts"
import { partOf } from "../region.ts"

test("cropOf(lucido) is the crop fetch-rt mosaicked before the parts, on the tiles' cell centres", () => {
  const crop = cropOf(partOf("lucido").rects)
  assert.equal(crop.e0 % 1, 0.5)
  assert.equal(crop.n0 % 1, 0.5)
  // fetch-rt's formula before region.ts: the play area's corners, MARGIN out, floored to x.5.
  const corners = [
    [BOUNDS.minX, BOUNDS.minY],
    [BOUNDS.maxX, BOUNDS.minY],
    [BOUNDS.minX, BOUNDS.maxY],
    [BOUNDS.maxX, BOUNDS.maxY],
  ].map(([x, y]) => latLonToGaussBoaga(...fromLocal(x!, y!)))
  const e0 = Math.floor(Math.min(...corners.map((c) => c[0])) - MARGIN) + 0.5,
    n0 = Math.floor(Math.min(...corners.map((c) => c[1])) - MARGIN) + 0.5
  const cols = Math.ceil(Math.max(...corners.map((c) => c[0])) + MARGIN - e0) + 1,
    rows = Math.ceil(Math.max(...corners.map((c) => c[1])) + MARGIN - n0) + 1
  assert.deepEqual(crop, { e0, n0, cols, rows })
  assert.equal(MARGIN, 32)
})

test("ascHeader reads the six header lines, keys lower-cased", () => {
  assert.deepEqual(
    ascHeader([
      "ncols        3",
      "NROWS 2",
      "  xllcenter 100.5",
      "yllcenter\t200.5\r",
      "cellsize 1",
      "NODATA_value  -9999",
      "1 2 3",
    ]),
    { ncols: 3, nrows: 2, xllcenter: 100.5, yllcenter: 200.5, cellsize: 1, nodata_value: -9999 },
  )
})

/** A 3 by 2 tile, rows north first: cell centres e 100.5..102.5, n 201.5 (first row) and 200.5. */
const TILE = [
  "ncols 3",
  "nrows 2",
  "xllcenter 100.5",
  "yllcenter 200.5",
  "cellsize 1",
  "NODATA_value -9999",
  " 1 2 312.47 \r",
  "4 -9999 6\r",
  "",
]

/** The cells `eachCell` writes, in call order. */
const cells = (lines: ReadonlyArray<string>, crop: Crop): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  eachCell(lines, crop, "tile", (k, z) => out.push([k, z]))
  return out
}

test("eachCell writes the tile's data cells inside the crop, k = row × cols + col, row 0 south", () => {
  // The crop starts one column east of the tile: the tile's west column falls outside.
  const crop: Crop = { e0: 101.5, n0: 200.5, cols: 5, rows: 3 }
  // The north row is crop row 1 (k 5, 6); the south row is row 0, its middle cell nodata.
  assert.deepEqual(cells(TILE, crop), [
    [5, 2],
    [6, 312.47],
    [1, 6],
  ])
  // A crop south of the tile's north row and west of its east column.
  assert.deepEqual(cells(TILE, { e0: 99.5, n0: 199.5, cols: 3, rows: 2 }), [[1 * 3 + 1, 4]])
  // A crop the tile misses.
  assert.deepEqual(cells(TILE, { e0: 200.5, n0: 200.5, cols: 4, rows: 4 }), [])
})

test("eachCell throws naming the tile when its cells are not 1 m", () => {
  const coarse = TILE.with(4, "cellsize 2")
  assert.throws(
    () => cells(coarse, { e0: 100.5, n0: 200.5, cols: 3, rows: 2 }),
    /^Error: tile: cell size 2$/,
  )
})
