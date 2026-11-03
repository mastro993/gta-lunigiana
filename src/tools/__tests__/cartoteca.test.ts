import assert from "node:assert/strict"
import { test } from "node:test"

import {
  RT_DOWNLOAD,
  RT_WMS,
  SURVEYORS,
  ctr10kUrl,
  ctrUrl,
  dbt2kUrl,
  gfiUrl,
  insidePoints,
  lidarLicence,
  meetingBox,
  parseCtr10kGfi,
  parseDbtGfi,
  parseGml,
  parseLidarGfi,
  wfsUrl,
  withoutSurveyors,
} from "../cartoteca.ts"
import { pointInRing } from "../geometry.ts"
import { parseShp } from "../shp.ts"
import { shapefile } from "./shapefile.ts"

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

test("the archive URLs: the CTR 1:2000 by sheet and edition, the CTR 1:10 000 under its 1:50 000 sheet, the DBT's .7z", () => {
  assert.equal(ctrUrl("23D11"), `${RT_DOWNLOAD}/ctr2k/SHP/S_23D11_2019_6707.zip`)
  assert.equal(ctrUrl("22D04", 2009), `${RT_DOWNLOAD}/ctr2k/SHP/S_22D04_2009_6707.zip`)
  assert.equal(
    ctr10kUrl("S_249020_2010_6707_a797026656fac288e794d5fdc6336ae5"),
    `${RT_DOWNLOAD}/ctr10k/SHP/249/S_249020_2010_6707_a797026656fac288e794d5fdc6336ae5.zip`,
  )
  assert.equal(
    dbt2kUrl("DBT2K_045014_PONTREMOLI_2010_2010_3003_21f45aa3f469081de7f71f76d5913f2b"),
    `${RT_DOWNLOAD}/dbtopografico/dbt2k/7z/DBT2K_045014_PONTREMOLI_2010_2010_3003_21f45aa3f469081de7f71f76d5913f2b.7z`,
  )
  // A name without its MD5, or a URL in its place, is a manifest's typo.
  assert.throws(() => ctr10kUrl("249020"), /not a CTR 1:10 000 archive name/)
  assert.throws(() => dbt2kUrl("DBT2K_045014_PONTREMOLI_2010_2010_3003"), /not a DBT 1:2000/)
})

