import assert from "node:assert/strict"
import { test } from "node:test"

import {
  RT_WMS,
  insidePoints,
  lidarGfiUrl,
  lidarLicence,
  parseGml,
  parseLidarGfi,
  wfsUrl,
} from "../cartoteca.ts"
import { pointInRing } from "../geometry.ts"

/** Trimmed from real WFS 1.0.0 answers of rt_cartoteca.ctr2k and lidar2k (2026-10-29), plus a block with a hole. */
const GML = String.raw`<?xml version='1.0' encoding="UTF-8" ?>
<wfs:FeatureCollection
   xmlns:ms="http://mapserver.gis.umn.edu/mapserver"
   xmlns:wfs="http://www.opengis.net/wfs"
   xmlns:gml="http://www.opengis.net/gml"
   xmlns:ogc="http://www.opengis.net/ogc"
   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <gml:boundedBy>
      	<gml:Box srsName="urn:ogc:def:crs:EPSG::3003">
      		<gml:coordinates>1587999.977357,4888800.060043 1589599.977383,4890000.060210</gml:coordinates>
      	</gml:Box>
      </gml:boundedBy>
    <gml:featureMember>
      <ms:rt_cartoteca.ctr2k fid="rt_cartoteca.ctr2k.2343">
        <gml:boundedBy>
        	<gml:Box srsName="urn:ogc:def:crs:EPSG::3003">
        		<gml:coordinates>1587999.977357,4888800.060043 1589599.977383,4890000.060210</gml:coordinates>
        	</gml:Box>
        </gml:boundedBy>
        <ms:GEOMETRY>
        <gml:Polygon srsName="urn:ogc:def:crs:EPSG::3003">
          <gml:outerBoundaryIs>
            <gml:LinearRing>
              <gml:coordinates>1587999.977618,4890000.060084 1589599.977383,4890000.060210 1589599.977122,4888800.060207 1587999.977357,4888800.060043 1587999.977618,4890000.060084 </gml:coordinates>
            </gml:LinearRing>
          </gml:outerBoundaryIs>
        </gml:Polygon>
        </ms:GEOMETRY>
        <ms:gid>2343</ms:gid>
        <ms:anno>1993</ms:anno>
        <ms:foglio>23D43</ms:foglio>
        <ms:datavolo></ms:datavolo>
        <ms:filetiff>23D43_1993_ctr2k_1C01115B3F974CCC0BC71EBACC881BF4.zip</ms:filetiff>
      </ms:rt_cartoteca.ctr2k>
    </gml:featureMember>
    <gml:featureMember>
      <ms:rt_cartoteca.lidar2k fid="rt_cartoteca.lidar2k.7691">
        <gml:boundedBy>
        	<gml:Box srsName="urn:ogc:def:crs:EPSG::3003">
        		<gml:coordinates>1594399.534706,4884000.381658 1595539.554882,4885200.406174</gml:coordinates>
        	</gml:Box>
        </gml:boundedBy>
        <ms:GEOMETRY>
        <gml:Polygon srsName="urn:ogc:def:crs:EPSG::3003">
          <gml:outerBoundaryIs>
            <gml:LinearRing>
              <gml:coordinates>1594399.535488,4885199.407063 1594479.536931,4885200.406174 1594400.535312,4884903.404066 1594399.535294,4884903.404078 1594399.535488,4885199.407063 </gml:coordinates>
            </gml:LinearRing>
          </gml:outerBoundaryIs>
        </gml:Polygon>
        </ms:GEOMETRY>
        <ms:GEOMETRY>
        <gml:Polygon srsName="urn:ogc:def:crs:EPSG::3003">
          <gml:outerBoundaryIs>
            <gml:LinearRing>
              <gml:coordinates>1594399.535286,4884891.403957 1595062.546751,4884373.391081 1595539.554882,4884000.381658 1594399.534706,4884000.381658 1594399.535286,4884891.403957 </gml:coordinates>
            </gml:LinearRing>
          </gml:outerBoundaryIs>
        </gml:Polygon>
        </ms:GEOMETRY>
        <ms:foglio>22d15</ms:foglio>
        <ms:lotto>005</ms:lotto>
        <ms:anno>2012</ms:anno>
        <ms:dtmname>22d15_1x1_dtm_005_2012_3003</ms:dtmname>
        <ms:dtmfile>j:\CATALOGO\LIDAR\2K\ORIG\DTM\22D\22d15_1x1_dtm_005_2012_3003.zip</ms:dtmfile>
        <ms:rilievo>LUNIGIANA, PROV.PT, PROV.LU, SCARLINO</ms:rilievo>
      </ms:rt_cartoteca.lidar2k>
    </gml:featureMember>
    <gml:featureMember>
      <ms:rt_cartoteca.dbt.2k fid="rt_cartoteca.dbt.2k.62">
        <ms:GEOMETRY>
        <gml:Polygon srsName="urn:ogc:def:crs:EPSG::3003">
          <gml:outerBoundaryIs>
            <gml:LinearRing>
              <gml:coordinates>0,0 1000,0 1000,1000 0,1000 0,0</gml:coordinates>
            </gml:LinearRing>
          </gml:outerBoundaryIs>
          <gml:innerBoundaryIs>
            <gml:LinearRing>
              <gml:coordinates>400,300 600,300 600,500 400,500 400,300</gml:coordinates>
            </gml:LinearRing>
          </gml:innerBoundaryIs>
        </gml:Polygon>
        </ms:GEOMETRY>
        <ms:nomecom>  MINUCCIANO  </ms:nomecom>
        <ms:note>A &amp; B &lt;1&gt; &quot;x&quot; &apos;y&apos;</ms:note>
      </ms:rt_cartoteca.dbt.2k>
    </gml:featureMember>
</wfs:FeatureCollection>
`

