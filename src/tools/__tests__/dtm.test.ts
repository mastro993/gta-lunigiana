import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type TestContext, test } from "node:test"
import { deflateSync } from "node:zlib"

import { gaussBoagaToLatLon, latLonToGaussBoaga } from "../crs.ts"
import { type DtmData, dtmDem, loadDtm, readDtm, sourceAreas } from "../dtm.ts"
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
  const read = loadDtm(dir, first),
    made = dtmDem(d, first)
  for (const [x, y] of points(200)) {
    if (!Object.is(read.at(x, y), made.at(x, y)))
      assert.fail(`at(${x}, ${y}): ${read.at(x, y)} != ${made.at(x, y)}`)
    assert.equal(read.source?.(x, y), made.source?.(x, y))
  }
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
