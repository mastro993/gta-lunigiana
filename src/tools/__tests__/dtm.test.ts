import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type TestContext, test } from "node:test"
import { deflateSync } from "node:zlib"

import { gaussBoagaToLatLon, latLonToGaussBoaga } from "../crs.ts"
import {
  CELL,
  type Cells,
  emptyTile,
  encodeTile,
  LATTICE,
  tileGrid,
  tileNeed,
  tilePath,
} from "../dtm-tiles.ts"
import { type DtmData, dtmDem, loadDtm, readDtm, readTiles, sourceAreas } from "../dtm.ts"
import { NONE } from "../fill-chain.ts"
import { fromLocal, toLocal } from "../geometry.ts"
import { gridLattice, makeGrid, type Span } from "../terrain.ts"
import { first, grown, points } from "./grounds.ts"

/** The sources a DTM's cells are coded by, in `terrain-sources.ts`'s order. */
const NAMES = ["lidar", "dsm2021", "dtm10", "rer"]

/**
 * A 2 m DTM of 400 × 300 cells round local (0, 0), its heights a rough hill in decimetres, so
 * every sample interpolates between four different heights, all from the LiDAR.
 */
const dtm = (): DtmData => {
  const [e, n] = latLonToGaussBoaga(...fromLocal(0, 0))
  const cols = 400,
    rows = 300
  const z = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      z[r * cols + c] = Math.round(2000 + 3 * c - 2 * r + ((c * 7919 + r * 104729) % 97)) / 10
  const sources = { names: NAMES, codes: new Uint8Array(cols * rows) }
  return { e0: Math.floor(e) - 401, n0: Math.floor(n) - 300, cols, rows, cell: 2, z, sources }
}

test("a DTM's grid windows are makeGrid's nodes on its sampler, bit for bit", () => {
  const dem = dtmDem(dtm())
  const { x0, y0, cell, cols, rows } = gridLattice()
  const at = (x: number, y: number) => ({
    i0: Math.round((x - x0) / cell),
    j0: Math.round((y - y0) / cell),
  })
  const spans: ReadonlyArray<Span> = [
    // On the DTM, across several of the projection lattice's 50 m rows and columns.
    { ...at(-300, -250), cols: 151, rows: 126 },
    // Past its crop to the north-east, where it holds the edge value.
    { ...at(700, 500), cols: 40, rows: 31 },
    // The grid's south-west and north-east corners, whose boxes reach past the built terrain.
    { i0: 0, j0: 0, cols: 7, rows: 5 },
    { i0: cols - 6, j0: rows - 9, cols: 6, rows: 9 },
  ]
  for (const span of spans) {
    const fast = dem.grid(span),
      slow = makeGrid(dem.at, span)
    assert.deepEqual(fast.span, span)
    assert.equal(fast.z.length, slow.z.length)
    for (let k = 0; k < slow.z.length; k++)
      if (!Object.is(fast.z[k], slow.z[k]))
        assert.fail(`span ${JSON.stringify(span)} node ${k}: ${fast.z[k]} != ${slow.z[k]}`)
  }
})

// Regression: the projection lattice and the grid's fractions were measured from the box's corner,
// so the 3× test region's terrain under lucido differed from lucido's in the last bits.
test("a DTM's heights and grid nodes keep their bits when the region's box grows round its anchor", () => {
  const a = dtmDem(dtm(), first),
    b = dtmDem(dtm(), grown)
  for (const [x, y] of points(2000))
    if (!Object.is(a.at(x, y), b.at(x, y)))
      assert.fail(`at(${x}, ${y}): ${a.at(x, y)} != ${b.at(x, y)}`)
  const la = gridLattice(first),
    lb = gridLattice(grown)
  const di = (la.x0 - lb.x0) / la.cell,
    dj = (la.y0 - lb.y0) / la.cell
  const span = { i0: 20, j0: 15, cols: 151, rows: 126 }
  const za = a.grid(span).z,
    zb = b.grid({ ...span, i0: span.i0 + di, j0: span.j0 + dj }).z
  for (let k = 0; k < za.length; k++)
    if (!Object.is(za[k], zb[k])) assert.fail(`node ${k}: ${za[k]} != ${zb[k]}`)
})