/** The flat rings of a square with a square hole, as parseGml gives them. */
const OUTER = [0, 0, 1000, 0, 1000, 1000, 0, 1000, 0, 0]
const HOLE = [400, 300, 600, 300, 600, 500, 400, 500, 400, 300]

test("parseGml reads each feature's attributes and polygons, holes and multipolygons included", () => {
  const [ctr, lidar, block, ...rest] = parseGml(GML)
  assert.equal(rest.length, 0)
  assert.deepEqual(ctr!.attrs, {
    gid: "2343",
    anno: "1993",
    foglio: "23D43",
    datavolo: "",
    filetiff: "23D43_1993_ctr2k_1C01115B3F974CCC0BC71EBACC881BF4.zip",
  })
  // The boundedBy boxes are not polygons.
  assert.deepEqual(ctr!.polygons, [
    [
      [
        1587999.977618, 4890000.060084, 1589599.977383, 4890000.06021, 1589599.977122,
        4888800.060207, 1587999.977357, 4888800.060043, 1587999.977618, 4890000.060084,
      ],
    ],
  ])
  assert.equal(lidar!.attrs.foglio, "22d15")
  assert.equal(lidar!.attrs.lotto, "005")
  assert.equal(
    lidar!.attrs.dtmfile,
    String.raw`j:\CATALOGO\LIDAR\2K\ORIG\DTM\22D\22d15_1x1_dtm_005_2012_3003.zip`,
  )
  // MapServer writes a multipolygon as one ms:GEOMETRY per polygon.
  assert.deepEqual(
    lidar!.polygons.map((p) => p.map((r) => r.length)),
    [[10], [10]],
  )
  assert.deepEqual(lidar!.polygons[1]![0]!.slice(0, 2), [1594399.535286, 4884891.403957])
  assert.deepEqual(block!.polygons, [[OUTER, HOLE]])
  assert.equal(block!.attrs.nomecom, "MINUCCIANO")
  assert.equal(block!.attrs.note, `A & B <1> "x" 'y'`)
})

test("parseGml gives no features for an empty collection and throws on a truncated or failed answer", () => {
  assert.deepEqual(
    parseGml(
      `<wfs:FeatureCollection xmlns:gml="http://www.opengis.net/gml"></wfs:FeatureCollection>`,
    ),
    [],
  )
  assert.throws(() => parseGml(GML.slice(0, GML.indexOf("</wfs:FeatureCollection>"))), /truncated/)
  assert.throws(
    () =>
      parseGml(`<ServiceExceptionReport><ServiceException>msWFSGetFeature()</ServiceException>`),
    /WFS: truncated or failed answer: <ServiceExceptionReport>/,
  )
})

