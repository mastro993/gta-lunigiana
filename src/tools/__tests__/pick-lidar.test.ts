import assert from "node:assert/strict"
import { test } from "node:test"

import type { Crop } from "../dtm-mosaic.ts"
import { findHoles, replayTile } from "../pick-lidar.ts"

const NODATA = -9999

/** An ESRI ASCII grid's lines: 1 m cells, `rows` north first, the south-west cell centred on (e, n). */
const asc = (e: number, n: number, rows: ReadonlyArray<string>): Array<string> => [
  `ncols ${rows[0]!.length}`,
  `nrows ${rows.length}`,
  `xllcenter ${e}`,
  `yllcenter ${n}`,
  "cellsize 1",
  `NODATA_value ${NODATA}`,
  ...rows.map((r) =>
    r
      .split("")
      .map((ch) => (ch === "." ? NODATA : 100))
      .join(" "),
  ),
]

/** A 6 × 4 m crop, cell (0, 0) centred on (1000.5, 2000.5). */
const CROP: Crop = { e0: 1000.5, n0: 2000.5, cols: 6, rows: 4 }

/** The crop's cells as text, north row first: 1 written, 0 not, 2 a hole found. */
const picture = (mask: Uint8Array): Array<string> =>
  Array.from({ length: CROP.rows }, (_, r) =>
    [...mask.subarray((CROP.rows - 1 - r) * CROP.cols, (CROP.rows - r) * CROP.cols)].join(""),
  )

test("a tile is kept for the cells no earlier tile gave; one wholly under earlier tiles gives none", () => {
  const written = new Uint8Array(CROP.cols * CROP.rows)
  // West tile: 3 × 4 cells with one nodata cell; it hangs 1 m past the crop's west edge.
  const west = replayTile(written, CROP, asc(999.5, 2000.5, ["####", "##.#", "####", "####"]), "w")
  assert.deepEqual(west, { inCrop: 11, first: 11 })
  // East tile overlaps the west one by a column, rows 1-3: it gives the 6 cells east of it.
  const east = replayTile(written, CROP, asc(1002.5, 2001.5, ["###", "###", "###"]), "e")
  assert.deepEqual(east, { inCrop: 9, first: 6 })
  // A tile inside cells already written gives nothing: dropped.
  assert.deepEqual(replayTile(written, CROP, asc(1000.5, 2000.5, ["##"]), "d"), {
    inCrop: 2,
    first: 0,
  })
  // A tile outside the crop has no cell in it.
  assert.deepEqual(replayTile(written, CROP, asc(2000.5, 2000.5, ["##"]), "o"), {
    inCrop: 0,
    first: 0,
  })
  // The west tile's nodata cell and the east column stay unwritten.
  assert.deepEqual(picture(written), ["111110", "101110", "111110", "111000"])
})

test("holes are counted by cell and by 4-connected run, the largest located", () => {
  const written = new Uint8Array(CROP.cols * CROP.rows)
  replayTile(written, CROP, asc(1000.5, 2000.5, ["#.####", "##.###", "######", "#...##"]), "t")
  const holes = findHoles(written, CROP.cols, CROP.rows)
  // Two diagonal cells are two holes; the south run of three is the largest.
  assert.equal(holes.cells, 5)
  assert.equal(holes.count, 3)
  assert.deepEqual(holes.largest, { cells: 3, col: 2, row: 0, box: [1, 0, 3, 0] })
  assert.deepEqual(picture(written), ["121111", "112111", "111111", "122211"])
})

test("a crop no tile touches is one hole", () => {
  const holes = findHoles(new Uint8Array(CROP.cols * CROP.rows), CROP.cols, CROP.rows)
  assert.deepEqual(holes, {
    cells: 24,
    count: 1,
    largest: { cells: 24, col: 2.5, row: 1.5, box: [0, 0, 5, 3] },
  })
})
