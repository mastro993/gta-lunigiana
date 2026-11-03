import assert from "node:assert/strict"
import { test } from "node:test"

import { gaussBoagaToLatLon } from "../crs.ts"
import { cropOf } from "../dtm-mosaic.ts"
import { toLocal } from "../geometry.ts"
import {
  beyondCoverage,
  clippedRings,
  DTM_LATTICE,
  dtmCropBox,
  dtmCropUrl,
  dtmTiles,
  fetchWfs,
  nc5File,
  nc5Query,
  PAGE,
  polygonsOfFeature,
  udsPolygons,
  udsQuery,
  type WfsFeature,
  wfsUrl,
} from "../liguria.ts"
import type { Rect } from "../region.ts"

/** Sarzana's town in EPSG:25832, round metres (the test region's box, fetch-lig). */
const BOX = [575997, 4882280, 577650, 4886698] as const

test("wfsUrl asks the count, then GeoJSON pages of PAGE in EPSG:25832 from each startIndex, sorted", () => {
  const hits = new URL(wfsUrl(nc5Query("L6871", BOX))).searchParams
  assert.equal(hits.get("resultType"), "hits")
  assert.equal(hits.get("typeNames"), "M2052:L6871")
  assert.equal(hits.get("bbox"), `${BOX.join(",")},urn:ogc:def:crs:EPSG::25832`)
  assert.equal(hits.get("startIndex"), null)
  const page = new URL(wfsUrl(nc5Query("L6871", BOX), 5000))
  assert.equal(page.pathname, "/geoserver/M2052/wfs")
  const q = page.searchParams
  assert.equal(q.get("resultType"), null)
  assert.equal(q.get("startIndex"), "5000")
  assert.equal(q.get("count"), String(PAGE))
  assert.equal(q.get("sortBy"), "ogr_fid")
  assert.equal(q.get("srsName"), "EPSG:25832")
  assert.equal(q.get("outputFormat"), "application/json")
  // The land use: the box and the kept classes in one CQL filter, as the server takes no bbox beside it.
  const uds = new URL(wfsUrl(udsQuery(BOX, ["131", "512"]), 0)).searchParams
  assert.equal(uds.get("typeNames"), "M2660:L10449")
  assert.equal(uds.get("sortBy"), "ID_RLIG")
  assert.equal(uds.get("bbox"), null)
  assert.equal(
    uds.get("cql_filter"),
    `BBOX(GEOMETRY,${BOX.join(",")}) AND (COD_USO LIKE '131%' OR COD_USO LIKE '512%')`,
  )
})

/** A WFS that answers `rows` (ascending ogr_fid by default) for `q`, as the server pages them, counting `total`. */
const fakeWfs = (rows: ReadonlyArray<number>, total = rows.length, drift = 0) => {
  const asked: Array<string> = []
  const get = (url: string) => {
    asked.push(url)
    const q = new URL(url).searchParams
    if (q.get("resultType") === "hits")
      return Promise.resolve(`<wfs:FeatureCollection numberMatched="${total}" />`)
    const start = Number(q.get("startIndex"))
    return Promise.resolve(
      JSON.stringify({
        numberMatched: total + (start > 0 ? drift : 0),
        timeStamp: "changes on every call",
        features: rows
          .slice(start, start + PAGE)
          .map((ogr_fid) => ({ properties: { ogr_fid }, geometry: null })),
      }),
    )
  }
  return { asked, get }
}

test("fetchWfs reads every page from its startIndex and checks the rows against the count", async () => {
  const rows = Array.from({ length: 2 * PAGE + 3 }, (_, k) => 10 + 2 * k)
  const wfs = fakeWfs(rows)
  const features = await fetchWfs(nc5Query("L6871", BOX), wfs.get)
  assert.deepEqual(
    features.map((f) => f.properties.ogr_fid),
    rows,
  )
  assert.deepEqual(
    wfs.asked.map((u) => new URL(u).searchParams.get("startIndex")),
    [null, "0", "5000", "10000"],
  )
  // None: the count alone.
  const none = fakeWfs([])
  assert.deepEqual(await fetchWfs(nc5Query("L6871", BOX), none.get), [])
  assert.equal(none.asked.length, 1)
})