test("wfsUrl writes the service, the layer and the box verbatim", () => {
  assert.equal(
    wfsUrl("wmscartoteca", "rt_cartoteca.ctr2k", [1587947, 4889088, 1588047.5, 4889188.25]),
    "https://www502.regione.toscana.it/wmsraster/com.rt.wms.RTmap/wms?map=wmscartoteca&service=WFS&version=1.0.0&request=GetFeature&typeName=rt_cartoteca.ctr2k&BBOX=1587947,4889088,1588047.5,4889188.25",
  )
})

test("lidarGfiUrl asks the LiDAR index at the middle pixel of a box round the point", () => {
  const url = new URL(lidarGfiUrl(44.15, 10.1))
  assert.equal(`${url.origin}${url.pathname}`, RT_WMS)
  const q = url.searchParams
  assert.equal(q.get("REQUEST"), "GetFeatureInfo")
  assert.equal(q.get("QUERY_LAYERS"), "rt_cartoteca.lidar2k")
  assert.equal(q.get("INFO_FORMAT"), "text/html")
  const [w, s, e, n] = q.get("BBOX")!.split(",").map(Number)
  assert.ok(Math.abs((w! + e!) / 2 - 10.1) < 1e-9 && Math.abs((s! + n!) / 2 - 44.15) < 1e-9)
  assert.equal(Number(q.get("X")), (Number(q.get("WIDTH")) - 1) / 2)
  assert.equal(Number(q.get("Y")), (Number(q.get("HEIGHT")) - 1) / 2)
})

/** Trimmed from the real text/html GetFeatureInfo at 44.199415 N, 10.110954 E (2026-10-29): sheet 23d11 in lots 004 and 006. */
const GFI = `<html>
  <body>
<table border="0" align="left" width="100%">
<tr><td><font size="-1" face="Arial">Strato: <b>Download "Lidar 1:2000" in formato Ascii</b></font></td><td colspan="3">&nbsp;</td></tr>

<!-- rt_found -->
<tr>
  <td colspan="5" align="left" valign="top">
    <table border="0" width="100%">
      <tr>
        <td colspan="1" rowspan="1" align="left" valign="top"><font size="-1" face="Arial">Proprieta':<b>RT</b> </font></td>
      </tr>
      <tr>
        <td colspan="1" rowspan="1" align="left" valign="top"><font size="-1" face="Arial">Foglio:<b>23d11</b> </font></td>
      </tr>
      <tr>
        <td colspan="1" rowspan="1" align="left" valign="top"><font size="-1" face="Arial">Risoluzione:<b>1x1</b> </font></td>
      </tr>
      <tr>
        <td colspan="1" rowspan="1" align="left" valign="top"><font size="-1" face="Arial">Lotto:<b>004</b> </font></td>
      </tr>
      <tr>
        <td colspan="1" rowspan="1" align="left" valign="top"><font size="-1" face="Arial">Rilievo:<b>LUNIGIANA, PROV.PT, PROV.LU, SCARLINO</b> </font></td>
      </tr>
      <tr>
        <td colspan="1" rowspan="1" align="left" valign="top"><font size="-1" face="Arial">Data volo:<b>DAL 27/6/2010 AL 28/10/2010</b> </font></td>
      </tr>
      <tr>
        <td colspan="1" rowspan="1" align="left" valign="top">
		<font size="-1" face="Arial">Scarica il dataset
			[<a href=https://www502.regione.toscana.it/geoscopio/download/altimetria/lidar/dsm/23d11_1x1_dsm_004_2010_3003_35276e6d8da32411d27602c15c9f428f.zip>DSM</a>]
			[<a href=https://www502.regione.toscana.it/geoscopio/download/altimetria/lidar/dtm/23d11_1x1_dtm_004_2010_3003_6608383f82231dd57fa923769433d385.zip>DTM</a>]
			[<a href=https://www502.regione.toscana.it/geoscopio/download/altimetria/lidar/raw/23d11_1x1_raw_004_2010_3003_01e8a017f53a2441a84931b06d00b66e.zip>Nuvola di punti (Dati grezzi)</a>]
		</font>
	 </td>
      </tr>
        <td colspan="1" rowspan="1" align="left" valign="top">
<font size="-1" face="Arial">
Per i dati di proprieta' di Regione Toscana la licenza e':<br>
<br />Distribuzione con <a rel="license" href="https://creativecommons.org/licenses/by/4.0" target="_blank">Licenza Creative Commons Attribuzione 4.0</a>.
<br>
Per i dati di proprieta' del MATTM la licenza e':<br>
<br />Distribuzione con <a rel="license" href="https://creativecommons.org/licenses/by-sa/3.0/it" target="_blank">Licenza Creative Commons Attribuzione Condividi allo stesso modo 3.0 Italia</a>.
</font></td>
      </tr>
    </table><br/>
  </td>
</tr>
<tr><td colspan="4"><hr></td></tr>
<!-- rt_found -->
<tr>
  <td colspan="5" align="left" valign="top">
    <table border="0" width="100%">
      <tr>
        <td colspan="1" rowspan="1" align="left" valign="top"><font size="-1" face="Arial">Proprieta':<b>MATTM</b> </font></td>
      </tr>
      <tr>
        <td colspan="1" rowspan="1" align="left" valign="top"><font size="-1" face="Arial">Foglio:<b>23d11</b> </font></td>
      </tr>
      <tr>
        <td colspan="1" rowspan="1" align="left" valign="top"><font size="-1" face="Arial">Lotto:<b>006</b> </font></td>
      </tr>
      <tr>
        <td colspan="1" rowspan="1" align="left" valign="top"><font size="-1" face="Arial">Rilievo:<b>MATTM - AREE INTERNE REGIONE TOSCANA, TRA LE QUALI I CORSI DI ACQUA DI MAGGIOR RILIEVO PER UN BUFFER PARI AD 800M</b> </font></td>
      </tr>
      <tr>
        <td colspan="1" rowspan="1" align="left" valign="top"><font size="-1" face="Arial">Data volo:<b>2008</b> </font></td>
      </tr>
      <tr>
        <td colspan="1" rowspan="1" align="left" valign="top">
		<font size="-1" face="Arial">Scarica il dataset
			[<a href=https://www502.regione.toscana.it/geoscopio/download/altimetria/lidar/dsm/23d11_1x1_dsm_006_2008_3003_e4c5ac7eb95c8aab5c01112b832cbfd4.zip>DSM</a>]
			[<a href=https://www502.regione.toscana.it/geoscopio/download/altimetria/lidar/dtm/23d11_1x1_dtm_006_2008_3003_dab1163080967368092fb2277c3a5aed.zip>DTM</a>]
			[Su questo foglio nuvola di punti non disponibile]
		</font>
	 </td>
      </tr>
    </table><br/>
  </td>
</tr>
<tr><td colspan="4"><hr></td></tr>
</table>
  </body>
</html>
`

