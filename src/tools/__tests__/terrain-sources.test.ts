import assert from "node:assert/strict"
import { test } from "node:test"

import { writeArrayBuffer } from "geotiff"

import { gaussBoagaToLatLon, latLonToUtm32 } from "../crs.ts"
import type { Crop } from "../dtm-mosaic.ts"
import type { Filler } from "../fill-chain.ts"
import {
  type Raster,
  ascWindow,
  clearCanopy,
  geoTiffRaster,
  openGround,
  rasterFiller,
  rerUrl,
  sample,
  utmBox,
  utmOfCrop,
} from "../terrain-sources.ts"

/** A raster of 2 m cells from (10, 20) whose height at fractional cell (c, r) is `f(c, r)`. */
const grid = (cols: number, rows: number, f: (c: number, r: number) => number): Raster => ({
  x0: 10,
  y0: 20,
  cell: 2,
  cols,
  rows,
  z: Float32Array.from({ length: cols * rows }, (_, k) => f(k % cols, Math.floor(k / cols))),
})

test("sample is bilinear between the cell centres and exact on them", () => {
  // Bilinear in (c, r) with unequal slopes, so any cell's interpolation gives it back exactly.
  const f = (c: number, r: number) => 1 + 3 * c + 5 * r + 2 * c * r
  const r = grid(3, 3, f)
  for (let fy = 0; fy <= 2; fy += 0.25)
    for (let fx = 0; fx <= 2; fx += 0.25)
      assert.ok(Math.abs(sample(r, 10 + 2 * fx, 20 + 2 * fy) - f(fx, fy)) < 1e-9, `${fx}, ${fy}`)
  const z = [7.25, -3, 12.5, 0.75, 100, -8, 2, 4.5, 33]
  const centres = grid(3, 3, (c, w) => z[w * 3 + c]!)
  for (let k = 0; k < 9; k++)
    assert.equal(sample(centres, 10 + 2 * (k % 3), 20 + 2 * Math.floor(k / 3)), z[k])
})

test("sample is NaN outside the box of cell centres and beside a cell without data", () => {
  const r = grid(3, 3, (c, w) => c + w)
  for (const [x, y] of [
    [10 - 1e-9, 22],
    [14 + 1e-9, 22],
    [12, 20 - 1e-9],
    [12, 24 + 1e-9],
  ] as const)
    assert.ok(Number.isNaN(sample(r, x, y)), `${x}, ${y}`)
  const holed = grid(4, 2, (c, w) => (c === 3 && w === 0 ? Number.NaN : c + w))
  assert.equal(sample(holed, 13, 21), 2)
  assert.ok(Number.isNaN(sample(holed, 15, 21)))
  assert.ok(Number.isNaN(sample(holed, 16, 20)))
})

/** An 8 by 7 corner-registered grid of 2 m cells from (100, 200): cell (c, s), s counted from the south, holds 100 s + c, NODATA at (1, 4). */
const CORNER = Buffer.from(
  [
    "ncols 8",
    "nrows 7",
    "xllcorner 100",
    "yllcorner 200",
    "cellsize 2",
    "NODATA_value -9999",
    ...Array.from({ length: 7 }, (_, f) =>
      Array.from({ length: 8 }, (_, c) => (f === 2 && c === 1 ? -9999 : 100 * (6 - f) + c)).join(
        " ",
      ),
    ),
    "",
  ].join("\n"),
)

test("ascWindow keeps the cells round a box, one to spare each side, south first on cell centres", () => {
  const w = ascWindow(CORNER, [106.5, 206.5, 107.5, 207.5], "corner")!
  // The box needs cells 2 to 4 each way (centres 105 to 109 east, 205 to 209 north), so it keeps 1 to 5.
  assert.deepEqual({ ...w, z: [] }, { x0: 103, y0: 203, cell: 2, cols: 5, rows: 5, z: [] })
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++) {
      const v = w.z[r * 5 + c]!
      if (c === 0 && r === 3) assert.ok(Number.isNaN(v))
      else assert.equal(v, 100 * (r + 1) + c + 1)
    }
  for (const [x, y] of [
    [106.5, 206.5],
    [107.5, 207.5],
  ] as const)
    assert.ok(Math.abs(sample(w, x, y) - (100 * (y - 201) + (x - 101)) / 2) < 1e-4)
})

