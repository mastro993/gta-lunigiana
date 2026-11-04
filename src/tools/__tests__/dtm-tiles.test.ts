import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { cropOf, MARGIN } from "../dtm-mosaic.ts"
import {
  CELL,
  type DtmTile,
  HALO,
  LATTICE,
  assembleTiles,
  blockOf,
  cellsOver,
  cropOver,
  decodeTile,
  drawEdgesOn,
  emptyTile,
  encodeTile,
  intersect,
  partTiles,
  tileCut,
  tileGrid,
  tileKeys,
  tileNeed,
  tileRect,
} from "../dtm-tiles.ts"
import { NONE } from "../fill-chain.ts"
import { gaussBoagaBox } from "../geometry.ts"
import type { Rect } from "../region.ts"

const NAMES = ["lidar", "dsm2021", "dtm10", "lig", "rer"]

/** A small block of cells on the lattice, heights from `h`, NONE where `h` gives NaN. */
const block = (
  e0: number,
  n0: number,
  cols: number,
  rows: number,
  h: (c: number, r: number) => number,
): DtmTile => {
  const dm = new Int16Array(cols * rows),
    codes = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const v = h(c, r)
      if (Number.isNaN(v)) codes[r * cols + c] = NONE
      else dm[r * cols + c] = v
    }
  return { e0, n0, cols, rows, names: NAMES, dm, codes }
}

test("a tile's file reads back its heights and sources, the cells without one as none", () => {
  const t = block(LATTICE.e, LATTICE.n, 5, 3, (c, r) =>
    c === 2 && r === 1 ? Number.NaN : r === 2 ? -15 + 30000 * c : 1200 + 7 * c - 3 * r,
  )
  t.codes[0] = 2
  const back = decodeTile(encodeTile(t), "t")
  assert.deepEqual(back.codes, t.codes)
  for (let k = 0; k < t.dm.length; k++)
    if (t.codes[k] !== NONE) assert.equal(back.dm[k], t.dm[k], `cell ${k}`)
  assert.deepEqual(
    { e0: back.e0, n0: back.n0, cols: back.cols, rows: back.rows, names: back.names },
    { e0: t.e0, n0: t.n0, cols: 5, rows: 3, names: NAMES },
  )
  assert.throws(() => decodeTile(encodeTile(t).subarray(0, -1), "cut"), /^Error: cut: /)
})

test("every tile's file lies on the lattice and holds its square's EPSG:3003 box widened by HALO", () => {
  for (const [i, j] of [
    [0, 0],
    [-3, 6],
    [5, -4],
  ] as const) {
    const g = tileGrid(i, j),
      [e0, n0, e1, n1] = gaussBoagaBox([tileRect(i, j)], HALO)
    assert.ok((g.e0 - LATTICE.e) % CELL === 0 && (g.n0 - LATTICE.n) % CELL === 0)
    assert.ok(g.e0 >= e0 && g.e0 - CELL < e0 && g.n0 >= n0 && g.n0 - CELL < n0)
    const e = g.e0 + CELL * (g.cols - 1),
      n = g.n0 + CELL * (g.rows - 1)
    assert.ok(e <= e1 && e + CELL > e1 && n <= n1 && n + CELL > n1)
  }
})

// Regression: the cells a tile needs reached one past lucido's pinned mosaic at its south edge, so
// the build refused the mosaic's own cells cut into tiles.
test("the cells lucido's tiles need lie in the mosaic fetch-rt cut over its rectangle", () => {
  const lucido: Rect = [-2900, -6100, 4900, 3900],
    bounds = { minX: -2900, minY: -6100, maxX: 4900, maxY: 3900 }
  const crop = cropOf([lucido])
  // The 2 m cells of the mosaic: the 1 m crop's pairs, centred 0.5 m past their first cell.
  const e0 = crop.e0 + 0.5,
    n0 = crop.n0 + 0.5,
    e1 = e0 + CELL * (Math.floor(crop.cols / 2) - 1),
    n1 = n0 + CELL * (Math.floor(crop.rows / 2) - 1)
  assert.ok((e0 - LATTICE.e) % CELL === 0, "lucido's mosaic is the lattice")
  for (let j = -4; j <= 1; j++)
    for (let i = -2; i <= 2; i++) {
      const need = tileNeed(i, j, bounds)!
      assert.ok(need.e0 >= e0 && need.n0 >= n0, `tile ${i}_${j} starts before the mosaic`)
      assert.ok(
        need.e0 + CELL * (need.cols - 1) <= e1 && need.n0 + CELL * (need.rows - 1) <= n1,
        `tile ${i}_${j} ends past the mosaic`,
      )
    }
  // And the box the mosaic was cut for, its margin the tiles' halo.
  assert.equal(MARGIN, HALO)
  const all = cellsOver(gaussBoagaBox([lucido], MARGIN))
  assert.deepEqual([all.e0, all.n0], [e0, n0])
})