test("fetchWfs refuses a short answer, a repeated or unsorted row and a layer that changes while paging", async () => {
  const q = nc5Query("L6858", BOX)
  await assert.rejects(fetchWfs(q, fakeWfs([1, 2, 3], 4).get), /3 features of 4/)
  await assert.rejects(fetchWfs(q, fakeWfs([1, 2, 2]).get), /ogr_fid 2 out of order or repeated/)
  await assert.rejects(fetchWfs(q, fakeWfs([1, 3, 2]).get), /ogr_fid 2 out of order/)
  const paged = Array.from({ length: PAGE + 1 }, (_, k) => k)
  await assert.rejects(fetchWfs(q, fakeWfs(paged, PAGE + 1, 1).get), /changed while paging/)
  await assert.rejects(
    fetchWfs(q, () => Promise.resolve("<ows:ExceptionReport/>")),
    /no numberMatched in the count/,
  )
})

test("polygonsOfFeature: a polygon or a multipolygon as flat E, N, Z rings on whole centimetres", () => {
  const ring = [
    [576241.143, 4882818.389, 8.52],
    [576235.3, 4882821.75, 8.52],
    [576232.07, 4882816.14, 8.52],
    [576241.143, 4882818.389, 8.52],
  ]
  const polygon: WfsFeature = { properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }
  assert.deepEqual(polygonsOfFeature(polygon), [
    [
      [
        576241.14, 4882818.39, 8.52, 576235.3, 4882821.75, 8.52, 576232.07, 4882816.14, 8.52,
        576241.14, 4882818.39, 8.52,
      ],
    ],
  ])
  const flat2d = ring.map(([e, n]) => [e!, n!])
  const multi: WfsFeature = {
    properties: {},
    geometry: { type: "MultiPolygon", coordinates: [[ring], [flat2d]] },
  }
  const parts = polygonsOfFeature(multi)
  assert.equal(parts.length, 2)
  assert.deepEqual(parts[1]![0]!.slice(0, 3), [576241.14, 4882818.39, 0]) // no Z: 0
  assert.deepEqual(polygonsOfFeature({ properties: {}, geometry: null }), [])
  assert.throws(
    () => polygonsOfFeature({ properties: {}, geometry: { type: "LineString", coordinates: [] } }),
    /not a polygon: LineString/,
  )
})

test("dtmCropUrl asks the native 5 m cells, the box's edges snapped outward to the DTM's lattice", () => {
  const { e, n } = DTM_LATTICE
  // Cells 39550…39589 by rows 12460…12499: Piazza Matteotti's 200 m square, every edge 3 m inside
  // (over half a cell, so each edge's floor or ceil tells from a round).
  const url = dtmCropUrl([
    e + 39550 * 5 + 3,
    n - 12500 * 5 + 3,
    e + 39590 * 5 - 3,
    n - 12460 * 5 - 3,
  ])
  assert.match(
    url,
    /&subset=X\(1576804\.19189,1577004\.19189\)&subset=Y\(4884584\.40548,4884784\.40548\)$/,
  )
  const q = new URL(url).searchParams
  assert.equal(q.get("version"), "2.0.1")
  assert.equal(q.get("coverageId"), "M2056__L6952")
  assert.equal(q.get("geotiff:compression"), "DEFLATE")
  assert.equal(q.get("geotiff:tilewidth"), "512")
  // The server deflates a crop in one TIFF tile alone.
  assert.doesNotThrow(() => dtmCropUrl([e, n - 2560, e + 2560, n]))
  assert.throws(() => dtmCropUrl([e, n - 2560, e + 2561, n]), /513 × 512 cells: at most 512/)
})