test("ascWindow reads a centre-registered grid, and returns nothing for a box the grid misses", () => {
  const centred = Buffer.from(
    "ncols 3\r\nnrows 2\r\nxllcenter 100.5\r\nyllcenter 200.5\r\ncellsize 1\r\nNODATA_value -9999\r\n1 2 3\r\n4 -9999 6",
  )
  const w = ascWindow(centred, [0, 0, 1000, 1000], "centred")!
  assert.deepEqual(
    { ...w, z: [...w.z] },
    { x0: 100.5, y0: 200.5, cell: 1, cols: 3, rows: 2, z: [4, Number.NaN, 6, 1, 2, 3] },
  )
  assert.equal(ascWindow(CORNER, [200, 200, 210, 210], "east"), undefined)
  assert.equal(ascWindow(CORNER, [100, 100, 110, 150], "south"), undefined)
})

test("rerUrl asks the WCS for its native 5 m grid over the box, snapped outward, in EPSG:7791", () => {
  const q = new URL(rerUrl([580003.7, 4900003, 580012, 4900016])).searchParams
  assert.equal(q.get("bbox"), "580000,4900000,580015,4900020")
  assert.equal(q.get("width"), "3")
  assert.equal(q.get("height"), "4")
  assert.equal(q.get("crs"), "EPSG:7791")
  assert.equal(q.get("response_crs"), "EPSG:7791")
  assert.equal(q.get("format"), "GeoTIFF")
  const aligned = new URL(rerUrl([580000, 4900000, 580010, 4900005])).searchParams
  assert.equal(aligned.get("bbox"), "580000,4900000,580010,4900005")
  assert.equal(aligned.get("width"), "2")
  assert.equal(aligned.get("height"), "1")
})

/** A 5 m GeoTIFF in EPSG:7791, 3 by 2, its top-left corner at (580000, 4900010), rows north first. */
const tiff = (values: ReadonlyArray<number>, crs = 7791): Buffer =>
  Buffer.from(
    writeArrayBuffer(Float32Array.from(values), {
      width: 3,
      height: 2,
      ModelPixelScale: [5, 5, 0],
      ModelTiepoint: [0, 0, 0, 580000, 4900010, 0],
      ProjectedCSTypeGeoKey: crs,
      GTModelTypeGeoKey: 1,
      GTRasterTypeGeoKey: 1,
      GDAL_NODATA: "-999",
    }),
  )

test("geoTiffRaster turns a GeoTIFF into a south-first raster on cell centres, no data NaN", async () => {
  // -999 is the file's nodata; -5000 is below the -1000 m floor.
  const r = await geoTiffRaster(tiff([1, 2, 3, -999, -5000, 6]))
  assert.deepEqual(
    { ...r, z: [...r.z] },
    {
      x0: 580002.5,
      y0: 4900002.5,
      cell: 5,
      cols: 3,
      rows: 2,
      z: [Number.NaN, Number.NaN, 6, 1, 2, 3],
    },
  )
  await assert.rejects(geoTiffRaster(tiff([1, 2, 3, 4, 5, 6], 3003)), /not in EPSG:7791/)
})

/** A crop round EPSG:3003 (1584000.5, 4912000.5), spanning several lattice nodes each way. */
const GB: Crop = { e0: 1584000.5, n0: 4912000.5, cols: 230, rows: 170 }

/** Cell (col, row) of `GB` in EPSG:7791 by the exact transforms. */
const exactUtm = (col: number, row: number) =>
  latLonToUtm32(...gaussBoagaToLatLon(GB.e0 + col, GB.n0 + row))

test("utmOfCrop places a crop's cells in EPSG:7791 within 1 mm of the exact transforms", () => {
  const at = utmOfCrop(GB),
    p = new Float64Array(2)
  for (const [c, r] of [
    [0, 0],
    [229, 169],
    [137, 23],
    [49, 151],
    [100, 100],
    [229, 0],
    [0, 169],
  ] as const) {
    at(c, r, p)
    const [e, n] = exactUtm(c, r)
    assert.ok(
      Math.abs(p[0]! - e) < 1e-3 && Math.abs(p[1]! - n) < 1e-3,
      `${c}, ${r}: ${p[0]}, ${p[1]} against ${e}, ${n}`,
    )
  }
})

