import assert from "node:assert/strict"
import { test } from "node:test"

import { latLonToGaussBoaga } from "../crs.ts"
import type { Crop } from "../dtm-mosaic.ts"
import { type DtmTile, emptyTile, partTiles } from "../dtm-tiles.ts"
import { tileCrop } from "../fetch-dtm.ts"
import { OUT } from "../fill-chain.ts"
import { fromLocal } from "../geometry.ts"
import {
  OUTSIDE,
  earlierParts,
  elementsOverHoles,
  findHoles,
  keptAndPicked,
  needMask,
  replayPart,
  replayTile,
} from "../pick-lidar.ts"
import { type Part, type Rect, partOf } from "../region.ts"

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

/** A grid to replay: its name and its lines, as the archive's file gives them. */
const grid = (name: string, e: number, n: number, rows: ReadonlyArray<string>) => ({
  name,
  lines: () => asc(e, n, rows),
})

test("the earlier parts' tiles write first, then the candidates; a cell out of the replay or held never counts", () => {
  // Column 5 is out of the replay (no tile of the part needs it); cell (0, 0) a tile file holds.
  const written = new Uint8Array(CROP.cols * CROP.rows)
  for (let r = 0; r < CROP.rows; r++) written[r * CROP.cols + 5] = OUTSIDE
  written[0] = 1
  const replayed = replayPart(
    written,
    CROP,
    // An earlier part's tile over columns 0–1: all but the held cell are its.
    [grid("earlier", 1000.5, 2000.5, ["##", "##", "##", "##"])],
    [
      // Under the earlier part's tile: dropped, though it comes first among the candidates.
      grid("under", 1000.5, 2000.5, ["##", "##", "##", "##"]),
      // Columns 4–5: only column 4 is needed.
      grid("edge", 1004.5, 2000.5, ["##", "##", "##", "##"]),
      // Column 5 alone: nothing it holds is needed.
      grid("out", 1005.5, 2000.5, ["#", "#", "#", "#"]),
      // Columns 2–3, the two south rows.
      grid("south", 1002.5, 2000.5, ["##", "##"]),
    ],
  )
  assert.deepEqual(replayed, {
    earlier: 7,
    candidates: [
      { inCrop: 8, first: 0 },
      { inCrop: 4, first: 4 },
      { inCrop: 0, first: 0 },
      { inCrop: 4, first: 4 },
    ],
  })
  // The cells out of the replay are never holes: the one hole is the north of columns 2–3.
  const holes = findHoles(written, CROP.cols, CROP.rows)
  assert.deepEqual([holes.cells, holes.count], [4, 1])
  assert.deepEqual(picture(written), ["112213", "112213", "111113", "111113"])
})

test("the earlier parts are those before a part in build order; a test region's part has none", () => {
  const part = (key: string): Part => ({ key, title: key, rects: [[0, 0, 100, 100]] })
  const [a, b, c] = [part("a"), part("b"), part("c")]
  assert.deepEqual(earlierParts(c, [a, b, c]), [a, b])
  assert.deepEqual(earlierParts(a, [a, b, c]), [])
  assert.deepEqual(earlierParts(part("x"), [a, b, c]), [])
  assert.deepEqual(earlierParts(partOf("lucido")), [])
  assert.deepEqual(earlierParts(partOf("sillara")), [])
})

/** A tile file of tile (i, j) holding a height (dm 500, the LiDAR's) at each cell `holds` picks. */
const heldTile = (i: number, j: number, holds: (c: number, r: number) => boolean): DtmTile => {
  const t = emptyTile(i, j, ["lidar"])
  for (let r = 0; r < t.rows; r++)
    for (let c = 0; c < t.cols; c++)
      if (holds(c, r)) {
        t.dm[r * t.cols + c] = 500
        t.codes[r * t.cols + c] = 0
      }
  return t
}

