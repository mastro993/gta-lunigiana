import assert from "node:assert/strict"
import { test } from "node:test"

import { fromLocal } from "../geometry.ts"
import { frameOf, getMapUrl, licenceOf, parseCapabilities, tilesOf, toPx } from "../ortho-wms.ts"

test("licenceOf lets RT layers be traced, keeps AGEA, Blom and unknown layers look only, and maps band variants to their base", () => {
  assert.equal(licenceOf("rt_ofc.2k10")?.licence, "CC BY")
  assert.equal(licenceOf("rt_ofc.5k24.32bit.nir")?.licence, "CC BY 4.0")
  assert.equal(licenceOf("rt_ofc.5k21.32bit.1R4G2B")?.licence, "CC BY 4.0")
  assert.equal(licenceOf("rt_ofc.2k12.32bit.4R1G2B"), licenceOf("rt_ofc.2k12.32bit"))
  assert.equal(licenceOf("rt_ofc.2k12.32bit.qu"), licenceOf("rt_ofc.2k12.32bit"))
  assert.equal(licenceOf("rt_ofc.10k10.grey.rt")?.owner, "AGEA")
  assert.equal(licenceOf("rt_ofc.2k11")?.licence, "CC BY")
  // The 2011 Aulla flood flight is its own row, not the 2011 one it shares a prefix with.
  assert.deepEqual(
    [licenceOf("rt_ofc.2k11.aulla")?.owner, licenceOf("rt_ofc.2k11.aulla")?.licence],
    ["Blom", undefined],
  )
  for (const look of ["rt_ofc.10k13", "rt_ofc.10k10.grey.rt", "rt_ofc.5k25.32bit", "rt_ofc.10k07"])
    assert.equal(licenceOf(look)?.licence, undefined, look)
  assert.equal(licenceOf("rt_ofc.5k26.32bit"), undefined)
  // Any other suffix is not a band variant: an unreviewed flight that shares a prefix stays unknown.
  for (const unknown of ["rt_ofc.2k11.massa", "rt_ofc.2k10.grey", "rt_ofc.5k24.32bit.x"])
    assert.equal(licenceOf(unknown), undefined, unknown)
})

const CAPS = `<WMS_Capabilities version="1.3.0"><Service><MaxWidth>5000</MaxWidth><MaxHeight>4000</MaxHeight></Service>
<Capability><Request><GetCapabilities><Format>text/xml</Format></GetCapabilities>
<GetMap><Format>image/png</Format><Format>image/jpeg</Format></GetMap></Request>
<Layer><Name>rt_ofc</Name><Title>Root</Title><CRS>EPSG:3003</CRS><CRS>EPSG:4326</CRS>
<Layer queryable="0"><Name>rt_ofc.2k10</Name><Title>OFC 2010 2k col, proprieta&#39; RT &amp; altri</Title>
<Abstract>Ortofotocarta anno 2010 proprieta&#39; RT &amp; altri.</Abstract><CRS>EPSG:4326</CRS>
<EX_GeographicBoundingBox><westBoundLongitude>9.5</westBoundLongitude><eastBoundLongitude>12.4</eastBoundLongitude>
<southBoundLatitude>42.1</southBoundLatitude><northBoundLatitude>44.5</northBoundLatitude></EX_GeographicBoundingBox>
<Attribution><Title>Fonte dei dati: Regione Toscana</Title></Attribution>
<Style><Name>default</Name><Title>default</Title></Style></Layer></Layer></Capability></WMS_Capabilities>`

test("parseCapabilities reads the size limit, the GetMap formats, the CRSs and each layer's own fields", () => {
  const caps = parseCapabilities(CAPS)
  assert.deepEqual([caps.maxWidth, caps.maxHeight], [5000, 4000])
  assert.deepEqual(caps.formats, ["image/png", "image/jpeg"])
  assert.deepEqual(caps.crs, ["EPSG:3003", "EPSG:4326"])
  assert.deepEqual([...caps.layers.keys()], ["rt_ofc", "rt_ofc.2k10"])
  assert.deepEqual(caps.layers.get("rt_ofc.2k10"), {
    title: "OFC 2010 2k col, proprieta' RT & altri",
    attribution: "Fonte dei dati: Regione Toscana",
    box: [9.5, 42.1, 12.4, 44.5],
  })
  assert.equal(
    parseCapabilities("<WMS_Capabilities><Layer><Name>a</Name></Layer></WMS_Capabilities>")
      .maxWidth,
    Infinity,
  )
})