test("utmBox is the EPSG:7791 box round the crop's corner cells", () => {
  const corners = [exactUtm(0, 0), exactUtm(229, 0), exactUtm(0, 169), exactUtm(229, 169)]
  const es = corners.map(([e]) => e),
    ns = corners.map(([, n]) => n)
  const exact = [Math.min(...es), Math.min(...ns), Math.max(...es), Math.max(...ns)]
  // To 0.01 mm: the lattice is good to nanometres here, and the grids turn by under 1 mm across
  // the crop, so each corner bounds the box by less than that.
  utmBox(GB).forEach((v, i) => assert.ok(Math.abs(v - exact[i]!) < 1e-5, `${i}: ${v} ${exact[i]}`))
})

test("rasterFiller reads its rasters in turn at the crop's cells, in decimetres, NaN where none has data", () => {
  const crop: Crop = { e0: 100.5, n0: 200.5, cols: 4, rows: 2 }
  // The first covers crop columns 0 and 1, the second 0 to 2, the fourth neither.
  const first: Raster = {
    x0: 100.5,
    y0: 200.5,
    cell: 1,
    cols: 2,
    rows: 2,
    z: Float32Array.of(1.5, 2.5, 3.5, 4.5),
  }
  const second: Raster = {
    x0: 100.5,
    y0: 200.5,
    cell: 1,
    cols: 3,
    rows: 2,
    z: Float32Array.of(10, 20, 30, 40, 50, 60),
  }
  const filler = rasterFiller("dtm10", crop, [first, second])
  assert.equal(filler.source, 2)
  assert.ok(!("where" in filler))
  assert.deepEqual(
    [0, 1].flatMap((r) => [0, 1, 2, 3].map((c) => filler.at(c, r))),
    [15, 25, 300, Number.NaN, 35, 45, 600, Number.NaN],
  )
})

test("rasterFiller samples through utm when given one and passes where through", () => {
  const crop: Crop = { e0: 100.5, n0: 200.5, cols: 4, rows: 2 }
  const utm: Raster = {
    x0: 5000,
    y0: 7000,
    cell: 1,
    cols: 10,
    rows: 10,
    z: Float32Array.from({ length: 100 }, (_, k) => 100 * Math.floor(k / 10) + (k % 10)),
  }
  const where = (k: number) => k % 2 === 0
  const filler = rasterFiller(
    "rer",
    crop,
    [utm],
    (c, r, out) => {
      out[0] = 5000 + 2 * c
      out[1] = 7000 + 3 * r
    },
    where,
  )
  assert.equal(filler.source, 3)
  assert.equal(filler.where, where)
  assert.equal(filler.at(2, 1), 3040)
})

test("openGround marks the cell centres inside polygons of the open-ground classes alone", () => {
  const crop: Crop = { e0: 1000.5, n0: 2000.5, cols: 20, rows: 10 }
  /** A square in EPSG:3003, one flat ring. */
  const square = (e0: number, n0: number, e1: number, n1: number) => [
    [e0, n0, e1, n0, e1, n1, e0, n1],
  ]
  const open = openGround(
    [
      // Meadow: centres 1004.5 to 1006.5 east, 2002.5 to 2005.5 north, the edges just off the next ones.
      { attrs: { ucs2019: "231" }, polygons: [square(1003.6, 2002.4, 1007.4, 2005.6)] },
      { attrs: { ucs2019: "311" }, polygons: [square(1010, 2000, 1020, 2010)] },
      { attrs: {}, polygons: [square(1000, 2006, 1010, 2010)] },
    ],
    crop,
  )
  const expected = Uint8Array.from({ length: 200 }, (_, k) => {
    const c = k % 20,
      r = Math.floor(k / 20)
    return c >= 4 && c <= 6 && r >= 2 && r <= 5 ? 1 : 0
  })
  assert.deepEqual(open, expected)
})

