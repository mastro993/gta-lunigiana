// Downloads the Regione Toscana sources (Geoscopio cartoteca) and writes the pinned subsets the map
// build reads to data/raw/rt. Run: node src/tools/fetch-rt.ts  (pnpm fetch-rt), or
// `node src/tools/fetch-rt.ts ctr` (pnpm fetch-rt ctr) for the CTR sheets alone, which leaves the
// terrain and the land cover as they are, or `ucs` for the land cover alone. What it downloads
// comes from the part's manifest, data/parts/<part>.json (`manifest.ts`); it reads one part,
// today's (`lucido` in `region.ts`), until #17 brings `fetch-rt <part>` and the per-part raw
// layout. With `--region <key>` of a test region with terrain of its own (`ownTerrain`, issue #10)
// it writes that region's terrain alone, to data/raw/rt/<key>. Needs `unzip` on the PATH. The
// archives are cached in the OS temp directory (`rt-cache.ts`). A file whose unpacked bytes equal
// the new ones is not rewritten, so another zlib never churns a pinned file. Either way, a file whose
// bytes the lock does not hold is recorded there with its source, for `pnpm pin-raw` (`raw-lock.ts`).
// - ctr/<sheet>_<layer>.shp.gz + .dbf.gz: CTR 1:2000, 2019 flight, EPSG:6707 (CC BY 4.0). AED =
//   buildings, AGE = other areas (garages, ruins, station platforms, level crossings), AVI = road
//   areas, AZR = the mapped area of each sheet, AFE = the rail ballast bed (its bridge and tunnel
//   spans), VLI = the railway track centrelines only (code 0117; the rest of the layer, mostly
//   contour lines, is dropped). Some sheets map only part of their frame; where none does, OSM
//   fills in. A sheet may lack AGE, AVI or AFE (nothing of the kind in it) and has a VLI file only
//   where a track runs.
// - dtm.json + dtm.bin + dtm-src.bin: the terrain, EPSG:3003, on 1 m cells cropped to the play area
//   plus MARGIN (`dtm-mosaic.ts`): the manifest's LiDAR DTM tiles (CC BY 4.0) in priority order (a
//   cell keeps the first value written; for lucido the 2010 flight, then the 2012 flight for the
//   Carrara side of the ridge and Monte Sagro, which 2010 flew only in part), then the fallback
//   chain for the cells no tile has (`fill-chain.ts`, `terrain-sources.ts`): the 2021 surface
//   model on open ground, the province 10 m DTMs, Emilia-Romagna's DTM 5x5 beyond Tuscany, each
//   bent onto the sources before it. Averaged to 2 m cells (the game grid is 4 m); int16
//   decimetres, each row delta-coded, deflated; dtm-src.bin holds each 2 m cell's source.
// - ucs.json.gz: land cover 1:10 000, 2019 ("Uso e copertura del suolo", CC BY 4.0), EPSG:3003:
//   the open covers OSM mostly lacks in the mountains (quarries, bare rock, sparse vegetation,
//   pastures, heath), the rivers' gravel and the water bodies, from the WFS.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { deflateSync, gunzipSync, gzipSync, inflateSync } from "node:zlib"

import { UCS, ctrUrl, dsm2021Url, dtm10Url, lidarUrl, parseGml, wfsUrl } from "./cartoteca.ts"
import { cropOf, eachCell } from "./dtm-mosaic.ts"
import { type Filler, NONE, fillStep } from "./fill-chain.ts"
import { manifestPath, readManifest } from "./manifest.ts"
import { getBytes, getText } from "./net.ts"
import { fetchedToday, recordSource } from "./raw-lock.ts"
import { REGION, dtmDir } from "./region.ts"
import { fetchZip, findFile, mustFind } from "./rt-cache.ts"
import { subsetShp } from "./shp.ts"
import {
  SOURCES,
  ascWindow,
  clearCanopy,
  codeOf,
  geoTiffRaster,
  openGround,
  rasterFiller,
  rerUrl,
  utmBox,
  utmOfCrop,
} from "./terrain-sources.ts"
import { UCS_CODES } from "./ucs.ts"

const ROOT = join(import.meta.dirname, "../..")
const { positionals } = parseArgs({
  allowPositionals: true,
  options: { region: { type: "string" } },
  strict: true,
})
/** `ctr` fetches the CTR sheets alone, `ucs` the land cover alone; no argument fetches everything. */
const stage = positionals[0]
if (positionals.length > 1 || (stage !== undefined && stage !== "ctr" && stage !== "ucs"))
  throw new Error(`unknown stage ${positionals.join(" ")}: use ctr, ucs or none`)
