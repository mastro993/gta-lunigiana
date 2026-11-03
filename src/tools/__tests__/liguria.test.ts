import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DTM_LATTICE,
  dtmCropUrl,
  fetchWfs,
  nc5Query,
  PAGE,
  polygonsOfFeature,
  udsQuery,
  type WfsFeature,
  wfsUrl,
} from "../liguria.ts"

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
  // Cells 39550…39589 by rows 12460…12499: Piazza Matteotti's 200 m square, nudged inside.
  const url = dtmCropUrl([
    e + 39550 * 5 + 1.3,
    n - 12500 * 5 + 0.2,
    e + 39590 * 5 - 4,
    n - 12460 * 5,
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