test("the mask leaves to the replay exactly the cells fetch-rt's crop leaves to the LiDAR, an L's notch out", () => {
  // An L round the corner of four tiles, in a region no wider: its notch tile is not the part's.
  const rects: ReadonlyArray<Rect> = [
      [1800, 1800, 2000, 2200],
      [2000, 1800, 2200, 2000],
    ],
    needs = partTiles(rects, { minX: 1800, minY: 1800, maxX: 2200, maxY: 2200 }).map((t) => t.need)
  // Tile 0_0's file holds a scatter of its cells; the notch tile's holds all of its own.
  const held = [heldTile(0, 0, (c, r) => (c * 7 + r * 3) % 5 === 0), heldTile(1, 1, () => true)]
  const mask = needMask(needs, held),
    seeded = tileCrop(needs, held)
  assert.deepEqual(mask.crop, seeded.crop)
  for (let k = 0; k < mask.written.length; k++)
    if ((mask.written[k] === 0) !== Number.isNaN(seeded.mosaic.dm[k]!))
      assert.fail(`1 m cell ${k}: mask ${mask.written[k]}, crop ${seeded.mosaic.dm[k]}`)
  // Without the held files, the cells out of the replay are those fetch-rt leaves out.
  const bare = needMask(needs, []),
    unseeded = tileCrop(needs, [])
  for (let k = 0; k < bare.written.length; k++)
    if ((bare.written[k] === OUTSIDE) !== (unseeded.mosaic.src[k] === OUT))
      assert.fail(`1 m cell ${k}: mask ${bare.written[k]}, crop source ${unseeded.mosaic.src[k]}`)
  assert.equal(bare.needed, unseeded.empty)
  // The held files hold some of the needed cells, and none past them: the notch stays out.
  assert.equal(mask.needed, bare.needed)
  assert.equal(mask.held, mask.needed - seeded.empty)
  assert.ok(mask.held > 0 && seeded.empty > 0)
  const [e, n] = latLonToGaussBoaga(...fromLocal(2150, 2150))
  const notch = Math.round(n - mask.crop.n0) * mask.crop.cols + Math.round(e - mask.crop.e0)
  assert.equal(mask.written[notch], OUTSIDE)
})

test("a crop no tile touches is one hole", () => {
  const holes = findHoles(new Uint8Array(CROP.cols * CROP.rows), CROP.cols, CROP.rows)
  assert.deepEqual(holes, {
    cells: 24,
    count: 1,
    largest: { cells: 24, col: 2.5, row: 1.5, box: [0, 0, 5, 3] },
  })
})

/** CROP written whole but one hole cell (2, as findHoles marks it): col 4, row 2, centred on (1004.5, 2002.5). */
const oneHole = (): Uint8Array => {
  const written = new Uint8Array(CROP.cols * CROP.rows).fill(1)
  written[2 * CROP.cols + 4] = 2
  return written
}

/** An EPSG:3003 box (e0, n0)–(e1, n1) as one polygon of the index's footprint: its one ring, counter-clockwise. */
const box = (e0: number, n0: number, e1: number, n1: number) => [[e0, n0, e1, n0, e1, n1, e0, n1]]

/** An element of the 2021 surface model in the index: RT's, its archive answering 200, unless told. */
const element = (
  id: string,
  polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>,
  owner = "RT",
  status = 200,
) => ({ element: id, owner, status, polygons })

test("the surface model's elements over a hole are kept, by number; one over written cells only is not", () => {
  const kept = elementsOverHoles(
    [
      element("234051", [box(1003, 2001, 1006, 2004)]),
      element("234012", [box(1000, 2000, 1004, 2004)]),
      // Its first polygon over written cells, its second over the hole.
      element("234011", [box(1000, 2000, 1002, 2002), box(1004, 2002, 1005, 2003)]),
    ],
    oneHole(),
    CROP,
  )
  assert.deepEqual(kept, ["234011", "234051"])
})

test("an element is kept only when its footprint holds a hole cell's centre, not when it just overlaps the cell", () => {
  // Each misses the hole cell's centre (1004.5, 2002.5) by 0.1 m, one from the east, one from the north.
  const near = [
    element("234013", [box(1004.6, 2000, 1006, 2004)]),
    element("234014", [box(1003, 2002.6, 1006, 2004)]),
  ]
  assert.deepEqual(elementsOverHoles(near, oneHole(), CROP), [])
})

test("an element not RT's, or whose archive did not answer 200, is never kept, though over a hole", () => {
  const over = [box(1003, 2001, 1006, 2004)]
  const others = [
    element("234011", over, "MATTM"),
    element("234012", over, "RT", 404),
    // No HEAD answer recorded.
    { element: "234013", owner: "RT", polygons: over },
  ]
  assert.deepEqual(elementsOverHoles(others, oneHole(), CROP), [])
  assert.deepEqual(elementsOverHoles([element("234014", over)], oneHole(), CROP), ["234014"])
})

// Regression: --write on a fetched part (lucido, once Fivizzano grew the box) stored only the tiles
// for the cells the grown box added, dropping those that wrote its held cells.
test("--write keeps the manifest's tiles and elements and adds the new picks after them", () => {
  const { lidar, elements } = keptAndPicked(
    { lidar: ["b_004", "a_005"], dsm2021: ["249064"] },
    ["c_004", "b_004"],
    ["234123", "249064"],
  )
  assert.deepEqual(lidar, ["b_004", "a_005", "c_004"])
  assert.deepEqual(elements, ["234123", "249064"])
})