/** The canopy tests' crop: 80 m square, its cells 1 m. */
const CROP: Crop = { e0: 0.5, n0: 0.5, cols: 80, rows: 80 }
type Box = readonly [number, number, number, number]
const WHOLE: Box = [0, 0, 79, 79]
const inBox = (c: number, r: number, [c0, r0, c1, r1]: Box) =>
  c >= c0 && c <= c1 && r >= r0 && r <= r1

/**
 * The cells, "c,r", where clearCanopy leaves `open` (1 within `area`) other than `kept`, at most
 * five: the surface model `rise(c, r)` dm above the ground, both on `slope`.
 */
const wrong = (
  rise: (c: number, r: number) => number,
  kept: (c: number, r: number) => boolean,
  {
    area = WHOLE,
    box = WHOLE,
    slope = () => 0,
  }: { area?: Box; box?: Box; slope?: (c: number, r: number) => number } = {},
): Array<string> => {
  const open = Uint8Array.from({ length: 80 * 80 }, (_, k) =>
    inBox(k % 80, Math.floor(k / 80), area) ? 1 : 0,
  )
  const dsm: Filler = { source: 1, at: (c, r) => slope(c, r) + rise(c, r) },
    ground: Filler = { source: 2, at: slope }
  clearCanopy(open, dsm, ground, CROP, box)
  const out: Array<string> = []
  for (let k = 0; k < open.length && out.length < 5; k++)
    if ((open[k] === 1) !== kept(k % 80, Math.floor(k / 80)))
      out.push(`${k % 80},${Math.floor(k / 80)}`)
  return out
}

test("a 5 m tree 3 m tall goes with 2 m round it; the flat ground beyond stays, as does the crop outside the box", () => {
  const tree = (c: number, r: number) => (inBox(c, r, [30, 30, 34, 34]) ? 30 : 0)
  assert.deepEqual(
    wrong(tree, (c, r) => !inBox(c, r, [28, 28, 36, 36]), { box: [5, 3, 74, 76] }),
    [],
  )
})

test("a 3 m wide pit 5 m deep goes with 2 m round it", () => {
  const pit = (c: number, r: number) => (inBox(c, r, [50, 20, 52, 22]) ? -50 : 0)
  assert.deepEqual(
    wrong(pit, (c, r) => !inBox(c, r, [48, 18, 54, 24])),
    [],
  )
})

test("ground between cleared hedges goes when narrower than CANOPY_SIDE and stays when as wide", () => {
  // Hedges 10 and 13 m apart, too far for the closing to take the ground between for a pit; their
  // fringes leave strips of 6 m (columns 17 to 22) and 9 m (32 to 40).
  const hedges = (c: number, r: number) =>
    inBox(c, r, [10, 20, 14, 49]) || inBox(c, r, [25, 20, 29, 49]) || inBox(c, r, [43, 20, 47, 49])
      ? 30
      : 0
  assert.deepEqual(
    wrong(hedges, (c, r) => !inBox(c, r, [8, 18, 31, 51]) && !inBox(c, r, [41, 18, 49, 51])),
    [],
  )
})

test("a strip of ground narrower than CANOPY_SIDE along the open area's edge goes too", () => {
  // The open area starts at column 10, the hedge's fringe at 14: a 4 m strip.
  const area: Box = [10, 0, 69, 79]
  const hedge = (c: number, r: number) => (inBox(c, r, [16, 20, 20, 49]) ? 30 : 0)
  assert.deepEqual(
    wrong(hedge, (c, r) => inBox(c, r, area) && !inBox(c, r, [10, 18, 22, 51]), { area }),
    [],
  )
})

test("an open area narrower than CANOPY_SIDE with nothing on it stays open", () => {
  const area: Box = [30, 0, 34, 79]
  assert.deepEqual(
    wrong(
      () => 0,
      (c, r) => inBox(c, r, area),
      { area },
    ),
    [],
  )
})

test("a uniform slope in both the surface model and the ground clears nothing", () => {
  // 0.5 m and 0.3 m a metre: the surface model alone would rise past CANOPY_RISE across a square.
  assert.deepEqual(
    wrong(
      () => 0,
      () => true,
      { slope: (c, r) => 5 * c + 3 * r },
    ),
    [],
  )
})