test("a tile needs its square cut to the region's box, and none of a tile wholly past it", () => {
  const bounds = { minX: -5300, minY: -6100, maxX: 10100, maxY: 13000 }
  const inner = tileNeed(0, 0, bounds)!,
    edge = tileNeed(5, 6, bounds)!
  assert.deepEqual(inner, tileGrid(0, 0))
  assert.ok(edge.cols < tileGrid(5, 6).cols && edge.rows < tileGrid(5, 6).rows)
  assert.equal(tileNeed(6, 6, bounds), undefined)
})

test("assembleTiles joins tiles on the lattice, a cell two hold kept once, and refuses two heights for one cell", () => {
  const a = block(LATTICE.e, LATTICE.n, 3, 2, (c, r) => 100 + c + 10 * r),
    b = block(LATTICE.e + 2 * CELL, LATTICE.n, 3, 2, (c, r) => (c === 0 ? 102 + 10 * r : 200 + c))
  const { dtm, held } = assembleTiles([
    { key: "a", tile: a },
    { key: "b", tile: b },
  ])
  assert.deepEqual([dtm.e0, dtm.n0, dtm.cols, dtm.rows], [LATTICE.e, LATTICE.n, 5, 2])
  assert.deepEqual([...held], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
  assert.equal(dtm.z[2], Math.fround(10.2))
  assert.equal(dtm.z[4], Math.fround(20.2))
  const clash = block(LATTICE.e + 2 * CELL, LATTICE.n, 1, 1, () => 999)
  assert.throws(
    () =>
      assembleTiles([
        { key: "a", tile: a },
        { key: "c", tile: clash },
      ]),
    /tile c holds 99\.9 m \(lidar\) at EPSG:3003 1587401, 4884308, where another holds/,
  )
})

test("drawEdgesOn holds each edge's height past the cells held, as a sampler past a mosaic's edge did", () => {
  // Held: the 2 × 2 cells in the middle of a 4 × 4 block.
  const t = block(LATTICE.e, LATTICE.n, 4, 4, (c, r) =>
    c >= 1 && c <= 2 && r >= 1 && r <= 2 ? 10 * r + c : Number.NaN,
  )
  const { dtm, held } = assembleTiles([{ key: "t", tile: t }])
  drawEdgesOn(dtm, held)
  const z = (c: number, r: number) => Math.round(dtm.z[r * 4 + c]! * 10)
  assert.deepEqual(
    [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => z(c, r))),
    [
      [11, 11, 12, 12],
      [11, 11, 12, 12],
      [21, 21, 22, 22],
      [21, 21, 22, 22],
    ],
  )
})

test("an empty tile is its file's cells, none holding a height", () => {
  const t = emptyTile(1, -2, NAMES)
  assert.deepEqual([t.e0, t.n0, t.cols, t.rows], Object.values(tileGrid(1, -2)))
  assert.ok(t.codes.every((c) => c === NONE))
})

test("a part's tiles are those its rectangles meet, each needing its square cut to the region's box, an L's notch tile none", () => {
  // An L round the corner of four tiles: the north-east tile, its notch, is not the part's.
  const rects: ReadonlyArray<Rect> = [
      [1800, 1800, 2000, 2200],
      [2000, 1800, 2200, 2000],
    ],
    bounds = { minX: 1800, minY: 1800, maxX: 2200, maxY: 2200 }
  const tiles = partTiles(rects, bounds)
  assert.deepEqual(
    tiles.map(({ i, j }) => `${i}_${j}`),
    ["0_0", "1_0", "0_1"],
  )
  for (const { i, j, need } of tiles) assert.deepEqual(need, tileNeed(i, j, bounds))
  assert.deepEqual(tileCut(0, 1, bounds), [1800, 2000, 2000, 2200])
  assert.equal(tileCut(3, 0, bounds), undefined)
  // The block round them holds each, and its 1 m crop lies on the LiDAR's cell centres, two to a
  // lattice cell.
  const block = blockOf(tiles.map((t) => t.need))
  for (const { need } of tiles) assert.deepEqual(intersect(need, block), need)
  assert.deepEqual(blockOf([tiles[0]!.need, block]), block)
  assert.deepEqual(cropOver(block), {
    e0: block.e0 - 0.5,
    n0: block.n0 - 0.5,
    cols: 2 * block.cols,
    rows: 2 * block.rows,
  })
})

test("tileKeys lists the tile files in a folder, by name, and none of a folder that is not there", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dtm-tiles-test-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const name of ["0_-1.bin", "-2_3.bin", "1_0.bin", ".DS_Store", "1_0.tif", "notes.bin"])
    writeFileSync(join(dir, name), "")
  assert.deepEqual(tileKeys(dir), [
    { i: -2, j: 3 },
    { i: 0, j: -1 },
    { i: 1, j: 0 },
  ])
  assert.deepEqual(tileKeys(join(dir, "missing")), [])
})