/**
 * `dtm()` with its west half (columns 0–199, west of local x -2.9 m) from the LiDAR and its east
 * half from the 10 m DTM.
 */
const halves = (): DtmData => {
  const d = dtm()
  const codes = new Uint8Array(d.cols * d.rows)
  for (let k = 0; k < codes.length; k++) codes[k] = k % d.cols < d.cols / 2 ? 0 : 2
  return { ...d, sources: { names: NAMES, codes } }
}

test("a DTM's source at a point is the source of the DTM cell nearest it", () => {
  const d = halves()
  const dem = dtmDem(d, first)
  assert.equal(dem.source?.(-200, 0), "lidar")
  assert.equal(dem.source?.(200, 0), "dtm10")
  // Half a metre either side of the seam, the midpoint of columns 199 and 200's centres (e0 + 398
  // and e0 + 400): the cell under a point is not always the one nearest it.
  const near = (e: number) => toLocal(...gaussBoagaToLatLon(d.e0 + e, d.n0 + 300))
  assert.equal(dem.source?.(...near(398.5)), "lidar")
  assert.equal(dem.source?.(...near(399.5)), "dtm10")
})

/** A temporary directory, removed when `t` ends. */
const tempDir = (t: TestContext) => {
  const dir = mkdtempSync(join(tmpdir(), "dtm-test-"))
  t.after(() => rmSync(dir, { recursive: true }))
  return dir
}

/**
 * Writes `d` into `dir` as fetch-rt does: dtm.json, dtm.bin (int16le decimetres, each row
 * delta-coded from its first value, deflated) and dtm-src.bin (`codes`, deflated).
 */
const write = (dir: string, d: DtmData, codes = d.sources.codes) => {
  const { z, sources, ...meta } = d
  const dm = Int16Array.from(z, (h) => Math.round(h * 10))
  const deltas = dm.map((v, k) => (k % d.cols === 0 ? v : v - dm[k - 1]!))
  writeFileSync(join(dir, "dtm.json"), JSON.stringify({ ...meta, sources: sources.names }))
  writeFileSync(join(dir, "dtm.bin"), deflateSync(Buffer.from(deltas.buffer)))
  writeFileSync(join(dir, "dtm-src.bin"), deflateSync(codes))
}

/** A 3 × 2 DTM whose second row starts far below where the first ends, a cell from each source. */
const tiny = (): DtmData => ({
  e0: 1_580_000.5,
  n0: 4_890_000.5,
  cols: 3,
  rows: 2,
  cell: 2,
  z: Float32Array.from([1203, 1198, 1250, -15, 0, 4321], (dm) => dm / 10),
  sources: { names: NAMES, codes: Uint8Array.from([0, 0, 2, 3, 1, 0]) },
})

test("readDtm reads back the heights and sources fetch-rt writes, each row from its own first height", (t) => {
  const dir = tempDir(t),
    d = tiny()
  write(dir, d)
  assert.deepEqual(readDtm(dir), d)
})

test("readDtm throws when dtm-src.bin does not hold one source per cell", (t) => {
  const dir = tempDir(t)
  write(dir, tiny(), new Uint8Array(5))
  assert.throws(() => readDtm(dir), /dtm-src\.bin: 5 cells, not 6$/)
})

test("loadDtm samples the DTM fetch-rt wrote as dtmDem samples it, its sources included", (t) => {
  const dir = tempDir(t),
    d = halves()
  write(dir, d)
  const read = loadDtm(dir, { ...first, ownTerrain: true, test: true, tiles: [] }),
    made = dtmDem(d, first)
  for (const [x, y] of points(200)) {
    if (!Object.is(read.at(x, y), made.at(x, y)))
      assert.fail(`at(${x}, ${y}): ${read.at(x, y)} != ${made.at(x, y)}`)
    assert.equal(read.source?.(x, y), made.source?.(x, y))
  }
})