test("parseLidarGfi reads each tile's owner, sheet, lot, survey and DTM archive", () => {
  assert.deepEqual(parseLidarGfi(GFI), [
    {
      owner: "RT",
      sheet: "23d11",
      lot: "004",
      survey: "LUNIGIANA, PROV.PT, PROV.LU, SCARLINO",
      dtm: "23d11_1x1_dtm_004_2010_3003_6608383f82231dd57fa923769433d385",
    },
    {
      owner: "MATTM",
      sheet: "23d11",
      lot: "006",
      survey:
        "MATTM - AREE INTERNE REGIONE TOSCANA, TRA LE QUALI I CORSI DI ACQUA DI MAGGIOR RILIEVO PER UN BUFFER PARI AD 800M",
      dtm: "23d11_1x1_dtm_006_2008_3003_dab1163080967368092fb2277c3a5aed",
    },
  ])
})

test("parseLidarGfi lower-cases the sheet, leaves out a DTM the tile lacks, and reads an empty answer", () => {
  const upper = GFI.replace("Foglio:<b>23d11</b>", "Foglio:<b>23D11</b>")
  assert.deepEqual(
    parseLidarGfi(upper).map((t) => t.sheet),
    ["23d11", "23d11"],
  )
  const noDtm = GFI.replace(
    /\[<a href=\S*\/lidar\/dtm\/23d11_1x1_dtm_006\S*>DTM<\/a>\]/,
    "[Su questo foglio DTM non disponibile]",
  )
  const [rt, mattm] = parseLidarGfi(noDtm)
  assert.equal(rt!.dtm, "23d11_1x1_dtm_004_2010_3003_6608383f82231dd57fa923769433d385")
  assert.ok(!("dtm" in mattm!))
  assert.deepEqual(parseLidarGfi(GFI.slice(0, GFI.indexOf("<!-- rt_found -->"))), [])
})