if (REGION.id !== "lunigiana") throw new Error(`fetch-rt fetches for Lunigiana, not ${REGION.key}`)
if (REGION.test && !REGION.ownTerrain)
  throw new Error(`--region ${REGION.key} is built from Lunigiana's inputs: fetch none for it`)
if (REGION.ownTerrain && stage !== undefined)
  throw new Error(`--region ${REGION.key} has terrain alone: run fetch-rt without a stage`)
// One part until #17 writes a DTM file a tile (rt/dtm/<i>_<j>): one mosaic over two parts would widen
// its crop over the land between them.
if (REGION.parts.length !== 1)
  throw new Error(
    `fetch-rt mosaics one part; ${REGION.key} has ${REGION.parts.length} (fetch-rt <part> comes with #17)`,
  )
const [PART] = REGION.parts
const OUT = join(ROOT, dtmDir(REGION))
if (!existsSync(manifestPath(PART!.key)))
  throw new Error(`no data/parts/${PART!.key}.json: run pick-sheets and pick-lidar with --write`)
const manifest = readManifest(PART!.key)
/** The 2019 CTR 1:2000 sheets that map ground in the play area (cartoteca layer rt_cartoteca.ctr2k). */
const CTR_SHEETS = REGION.ownTerrain ? [] : manifest.ctr
/** Layers copied whole; AED and AZR are in every sheet. */
const CTR_LAYERS = ["AED", "AGE", "AVI", "AZR", "AFE"] as const
/** CTR code of a railway track centreline, the only VLI records kept. */
const TRACK = "0117"
/**
 * The LiDAR DTM tiles with data in the crop (cartoteca layer rt_cartoteca.lidar2k; the suffix is
 * the archive's MD5), in priority order: a cell keeps the first value written.
 */
const DTM_TILES = manifest.lidar

/**
 * Writes `bytes`, packed, to `path`, unless the file there already unpacks to the same bytes, and
 * records the file with where they came from (`source`) unless the lock holds it already.
 */
const pin = (
  path: string,
  bytes: Buffer,
  source: string,
  pack: (b: Buffer) => Buffer = (b) => gzipSync(b, { level: 9 }),
  unpack: (b: Buffer) => Buffer = gunzipSync,
): void => {
  if (!existsSync(path) || !unpack(readFileSync(path)).equals(bytes)) {
    writeFileSync(path, pack(bytes))
    console.log(`wrote ${path.slice(ROOT.length + 1)}`)
  }
  recordSource(path, source)
}

mkdirSync(REGION.ownTerrain ? OUT : join(OUT, "ctr"), { recursive: true })

for (const sheet of stage === "ucs" ? [] : CTR_SHEETS) {
  const dir = await fetchZip(ctrUrl(sheet))
  const out = (layer: string, ext: string) => join(OUT, "ctr", `${sheet}_${layer}.${ext}.gz`)
  for (const layer of CTR_LAYERS)
    for (const ext of ["shp", "dbf"]) {
      const name = `S_${sheet}_2019_${layer}.${ext}`,
        file = layer === "AED" || layer === "AZR" ? mustFind(dir, name) : findFile(dir, name)
      if (file !== undefined) pin(out(layer, ext), readFileSync(file), ctrUrl(sheet))
    }
  const tracks = subsetShp(
    readFileSync(mustFind(dir, `S_${sheet}_2019_VLI.shp`)),
    readFileSync(mustFind(dir, `S_${sheet}_2019_VLI.dbf`)),
    (attrs) => attrs.Cod_CTR === TRACK,
  )
  if (tracks !== undefined) {
    pin(out("VLI", "shp"), tracks.shp, ctrUrl(sheet))
    pin(out("VLI", "dbf"), tracks.dbf, ctrUrl(sheet))
  }
}
if (stage === "ctr") process.exit(0)

// The crop: play-area corners in Gauss-Boaga, widened by MARGIN, on the tiles' cell centres (x.5).
const crop = cropOf(PART!.rects)
const { e0, n0, cols, rows } = crop