/**
 * What `readTiles` reads of a region with two tiles side by side, its box tile 0_0 and the west
 * half of 1_0: the shipped map's (`test` false) or a test region's.
 */
const pair = (test: boolean) => ({
  ownTerrain: false,
  test,
  tiles: [
    { i: 0, j: 0 },
    { i: 1, j: 0 },
  ],
  bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 2000 },
  anchor: { x: 0, y: 0 },
})

/** The centre in EPSG:3003 of the cell in the middle of `b`. */
const middle = (b: Cells) =>
  [b.e0 + CELL * Math.floor(b.cols / 2), b.n0 + CELL * Math.floor(b.rows / 2)] as const

/**
 * Writes tile (i, j)'s file into `dir` as fetch-rt does, each cell a LiDAR height rising 0.1 m a
 * lattice column eastward, but the cells centred on `lack` (EPSG:3003), which hold none.
 */
const writeTile = (
  dir: string,
  i: number,
  j: number,
  lack: ReadonlyArray<readonly [number, number]> = [],
) => {
  const t = emptyTile(i, j, ["lidar"])
  for (let k = 0; k < t.codes.length; k++) {
    t.codes[k] = 0
    t.dm[k] = (t.e0 - LATTICE.e) / CELL + (k % t.cols)
  }
  for (const [e, n] of lack) t.codes[((n - t.n0) / CELL) * t.cols + (e - t.e0) / CELL] = NONE
  writeFileSync(tilePath(dir, i, j), deflateSync(encodeTile(t)))
}

// The shipped map's guards catch a box a part grew before each earlier part's fetch ran again.
test("readTiles: the shipped map throws naming a listed tile with no file; a test region builds on the files there are, the edge drawn on", (t) => {
  const dir = tempDir(t),
    lack = middle(tileNeed(0, 0, pair(false).bounds)!)
  writeTile(dir, 0, 0, [lack])
  assert.throws(
    () => readTiles(dir, pair(false)),
    /^Error: no terrain for tile 1_0: run fetch-rt for the part it belongs to$/,
  )
  const dtm = readTiles(dir, pair(true))
  assert.deepEqual([dtm.e0, dtm.n0, dtm.cols, dtm.rows], Object.values(tileGrid(0, 0)))
  assert.ok(!dtm.z.some(Number.isNaN))
  // The cell missing from 0_0's file holds the height west of it, drawn on along its row.
  const k = ((lack[1] - dtm.n0) / CELL) * dtm.cols + (lack[0] - dtm.e0) / CELL
  assert.equal(dtm.z[k], dtm.z[k - 1])
})

test("readTiles: the shipped map throws naming a tile and the cell its file lacks within the box, not one past it", (t) => {
  const dir = tempDir(t),
    g = tileGrid(1, 0),
    [e, n] = middle(tileNeed(1, 0, pair(false).bounds)!)
  writeTile(dir, 0, 0)
  // It also lacks its file's south-east corner, past the box, which no fetch for this box writes
  // and a scan of the whole file would meet first.
  writeTile(dir, 1, 0, [
    [g.e0 + CELL * (g.cols - 1), g.n0],
    [e, n],
  ])
  assert.throws(
    () => readTiles(dir, pair(false)),
    new RegExp(
      `^Error: tile 1_0 has no terrain at EPSG:3003 ${e}, ${n}: run fetch-rt for its part$`,
    ),
  )
})

test("sourceAreas gives each source's km² over the 10 m cells in play", () => {
  const source = (x: number) => (x < 0 ? "lidar" : "dtm10")
  const bounds = { minX: -100, minY: 0, maxX: 100, maxY: 100 }
  assert.deepEqual(
    sourceAreas(source, bounds, () => true),
    { lidar: 0.01, dtm10: 0.01 },
  )
  assert.deepEqual(
    sourceAreas(source, bounds, (_, y) => y < 50),
    { lidar: 0.005, dtm10: 0.005 },
  )
})