test("gfiUrl asks a cartoteca layer at the middle pixel of a box round the point", () => {
  const url = new URL(gfiUrl("rt_cartoteca.lidar2k", 44.15, 10.1))
  assert.equal(`${url.origin}${url.pathname}`, RT_WMS)
  const q = url.searchParams
  assert.equal(q.get("REQUEST"), "GetFeatureInfo")
  assert.equal(q.get("LAYERS"), "rt_cartoteca.lidar2k")
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

/**
 * Trimmed from the real text/html GetFeatureInfo on rt_cartoteca.ctr10k inside section 249030
 * (2026-11-03): its 1995, 2010 and 2021 editions, each with fewer of its links.
 */
const CTR10K_GFI = `<tr><td><font size="-1" face="Arial">Strato: <b>Download dataset "sezione di Carta Tecnica Regionale scala 1:10.000" </b></font></td><td colspan="3">&nbsp;</td></tr>
<!-- rt_found -->
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Sezione <b>249030</b></font></td>
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Titolo:<b>MINUCCIANO</b></font></td>
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Volo:<b>27061995</b></font></td>
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Sezione:<b>249030</b></font></td>
		<tr><td><font size='-1' face='Arial'><a href='https://www502.regione.toscana.it/geoscopio/download/ctr10k/SHP/249/S_249030_1995_3003_39e50eb6ee2a92d43c0b442655826e30.zip'>Scarica il dataset in formato SHP in Gauss-Boaga Fuso Ovest (epsg:3003)</a></font></td></tr>
		<tr><td><font size='-1' face='Arial'><a href='https://www502.regione.toscana.it/geoscopio/download/ctr10k/SHP/249/S_249030_1995_6707_9f0e3bd3e8bfe85d971eced47c88ac32.zip'>Scarica il dataset in formato SHP in RDN2008 (epsg:6707)</a></font></td></tr>
		<br />Distribuzione con <a rel='license' href='https://creativecommons.org/licenses/by/3.0/it' target='_blank'>Licenza Creative Commons Attribuzione 3.0 Italia</a>.
<!-- rt_found -->
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Sezione <b>249030</b></font></td>
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Titolo:<b>MINUCCIANO</b></font></td>
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Volo:<b>16072010</b></font></td>
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Sezione:<b>249030</b></font></td>
		<tr><td><font size='-1' face='Arial'><a href='https://www502.regione.toscana.it/geoscopio/download/ctr10k/DXF_D/249/D_249030_2010_6707_23daddc98e010c6a0464bb471a49a248.zip'>Scarica il dataset in formato DXF vestito in RDN2008 (epsg:6707)</a></font></td></tr>
		<tr><td><font size='-1' face='Arial'><a href='https://www502.regione.toscana.it/geoscopio/download/ctr10k/SHP/249/S_249030_2010_3003_0de7f719eac3b75e151f12493106df8d.zip'>Scarica il dataset in formato SHP in Gauss-Boaga Fuso Ovest (epsg:3003)</a></font></td></tr>
		<tr><td><font size='-1' face='Arial'><a href='https://www502.regione.toscana.it/geoscopio/download/ctr10k/SHP/249/S_249030_2010_6707_d8e7c90d0ab22493e37b3172cb91b523.zip'>Scarica il dataset in formato SHP in RDN2008 (epsg:6707)</a></font></td></tr>
		<br />Distribuzione con Licenza <a rel='license' href='https://creativecommons.org/licenses/by/4.0/'>Creative Commons Attribuzione 4.0 Internazionale</a>.
<!-- rt_found -->
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Sezione <b>249030</b></font></td>
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Titolo:<b></b></font></td>
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Volo:<b>12082021</b></font></td>
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Sezione:<b>249030</b></font></td>
		<tr><td><font size='-1' face='Arial'><a href='https://www502.regione.toscana.it/geoscopio/download/ctr10k/SHP/249/S_249030_2021_3003_.zip'>Scarica il dataset in formato SHP in Gauss-Boaga Fuso Ovest (epsg:3003)</a></font></td></tr>
		<tr><td><font size='-1' face='Arial'><a href='https://www502.regione.toscana.it/geoscopio/download/ctr10k/SHP/249/S_249030_2021_7791_.zip'>Scarica il dataset in formato SHP in RDN2008 (epsg:7791)</a></font></td></tr>
		<br />Distribuzione con Licenza <a rel='license' href='https://creativecommons.org/licenses/by/4.0/'>Creative Commons Attribuzione 4.0 Internazionale</a>.
</table>
`

test("parseCtr10kGfi reads each edition's section, RDN2008 shapefile archive and licence", () => {
  assert.deepEqual(parseCtr10kGfi(CTR10K_GFI), [
    {
      section: "249030",
      shp: "S_249030_1995_6707_9f0e3bd3e8bfe85d971eced47c88ac32",
      licence: "CC BY 3.0 IT",
    },
    {
      section: "249030",
      shp: "S_249030_2010_6707_d8e7c90d0ab22493e37b3172cb91b523",
      licence: "CC BY 4.0",
    },
    // The 2021 editions name no MD5 and come in EPSG:7791.
    {
      section: "249030",
      shp: "S_249030_2021_7791_",
      licence: "CC BY 4.0",
    },
  ])
  // The DXF and EPSG:3003 links are not the archive; an edition with no shapefile has none.
  const noShp = CTR10K_GFI.replaceAll(/<a href='[^']*\/SHP\/[^']*'>/g, "<a href='x'>")
  assert.ok(parseCtr10kGfi(noShp).every((e) => !("shp" in e)))
  // The answer at a corner the sections share: no block.
  assert.deepEqual(parseCtr10kGfi(CTR10K_GFI.slice(0, CTR10K_GFI.indexOf("<!-- rt_found -->"))), [])
})

/** Trimmed from the real text/html GetFeatureInfo on rt_cartoteca.dbt.2k in Minucciano (2026-11-03): the comune's two surveys. */
const DBT_GFI = `<tr><td><font size="-1" face="Arial">Strato: <b>Download dataset "Database Topografico scala 1:2000 tagliato per comune" in formato shapefile</b></font></td><td colspan="3">&nbsp;</td></tr>
<!-- rt_found -->
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Comune <b>MINUCCIANO : Anni volo da 2011 a 2011</b></font></td>
        <td colspan="1" rowspan="1" align="left" valign="top"><font size="-1" face="Arial">Scarica il dataset <a href="https://www502.regione.toscana.it/geoscopio/download/dbtopografico/dbt2k/7z/DBT2K_046019_MINUCCIANO_2011_2011_3003_55abb15279c81a6b3756d9bdfc1f6124.7z">&gt;&gt;&gt;</a></font></td>
<br />Distribuzione con <a rel="license" href="https://creativecommons.org/licenses/by/4.0" target="_blank">Licenza Creative Commons Attribuzione 4.0</a>.
<!-- rt_found -->
        <td align="left" colspan="1" rowspan="1"><font size="-1" face="Arial">Comune <b>MINUCCIANO : Anni volo da 1988 a 2000</b></font></td>
        <td colspan="1" rowspan="1" align="left" valign="top"><font size="-1" face="Arial">Scarica il dataset <a href="https://www502.regione.toscana.it/geoscopio/download/dbtopografico/dbt2k/7z/DBT2K_046019_MINUCCIANO_1988_2000_3003_53bfaef25ab5d865864f6b6a281009d9.7z">&gt;&gt;&gt;</a></font></td>
<br />Distribuzione con <a rel="license" href="https://creativecommons.org/licenses/by/4.0" target="_blank">Licenza Creative Commons Attribuzione 4.0</a>.
</table>
`

test("parseDbtGfi reads each survey's flight years, archive and licence", () => {
  assert.deepEqual(parseDbtGfi(DBT_GFI), [
    {
      from: 2011,
      to: 2011,
      archive: "DBT2K_046019_MINUCCIANO_2011_2011_3003_55abb15279c81a6b3756d9bdfc1f6124",
      licence: "CC BY 4.0",
    },
    {
      from: 1988,
      to: 2000,
      archive: "DBT2K_046019_MINUCCIANO_1988_2000_3003_53bfaef25ab5d865864f6b6a281009d9",
      licence: "CC BY 4.0",
    },
  ])
  const bare = DBT_GFI.replace(/<a href="[^"]*\.7z">/, "<a>").replaceAll(
    /<a rel="license"[^>]*>/g,
    "",
  )
  const [first, second] = parseDbtGfi(bare)
  assert.ok(!("archive" in first!))
  assert.equal(first!.licence, "unknown")
  assert.equal(
    second!.archive,
    "DBT2K_046019_MINUCCIANO_1988_2000_3003_53bfaef25ab5d865864f6b6a281009d9",
  )
  // A comune with no DBT (Bagnone): no block.
  assert.deepEqual(parseDbtGfi(DBT_GFI.slice(0, DBT_GFI.indexOf("<!-- rt_found -->"))), [])
})

/** A square ring [x0, y0]…[x0 + 10, y0 + 10] at height 0. */
const square = (x0: number, y0: number) =>
  [
    [x0, y0, 0],
    [x0, y0 + 10, 0],
    [x0 + 10, y0 + 10, 0],
    [x0 + 10, y0, 0],
    [x0, y0, 0],
  ] as const

test("withoutSurveyors keeps every record of a mapped area and blanks only the surveyors' names", () => {
  const people = Object.fromEntries(SURVEYORS.map((f) => [f, "Xxxx Yyyy"]))
  const { shp, dbf } = shapefile(15, [
    { parts: [square(0, 0)], attrs: { Codice: "0906", Ditta_es: "firm", ...people } },
    { parts: [square(20, 0)], attrs: { Codice: "0906", Ditta_es: "firm", ...people } },
  ])
  const copy = withoutSurveyors(shp, dbf)
  // The rings stay as they were, byte for byte.
  assert.ok(copy.shp.equals(shp))
  const blank = Object.fromEntries(SURVEYORS.map((f) => [f, ""]))
  assert.deepEqual(
    parseShp(copy.shp, copy.dbf).map((r) => r.attrs),
    [0, 1].map(() => ({ Codice: "0906", Ditta_es: "firm", ...blank })),
  )
  assert.ok(!copy.dbf.includes("Xxxx"))
  // A table without them is not the old schema's mapped area.
  const other = shapefile(15, [{ parts: [square(0, 0)], attrs: { Codice: "0906" } }])
  assert.throws(() => withoutSurveyors(other.shp, other.dbf), /no field Dir_lav/)
})

test("meetingBox keeps the records whose box meets the box, edges included, and none when none does", () => {
  const { shp, dbf } = shapefile(15, [
    { parts: [square(0, 0)], attrs: { id: "inside" } },
    { parts: [square(95, 0)], attrs: { id: "across the edge" } },
    { parts: [square(100, 50)], attrs: { id: "on the edge" } },
    { parts: [square(200, 0)], attrs: { id: "outside" } },
    { parts: [square(0, -11)], attrs: { id: "below" } },
  ])
  const kept = meetingBox(shp, dbf, [-5, -0.5, 100, 100])!
  assert.deepEqual(
    parseShp(kept.shp, kept.dbf).map((r) => r.attrs.id),
    ["inside", "across the edge", "on the edge"],
  )
  assert.equal(meetingBox(shp, dbf, [1000, 1000, 2000, 2000]), undefined)
})
