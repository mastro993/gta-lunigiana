import assert from "node:assert/strict"
import { test } from "node:test"

import {
  type Layers,
  type Polygon,
  coverageImage,
  coverageTable,
  gridOver,
  mask,
  paint,
  playMask,
  tally,
} from "../coverage-grid.ts"
import type { Rect } from "../region.ts"

/** The axis-aligned box [x0, y0]–[x1, y1] as a one-ring polygon. */
const box = (x0: number, y0: number, x1: number, y1: number): Polygon => [
  [x0, y0, x1, y0, x1, y1, x0, y1],
]
const count = (cells: Uint16Array, value: number): number => cells.filter((v) => v === value).length

/** A 100 × 100 m grid of 10 m cells. */
const grid = gridOver([[0, 0, 100, 100]], 10)

test("gridOver and playMask: the grid spans the rectangles' box, the play area only their cells", () => {
  const rects: ReadonlyArray<Rect> = [
    [0, 0, 100, 50],
    [100, 0, 150, 100],
  ]
  const g = gridOver(rects, 10)
  assert.deepEqual(g, { x0: 0, y0: 0, res: 10, cols: 15, rows: 10 })
  const play = playMask(g, rects)
  assert.equal(count(play, 1), 10 * 5 + 5 * 10)
  assert.equal(play[9 * 15 + 0], 0, "the north-west cell lies outside both rectangles")
  assert.equal(play[9 * 15 + 14], 1, "the north-east cell lies in the second")
})

test("paint: a cell takes the value of the first layer that holds it", () => {
  const a = { value: 1, polygons: [box(0, 0, 60, 60)] },
    b = { value: 2, polygons: [box(40, 40, 100, 100)] }
  const ab = paint(grid, [a, b])
  assert.deepEqual([count(ab, 1), count(ab, 2), count(ab, 0)], [36, 32, 32])
  const ba = paint(grid, [b, a])
  assert.deepEqual([count(ba, 1), count(ba, 2), count(ba, 0)], [32, 36, 32])
})

test("mask: holes stay empty, and overlapping polygons add up instead of cancelling", () => {
  const holed: Polygon = [...box(0, 0, 100, 100), ...box(20, 20, 80, 80)]
  assert.equal(count(mask(grid, [holed]), 1), 100 - 36)
  assert.equal(count(mask(grid, [box(0, 0, 60, 60), box(40, 40, 100, 100)]), 1), 36 + 36 - 4)
})

/**
 * The play area is y 0–80; comune 1 is x 0–50, comune 2 x 50–100. The CTR maps x 0–30, y 0–20.
 * Lot 1 holds y 0–50, lot 2 x 0–70 (first wins); x 70–100, y 50–80 has no LiDAR. The UCS woods
 * are y 60–80, OSM forest x 0–60, y 70–100.
 */
const layers = (): Layers => ({
  play: playMask(grid, [[0, 0, 100, 80]]),
  comune: paint(grid, [
    { value: 1, polygons: [box(0, 0, 50, 100)] },
    { value: 2, polygons: [box(50, 0, 100, 100)] },
  ]),
  ctr: mask(grid, [box(0, 0, 30, 20)]),
  lot: paint(grid, [
    { value: 1, polygons: [box(0, 0, 100, 50)] },
    { value: 2, polygons: [box(0, 0, 70, 100)] },
  ]),
  ucs: mask(grid, [box(0, 60, 100, 80)]),
  osm: mask(grid, [box(0, 70, 60, 100)]),
})

test("tally: per comune, the play-area cells each source maps", () => {
  assert.deepEqual(tally(layers(), ["Uno", "Due"], 2), [
    { name: "Uno", cells: 40, ctr: 6, lots: [25, 15], none: 0, ucs: 10, osm: 5, both: 5 },
    { name: "Due", cells: 40, ctr: 0, lots: [25, 6], none: 9, ucs: 10, osm: 1, both: 1 },
  ])
})

test("tally: play-area cells outside every comune make a row of their own", () => {
  const rows = tally(
    { ...layers(), comune: paint(grid, [{ value: 1, polygons: [box(0, 0, 50, 100)] }]) },
    ["Uno"],
    2,
  )
  assert.deepEqual(
    rows.map((r) => [r.name, r.cells]),
    [
      ["Uno", 40],
      ["(no comune)", 40],
    ],
  )
})

test("coverageTable: km² and shares per comune, and a total row", () => {
  // 100 m cells, so one cell is 0.01 km².
  const lines = coverageTable(tally(layers(), ["Uno", "Due"], 2), ["004", "005"], 100 * 100).split(
    "\n",
  )
  assert.equal(lines.length, 5)
  assert.match(
    lines[0]!,
    /^\| Comune \| Play area, km² \| CTR 2019 \| LiDAR 004 \| LiDAR 005 \| no LiDAR \|/,
  )
  assert.equal(
    lines[2],
    "| Uno | 0.40 | 0.06 (15.0%) | 0.25 (62.5%) | 0.15 (37.5%) | 0.00 (0.0%) | 0.10 | 0.05 | 50.0% |",
  )
  assert.equal(
    lines[4],
    "| **Total** | 0.80 | 0.06 (7.5%) | 0.50 (62.5%) | 0.21 (26.3%) | 0.09 (11.3%) | 0.20 | 0.06 | 30.0% |",
  )
})

test("coverageImage: lots in their colours, no LiDAR red, the CTR lighter, north up", () => {
  const rgb = coverageImage(grid, layers(), ["004", "005"])
  const at = (col: number, rowFromTop: number) =>
    [...rgb.subarray((rowFromTop * 10 + col) * 3, (rowFromTop * 10 + col) * 3 + 3)].join(",")
  assert.equal(at(3, 0), "150,150,150", "outside the play area (north): grey")
  assert.equal(at(8, 3), "215,45,45", "no LiDAR: red")
  assert.equal(at(7, 7), "70,160,70", "lot 004: green")
  assert.equal(at(2, 4), "70,110,210", "lot 005: blue")
  assert.notEqual(at(1, 9), "70,160,70", "the CTR lightens the lot below it")
  assert.equal(at(4, 6), "25,25,25", "the comune boundary: dark")
})