// Land cover: every polygon whose box meets the crop. The server's BBOX filter sometimes loses
// features near the box's edge, so the box is padded by UCS.pad (readUcs clips). Lucido pins those
// of the kept classes, sorted by id, in EPSG:3003 to the decimetre, rings as gml gives them (outer
// first); the open ground among them is where the surface model may fill the terrain. A region
// with terrain alone asks only when its manifest lists the surface model.
const ucsUrl = wfsUrl(UCS.map, UCS.layer, [
  e0 - UCS.pad,
  n0 - UCS.pad,
  e0 + cols + UCS.pad,
  n0 + rows + UCS.pad,
])
const asksUcs = !REGION.ownTerrain || manifest.dsm2021.length > 0
const features = asksUcs ? parseGml(await getText(ucsUrl)) : []
if (!REGION.ownTerrain) {
  // One entry per polygon (a multipolygon has several), each its outer ring then its holes.
  const ucs = features
    .flatMap(({ attrs, polygons }) =>
      Object.hasOwn(UCS_CODES, attrs.ucs2019 ?? "")
        ? polygons.map((rings) => ({
            id: Number(attrs.pk_uid),
            code: attrs.ucs2019!,
            rings: rings.map((ring) => ring.map((v) => Math.round(v * 10) / 10)),
          }))
        : [],
    )
    .sort((a, b) => a.id - b.id)
  if (ucs.length === 0) throw new Error("UCS WFS: no polygons")
  pin(
    join(OUT, "ucs.json.gz"),
    Buffer.from(JSON.stringify({ crs: "EPSG:3003", year: 2019, polygons: ucs })),
    fetchedToday(ucsUrl),
  )
  console.log({ ucs: ucs.length })
}
if (stage === "ucs") process.exit(0)

// The LiDAR, decimetres, a cell keeping the first tile's value; NaN where no tile has one.
const dm = new Float32Array(cols * rows).fill(Number.NaN) // row 0 = south
const src = new Uint8Array(cols * rows).fill(NONE)
for (const tile of DTM_TILES) {
  const lines = readFileSync(mustFind(await fetchZip(lidarUrl(tile)), "*.asc"), "latin1").split(
    "\n",
  )
  eachCell(lines, crop, tile, (k, z) => {
    if (Number.isNaN(dm[k]!)) {
      dm[k] = Math.round(z * 10)
      src[k] = codeOf("lidar")
    }
  })
}

/** A box of crop cells [c0, r0, c1, r1], ends included. */
type Box = [number, number, number, number]
/** The crop cells still empty, as a box; undefined when none is. */
const emptyBox = (): Box | undefined => {
  let c0 = cols,
    r0 = rows,
    c1 = -1,
    r1 = -1
  for (let k = 0; k < dm.length; k++)
    if (Number.isNaN(dm[k]!)) {
      const c = k % cols,
        r = Math.floor(k / cols)
      ;[c0, r0, c1, r1] = [Math.min(c0, c), Math.min(r0, r), Math.max(c1, c), Math.max(r1, r)]
    }
  return c1 < 0 ? undefined : [c0, r0, c1, r1]
}
/** The EPSG:3003 box round a box of crop cells' centres, padded by `pad` m. */
const gbAround = ([c0, r0, c1, r1]: Box, pad: number): Box => [
  e0 + c0 - pad,
  n0 + r0 - pad,
  e0 + c1 + pad,
  n0 + r1 + pad,
]
/** The EPSG:7791 box round a box of crop cells' centres, padded by `pad` m. */
const utmAround = ([c0, r0, c1, r1]: Box, pad: number): Box => {
  const [x0, y0, x1, y1] = utmBox({
    e0: e0 + c0,
    n0: n0 + r0,
    cols: c1 - c0 + 1,
    rows: r1 - r0 + 1,
  })
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad]
}
const utm = utmOfCrop(crop)
/** The 10 m DTMs of the manifest named, over a box of crop cells, as one filler: the first with data at a cell wins. */
const dtm10 = async (names: ReadonlyArray<string>, box: Box): Promise<Filler> => {
  const rasters = []
  for (const name of names) {
    const file = mustFind(await fetchZip(dtm10Url(name)), "*.asc")
    const raster = ascWindow(readFileSync(file), gbAround(box, 10), name)
    if (raster !== undefined) rasters.push(raster)
  }
  return rasterFiller("dtm10", crop, rasters)
}
/** The chain after the LiDAR, each step loaded once cells are still empty, with where it comes from. */
const steps: Array<(box: Box) => Promise<{ readonly filler: Filler; readonly source: string }>> = [
  ...(manifest.dsm2021.length === 0
    ? []
    : [
        async (box: Box) => {
          if (manifest.dtm10.length === 0)
            throw new Error("the surface model needs a 10 m DTM to tell canopy from ground")
          const open = openGround(features, crop),
            window = utmAround(box, 2)
          const rasters = []
          for (const element of manifest.dsm2021) {
            const file = mustFind(await fetchZip(dsm2021Url(element)), "*.asc")
            const raster = ascWindow(readFileSync(file), window, element)
            if (raster !== undefined) rasters.push(raster)
          }
          const dsm = rasterFiller("dsm2021", crop, rasters, utm)
          const bare = () =>
            open.reduce((n, o, k) => n + Number(o === 1 && Number.isNaN(dm[k]!)), 0)
          const before = bare()
          clearCanopy(open, dsm, await dtm10(manifest.dtm10, box), crop, box)
          console.log(
            `dsm2021: ${before} m² of open ground without LiDAR, ${before - bare()} m² of it canopy, pits or scraps`,
          )
          return {
            filler: { ...dsm, where: (k: number) => open[k] === 1 },
            source: `the 2021 surface model's elements ${manifest.dsm2021.join(", ")} (${dsm2021Url("<element>")}) on the open ground of ${fetchedToday(ucsUrl)}, less its canopy (its height over the 10 m DTMs)`,
          }
        },
      ]),
  ...manifest.dtm10.map((name) => async (box: Box) => ({
    filler: await dtm10([name], box),
    source: dtm10Url(name),
  })),
  async (box: Box) => {
    const url = rerUrl(utmAround(box, 10))
    return {
      filler: rasterFiller("rer", crop, [await geoTiffRaster(await getBytes(url))], utm),
      source: fetchedToday(url),
    }
  },
]
const filling = { cols, rows, dm, src },
  used = [`the lidar archives of data/parts/${PART!.key}.json (${lidarUrl("<lidar>")})`]
