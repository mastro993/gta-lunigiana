// Downloads Regione Liguria's sources over a part (issue #12) and writes them to data/raw/lig/<part>
// (`ligDir`). Run: node src/tools/fetch-lig.ts <part>  (pnpm fetch-lig <part>), for a Lunigiana part
// or a test region's (`region.ts`), from its rectangles. Every answer is CC BY 4.0 (`liguria.ts`),
// and each file's bytes come out the same on every run against the same data: the WFS's per-answer
// `timeStamp` and its page links are dropped, and the WCS gives the same GeoTIFF bytes each time. A
// file whose bytes the lock does not hold is recorded there with its source, for `pnpm pin-raw`
// (`raw-lock.ts`). `fetch-rt` reads the DTM's crops as its chain's step past the 10 m DTMs, so run
// this first.
// - nc5/<layer>.json.gz: the NC5 layers of NC5_LAYERS whose features' bounding boxes meet the
//   part's EPSG:25832 box, sorted by `ogr_fid` (`nc5File`): each feature's attributes as served and
//   its polygons as flat rings [e, n, z, …] on whole centimetres; the mapped area (L6945), one
//   polygon of 942.57 km² over La Spezia's lot, clipped to the box. Each file holds its box and the
//   server's count.
// - dtm/<i>_<j>.tif: the DTM ed. 2023's native 5 m cells over each 2 km tile round fetch-rt's crop
//   of the part (`dtmTiles`, `dtmCropBox`), as the WCS gives them (a deflated GeoTIFF in EPSG:3003);
//   none for a tile beyond the coverage or without a cell of data (past the regional border), and a
//   crop left from an earlier run that it no longer writes is deleted with its lock entry.
// - uds.json.gz: the land use ed. 2025's polygons of the classes `ucs.ts` keeps, as `ucs.json.gz`
//   holds the Tuscan land cover: {crs, year, polygons: [{id, code, rings}]}, sorted by id (`ID_RLIG`),
//   the code the whole of `COD_USO` (3 or 4 digits), the rings flat [e, n, …] on decimetres; empty
//   where no kept class lies.
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { utm32Box } from "./geometry.ts"
import {
  beyondCoverage,
  dtmCropBox,
  dtmCropUrl,
  dtmTiles,
  fetchWfs,
  NC5_LAYERS,
  nc5File,
  nc5Query,
  staleCrops,
  udsPolygons,
  udsQuery,
  wfsUrl,
} from "./liguria.ts"
import { getText, request } from "./net.ts"
import { dropRaw, fetchedToday, writeRaw } from "./raw-lock.ts"
import { ligDir, partOf, type Rect } from "./region.ts"
import { geoTiffRaster } from "./terrain-sources.ts"
import { kindOfCode, UCS_CODES } from "./ucs.ts"

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

for (const layer of Object.values(NC5_LAYERS)) {
  const q = nc5Query(layer, box)
  const features = await fetchWfs(q, getText)
  writeJson(`nc5/${layer}.json.gz`, nc5File(q, box, features), fetchedToday(wfsUrl(q, 0)))
  console.log({ layer, features: features.length })
}

const crops = new Set<string>()
for (const { i, j } of dtmTiles(part.rects)) {
  const url = dtmCropUrl(dtmCropBox(i, j))
  const res = await request(url)
  if (!res.ok) {
    const body = await res.text()
    if (beyondCoverage(res.status, body)) continue
    throw new Error(`${url}: HTTP ${res.status} ${body.slice(0, 400)}`)
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  if ((await geoTiffRaster(bytes, 3003)).z.every(Number.isNaN)) continue
  const name = `${i}_${j}.tif`
  writeRaw(
    join(OUT, "dtm", name),
    bytes,
    fetchedToday(url),
    (b) => b,
    (b) => b,
  )
  crops.add(name)
}
for (const name of staleCrops(
  existsSync(join(OUT, "dtm")) ? readdirSync(join(OUT, "dtm")) : [],
  crops,
))
  dropRaw(join(OUT, "dtm", name))
console.log({ dtm: crops.size })

const uq = udsQuery(box, Object.keys(UCS_CODES))
// The query asks by the third level; a fourth-level class not kept (`kindOfCode`) is left out.
const uds = udsPolygons(await fetchWfs(uq, getText), Object.keys(UCS_CODES)).filter(
  ({ code }) => kindOfCode(code) !== undefined,
)
writeJson(
  "uds.json.gz",
  { crs: "EPSG:25832", year: 2025, polygons: uds },
  fetchedToday(wfsUrl(uq, 0)),
)
console.log({ uds: uds.length })
