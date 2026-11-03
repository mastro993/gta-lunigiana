// Downloads Regione Liguria's sources over a part (issue #12) and writes them to data/raw/lig/<part>
// (`ligDir`). Run: node src/tools/fetch-lig.ts <part>  (pnpm fetch-lig <part>), for a Lunigiana part
// or a test region's (`region.ts`), from its rectangles. Every answer is CC BY 4.0 (`liguria.ts`),
// and each file's bytes come out the same on every run against the same data: the WFS's per-answer
// `timeStamp` and its page links are dropped, and the WCS gives the same GeoTIFF bytes each time. A
// file whose bytes the lock does not hold is recorded there with its source, for `pnpm pin-raw`
// (`raw-lock.ts`). `fetch-rt` reads the DTM's crops as its chain's step past the 10 m DTMs.
// - nc5/<layer>.json.gz: the NC5 layers of NC5_LAYERS whose features' bounding boxes meet the
//   part's EPSG:25832 box, sorted by `ogr_fid`, each feature's attributes as served and its polygons
//   as flat rings [e, n, z, …] on whole centimetres; the mapped area (L6945), one polygon of 942 km²
//   over La Spezia's lot, clipped to the box. Each file holds its box and the server's count.
// - dtm/<i>_<j>.tif: the DTM ed. 2023's native 5 m cells over each 2 km tile of the part, as the WCS
//   gives them (a deflated GeoTIFF in EPSG:3003), its EPSG:3003 box widened by DTM_PAD; none for a
//   tile without a cell of data (beyond the regional border).
// - uds.json.gz: the land use ed. 2025's polygons of the classes `ucs.ts` keeps, as `ucs.json.gz`
//   holds the Tuscan land cover: {crs, year, polygons: [{id, code, rings}]}, sorted by id (`ID_RLIG`),
//   the code the whole of `COD_USO` (3 or 4 digits), the rings flat [e, n, …] on decimetres; empty
//   where no kept class lies.
import { join } from "node:path"
import { parseArgs } from "node:util"

import { TILE } from "../sim/map/kinds.ts"
import { clipRing, gaussBoagaBox, utm32Box } from "./geometry.ts"
import {
  dtmCropUrl,
  fetchWfs,
  NC5_LAYERS,
  nc5Query,
  polygonsOfFeature,
  udsQuery,
  type WfsFeature,
  wfsUrl,
} from "./liguria.ts"
import { getText, request } from "./net.ts"
import { fetchedToday, writeRaw } from "./raw-lock.ts"
import { ligDir, partOf, type Rect, tilesOf } from "./region.ts"
import { geoTiffRaster } from "./terrain-sources.ts"
import { UCS_CODES } from "./ucs.ts"

/** How far past its tile a DTM crop reaches, m: the mosaic's MARGIN (32 m), the low-pass and the bilinear's cells, rounded up. */
const DTM_PAD = 50

const ROOT = join(import.meta.dirname, "../..")
const { positionals } = parseArgs({ allowPositionals: true, strict: true })
if (positionals.length !== 1) throw new Error("usage: fetch-lig <part>")
const part = partOf(positionals[0])
const OUT = join(ROOT, ligDir(part))
/** The part's EPSG:25832 box, on whole metres outwards: the WFS's box filter is a superset of it. */
const box = utm32Box(part.rects).map((v, k) =>
  k < 2 ? Math.floor(v) : Math.ceil(v),
) as unknown as Rect

/** The JSON of `value`, gzipped, as `name` under the part's folder, recorded with `source`. */
const writeJson = (name: string, value: unknown, source: string): void =>
  writeRaw(join(OUT, name), Buffer.from(JSON.stringify(value)), source)

/** A polygon's rings clipped to `box`, Z 0 (the mapped area's own), those left with an area. */
const clipped = (rings: ReadonlyArray<ReadonlyArray<number>>): Array<Array<number>> =>
  rings.flatMap((ring) => {
    const pairs: Array<readonly [number, number]> = []
    for (let i = 0; i < ring.length; i += 3) pairs.push([ring[i]!, ring[i + 1]!])
    const cut = clipRing(pairs, box)
    return cut.length < 3 ? [] : [cut.flatMap(([e, n]) => [round2(e), round2(n), 0])]
  })
const round2 = (v: number) => Math.round(v * 100) / 100

for (const layer of Object.values(NC5_LAYERS)) {
  const q = nc5Query(layer, box)
  const features = await fetchWfs(q, getText)
  const kept = features.flatMap((f: WfsFeature) => {
    const polygons = polygonsOfFeature(f)
    const shapes = layer === NC5_LAYERS.mapped ? polygons.map(clipped) : polygons
    const left = shapes.filter((rings) => rings.length > 0)
    return left.length === 0 ? [] : [{ properties: f.properties, polygons: left }]
  })
  writeJson(
    `nc5/${layer}.json.gz`,
    {
      layer: `${q.map}:${q.layer}`,
      crs: "EPSG:25832",
      box,
      numberMatched: features.length,
      features: kept,
    },
    fetchedToday(wfsUrl(q, 0)),
  )
  console.log({ layer, features: features.length })
}

let crops = 0
for (const { i, j } of tilesOf(part.rects)) {
  const tile: Rect = [i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE]
  const url = dtmCropUrl(gaussBoagaBox([tile], DTM_PAD))
  const res = await request(url)
  // A crop wholly beyond the coverage's grid: "Empty intersection after subsetting".
  if (res.status === 404) {
    await res.body?.cancel()
    continue
  }
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if ((await geoTiffRaster(bytes, 3003)).z.every(Number.isNaN)) continue
  writeRaw(
    join(OUT, "dtm", `${i}_${j}.tif`),
    bytes,
    fetchedToday(url),
    (b) => b,
    (b) => b,
  )
  crops++
}
console.log({ dtm: crops })

const uq = udsQuery(box, Object.keys(UCS_CODES))
const uds = (await fetchWfs(uq, getText)).flatMap((f) => {
  const code = String(f.properties.COD_USO)
  if (!Object.hasOwn(UCS_CODES, code.slice(0, 3))) throw new Error(`land use code ${code} not kept`)
  return polygonsOfFeature(f).map((rings) => ({
    id: Number(f.properties.ID_RLIG),
    code,
    rings: rings.map((ring) =>
      ring.flatMap((v, k) => (k % 3 === 2 ? [] : [Math.round(v * 10) / 10])),
    ),
  }))
})
writeJson(
  "uds.json.gz",
  { crs: "EPSG:25832", year: 2025, polygons: uds },
  fetchedToday(wfsUrl(uq, 0)),
)
console.log({ uds: uds.length })