test("parseCapabilities throws on an answer that lists no layer: a WMS error comes back as XML with HTTP 200", () => {
  assert.throws(
    () =>
      parseCapabilities(
        '<ServiceExceptionReport version="1.3.0"><ServiceException>msWMSLoadGetMapParams(): WMS server error.</ServiceException></ServiceExceptionReport>',
      ),
    /no layer in the GetCapabilities answer: <ServiceExceptionReport/,
  )
})

test("toPx puts the north-west corner at the origin and flips y, so north is up", () => {
  const f = frameOf([-170, -450, 130, -150], 0.5)
  assert.deepEqual([f.w, f.h], [600, 600])
  assert.deepEqual(toPx(f, -170, -150), [0, 0])
  assert.deepEqual(toPx(f, 130, -450), [600, 600])
  assert.deepEqual(toPx(f, -20, -200), [300, 100])
  assert.ok(toPx(f, 0, -160)[1] < toPx(f, 0, -440)[1], "the north point is higher up")
  assert.deepEqual([frameOf([0, 0, 0.1, 0.1], 0.5).w, frameOf([0, 0, 0.1, 0.1], 0.5).h], [1, 1])
})

test("tilesOf covers the frame with tiles no wider than the limit whose boxes share their edges", () => {
  const one = frameOf([-170, -450, 130, -150], 0.5)
  const [tile] = tilesOf(one, 4096)
  const [lat0, lon0] = fromLocal(-170, -450),
    [lat1, lon1] = fromLocal(130, -150)
  assert.deepEqual(tile, { i: 0, j: 0, w: 600, h: 600, bbox: [lon0, lat0, lon1, lat1] })

  const f = frameOf([0, 0, 1800, 500], 0.2) // 9000 × 2500 px
  const tiles = tilesOf(f, 4096)
  assert.deepEqual(
    tiles.map((t) => [t.i, t.j, t.w, t.h]),
    [
      [0, 0, 3000, 2500],
      [3000, 0, 3000, 2500],
      [6000, 0, 3000, 2500],
    ],
  )
  for (let k = 1; k < tiles.length; k++) assert.equal(tiles[k]!.bbox[0], tiles[k - 1]!.bbox[2])
  assert.deepEqual(tiles.at(-1)!.bbox.slice(2), [fromLocal(1800, 500)[1], fromLocal(1800, 500)[0]])

  const tall = tilesOf(frameOf([0, 0, 100, 1700], 0.2), 4096) // 500 × 8500 px: rows north to south
  assert.deepEqual(
    tall.map((t) => [t.j, t.h]),
    [
      [0, 2833],
      [2833, 2834],
      [5667, 2833],
    ],
  )
  assert.ok(tall[0]!.bbox[1] > tall[1]!.bbox[1], "the first row is the northernmost")
  assert.equal(tall[0]!.bbox[1], tall[1]!.bbox[3])
})

test("getMapUrl asks WMS 1.1.1 for a JPEG in EPSG:4326 with the box as lon, lat", () => {
  const url = getMapUrl("https://example.org/wms?map=wmsofc", "rt_ofc.2k10", {
    i: 0,
    j: 0,
    w: 600,
    h: 400,
    bbox: [10.1, 44.1, 10.2, 44.2],
  })
  assert.equal(
    url,
    "https://example.org/wms?map=wmsofc&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=rt_ofc.2k10&STYLES=&SRS=EPSG:4326&BBOX=10.100000000,44.100000000,10.200000000,44.200000000&WIDTH=600&HEIGHT=400&FORMAT=image/jpeg",
  )
})