for (const step of steps) {
  const box = emptyBox()
  if (box === undefined) break
  const { filler, source } = await step(box)
  const r = fillStep(filling, filler)
  if (r.cells === 0) continue
  used.push(source)
  const name = SOURCES[r.source]!,
    m = (v: number) => (v / 10).toFixed(1)
  console.log(
    `${name}: ${r.cells} m², rim ${r.rim} cells (better - ${name} ${m(r.residual[0])} to ${m(r.residual[1])} m), ${r.fit} fitted; the lattice leaves ≤ ${m(r.leftover)} m (${r.iterations} iterations), the band ${r.band} cells in ${r.sweeps} sweeps`,
  )
}
const left = emptyBox()
if (left !== undefined)
  throw new Error(
    `no terrain source covers EPSG:3003 ${gbAround(left, 0).join(", ")} (the box round the cells left)`,
  )

// 2 × 2 means: cell (i, j) covers 1 m cells 2i..2i+1, 2j..2j+1, so its centre is 0.5 m past theirs;
// its source is the most of its four cells', ties to the earlier.
const cols2 = Math.floor(cols / 2),
  rows2 = Math.floor(rows / 2)
const deltas = new Int16Array(cols2 * rows2),
  sources = new Uint8Array(cols2 * rows2),
  votes = new Uint8Array(SOURCES.length)
for (let j = 0, prev = 0; j < rows2; j++)
  for (let i = 0; i < cols2; i++) {
    const k = 2 * j * cols + 2 * i,
      four = [k, k + 1, k + cols, k + cols + 1]
    const mean = Math.round((dm[k]! + dm[k + 1]! + dm[k + cols]! + dm[k + cols + 1]!) / 4)
    deltas[j * cols2 + i] = i === 0 ? mean : mean - prev
    prev = mean
    votes.fill(0)
    for (const q of four) votes[src[q]!]!++
    sources[j * cols2 + i] = votes.indexOf(Math.max(...votes))
  }
/** The mosaic's sources: the manifest's archives, each named with its MD5, and the services. */
const mosaic = used.join("; then ")
pin(
  join(OUT, "dtm.bin"),
  Buffer.from(deltas.buffer),
  mosaic,
  (b) => deflateSync(b, { level: 9 }),
  inflateSync,
)
pin(
  join(OUT, "dtm-src.bin"),
  Buffer.from(sources.buffer),
  mosaic,
  (b) => deflateSync(b, { level: 9 }),
  inflateSync,
)
const meta = {
  crs: "EPSG:3003",
  e0: e0 + 0.5,
  n0: n0 + 0.5,
  cols: cols2,
  rows: rows2,
  cell: 2,
  unit: "dm",
  encoding: "int16le, row 0 = south, each row delta-coded from its first value, deflate",
  sources: SOURCES,
  sourceEncoding: "dtm-src.bin: uint8 per cell, its index in sources, row 0 = south, deflate",
}
pin(
  join(OUT, "dtm.json"),
  Buffer.from(`${JSON.stringify(meta, null, 2)}\n`),
  mosaic,
  (b) => b,
  (b) => b,
)
const counts = SOURCES.map((_, code) => sources.reduce((n, s) => n + (s === code ? 1 : 0), 0))
console.log({
  ...meta,
  bytes: readFileSync(join(OUT, "dtm.bin")).length,
  km2: Object.fromEntries(SOURCES.map((s, code) => [s, (counts[code]! * 4) / 1e6])),
})