test("nc5File keeps each feature's attributes and polygons, and clips the mapped area to the box", () => {
  const ring = (e: number, n: number, s: number, z: number) => [
    [e, n, z],
    [e + s, n, z],
    [e + s, n + s, z],
    [e, n + s, z],
    [e, n, z],
  ]
  const lot: WfsFeature = {
    properties: { classid: "LASPEZIA_0000000001" },
    geometry: {
      type: "MultiPolygon",
      coordinates: [[ring(570000, 4880000, 10000, 0)], [ring(0, 0, 1, 0)]],
    },
  }
  const mapped = nc5File(nc5Query("L6945", BOX), BOX, [lot])
  assert.equal(mapped.layer, "M2052:L6945")
  assert.equal(mapped.numberMatched, 1)
  // The lot clipped to the box, Z 0; its part far away is dropped.
  assert.deepEqual(mapped.features, [
    {
      properties: lot.properties,
      polygons: [
        [[575997, 4886698, 0, 575997, 4882280, 0, 577650, 4882280, 0, 577650, 4886698, 0]],
      ],
    },
  ])
  // Another layer's features whole, even past the box (the WFS's filter is a superset).
  const house: WfsFeature = {
    properties: { classref: "248082_1707522" },
    geometry: { type: "Polygon", coordinates: [ring(577640, 4884780, 30, 39.04)] },
  }
  assert.deepEqual(
    nc5File(nc5Query("L6871", BOX), BOX, [house]).features[0]!.polygons,
    polygonsOfFeature(house),
  )
  assert.deepEqual(clippedRings([[0, 0, 5, 1, 0, 5, 1, 1, 5]], [10, 10, 20, 20]), [])
})

test("udsPolygons: one entry a polygon, the whole code, Z dropped, decimetres; a code outside the classes refused", () => {
  const f = (code: string): WfsFeature => ({
    properties: { ID_RLIG: 23568, COD_USO: code },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [576300.4272, 4883023.6185, 0],
          [576310.05, 4883023.6185, 0],
          [576310.05, 4883030.04, 0],
          [576300.4272, 4883023.6185, 0],
        ],
      ],
    },
  })
  assert.deepEqual(udsPolygons([f("5121")], ["131", "512"]), [
    {
      id: 23568,
      code: "5121",
      rings: [[576300.4, 4883023.6, 576310.1, 4883023.6, 576310.1, 4883030, 576300.4, 4883023.6]],
    },
  ])
  assert.throws(() => udsPolygons([f("5111")], ["131", "512"]), /land use code 5111 not kept/)
})

test("beyondCoverage: only the WCS's empty-subset 404 means nothing to keep", () => {
  const empty =
    '<ows:Exception exceptionCode="InvalidSubsetting" locator=""><ows:ExceptionText>Empty intersection after subsetting</ows:ExceptionText>'
  assert.ok(beyondCoverage(404, empty))
  assert.ok(!beyondCoverage(404, '<ows:Exception exceptionCode="InvalidAxisLabel" locator="E">'))
  assert.ok(!beyondCoverage(404, '<ows:Exception exceptionCode="NoSuchCoverage">'))
  assert.ok(!beyondCoverage(500, empty))
})

test("dtmTiles' crops cover fetch-rt's crop of a part: a tall part on the tiles' edges, an L with its notch", () => {
  const parts: ReadonlyArray<ReadonlyArray<Rect>> = [
    [[-16000, -10000, -14000, -4000]],
    [
      [-16000, -8000, -14000, -2000],
      [-14000, -8000, -10000, -6000],
    ],
    [[-14400, -8000, -12800, -3600]],
  ]
  for (const rects of parts) {
    const crop = cropOf(rects),
      boxes = dtmTiles(rects).map(({ i, j }) => dtmCropBox(i, j))
    // Every 50th cell of the crop each way, its last row and column included, in some crop's box.
    const steps = (n: number) => [
      ...Array.from({ length: Math.ceil(n / 50) }, (_, k) => 50 * k),
      n - 1,
    ]
    for (const c of steps(crop.cols))
      for (const r of steps(crop.rows)) {
        const e = crop.e0 + c,
          n = crop.n0 + r
        assert.ok(
          boxes.some(([x0, y0, x1, y1]) => e >= x0 && e <= x1 && n >= y0 && n <= y1),
          `${JSON.stringify(rects)}: cell ${c}, ${r} at ${toLocal(...gaussBoagaToLatLon(e, n)).map(Math.round)}`,
        )
      }
  }
  // The Sarzana test region's: its 6 tiles and the row south of them, which its crop reaches.
  assert.deepEqual(
    dtmTiles(parts[2]!).map(({ i, j }) => `${i}_${j}`),
    ["-8_-5", "-7_-5", "-8_-4", "-7_-4", "-8_-3", "-7_-3", "-8_-2", "-7_-2"],
  )
})