test("lidarLicence gives each tile of an answer the licence the answer states for its owner", () => {
  assert.deepEqual(
    parseLidarGfi(GFI).map((t) => lidarLicence(t.owner)),
    ["CC BY 4.0", "CC BY-SA 3.0 IT"],
  )
  assert.ok(GFI.includes("creativecommons.org/licenses/by/4.0"))
  assert.ok(GFI.includes("creativecommons.org/licenses/by-sa/3.0/it"))
  assert.equal(lidarLicence("Privato"), "unknown")
})

/** Whether (e, n) lies inside a polygon (outer ring then holes). */
const inPolygon = (polygon: ReadonlyArray<ReadonlyArray<number>>, e: number, n: number) =>
  pointInRing(e, n, polygon[0]!) && !polygon.slice(1).some((hole) => pointInRing(e, n, hole))

test("insidePoints on a square with a hole: every point inside, the middle of the widest span first", () => {
  const pts = insidePoints([[OUTER, HOLE]])
  // 9 scanlines (50, 150, … 850 m): 7 whole spans, 2 split by the hole; 5 points each.
  assert.equal(pts.length, (7 + 2 * 2) * 5)
  for (const [e, n] of pts) assert.ok(inPolygon([OUTER, HOLE], e, n), `${e},${n}`)
  // A whole span (1000 m) beats the split ones (400 m): its middle, which the hole's spans never reach.
  assert.equal(pts[0]![0], 500)
  assert.ok(pts[0]![1] < 300 || pts[0]![1] > 500)
  // The middles of the spans either side of the hole.
  assert.ok(pts.some(([e, n]) => e === 200 && n === 350))
  assert.ok(pts.some(([e, n]) => e === 800 && n === 350))
  // Clear of the top 100 m band.
  assert.ok(pts.every(([, n]) => n <= 900))
})

test("insidePoints orders middles, quarters, then 2 m in from the ends, each widest span first", () => {
  const triangle = [0, 0, 1000, 0, 500, 1000, 0, 0]
  // 3 scanlines between 0 and 900 m (the top 100 m left out): spans 75..925, 225..775, 375..625.
  assert.deepEqual(insidePoints([[triangle]], 3), [
    [500, 150],
    [500, 450],
    [500, 750],
    [287.5, 150],
    [362.5, 450],
    [437.5, 750],
    [712.5, 150],
    [637.5, 450],
    [562.5, 750],
    [77, 150],
    [227, 450],
    [377, 750],
    [923, 150],
    [773, 450],
    [623, 750],
  ])
})

test("insidePoints on a real sliver and a multipolygon: every point inside, none in the top 100 m", () => {
  const [, lidar] = parseGml(GML)
  const polygons = lidar!.polygons
  const pts = insidePoints(polygons)
  assert.ok(pts.length > 0)
  const top = Math.max(...polygons.flat(2).filter((_, i) => i % 2 === 1))
  for (const [e, n] of pts) {
    assert.ok(
      polygons.some((p) => inPolygon(p, e, n)),
      `${e},${n}`,
    )
    assert.ok(n <= top - 100)
  }
  // The 80 m by 297 m wedge on its own.
  const wedge = polygons[0]!
  for (const [e, n] of insidePoints([wedge])) assert.ok(inPolygon(wedge, e, n), `${e},${n}`)
})

test("insidePoints keeps the points 2 m in from the ends inside a span narrower than 2 m", () => {
  const wedge = [0, 0, 20, 300, 0, 300, 0, 0]
  for (const [e, n] of insidePoints([[wedge]])) assert.ok(pointInRing(e, n, wedge), `${e},${n}`)
})

test("insidePoints on a footprint shorter than 100 m spreads its points inside it", () => {
  // 200 m by 60 m, tilted by 30 cm like the real footprints.
  const short = [0, 0, 200, 0.3, 200, 60.3, 0, 60, 0, 0]
  const pts = insidePoints([[short]])
  for (const [e, n] of pts) assert.ok(pointInRing(e, n, short), `${e},${n}`)
  assert.ok(new Set(pts.map(([, n]) => n)).size > 1)
})
