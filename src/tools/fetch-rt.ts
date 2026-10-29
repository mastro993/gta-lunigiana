// Downloads the Regione Toscana sources (Geoscopio cartoteca) and writes the pinned subsets the map
// build reads to data/raw/rt. Run: node src/tools/fetch-rt.ts  (pnpm fetch-rt), or
// `node src/tools/fetch-rt.ts ctr` (pnpm fetch-rt ctr) for the CTR sheets alone, which leaves the
// LiDAR and the land cover as they are. What it downloads comes from the part's manifest,
// data/parts/<part>.json (`manifest.ts`); it reads one part, today's (`lucido` in `region.ts`),
// until issue #7 builds the map tile by tile. Needs `unzip` on the PATH. The archives are cached in
// the OS temp directory (`rt-cache.ts`). A file whose unpacked bytes equal the new ones is not
// rewritten, so another zlib never churns a pinned file.
// - ctr/<sheet>_<layer>.shp.gz + .dbf.gz: CTR 1:2000, 2019 flight, EPSG:6707 (CC BY 4.0). AED =
//   buildings, AGE = other areas (garages, ruins, station platforms, level crossings), AVI = road
//   areas, AZR = the mapped area of each sheet, AFE = the rail ballast bed (its bridge and tunnel
//   spans), VLI = the railway track centrelines only (code 0117; the rest of the layer, mostly
//   contour lines, is dropped). Some sheets map only part of their frame; where none does, OSM
//   fills in. A sheet may lack AGE, AVI or AFE (nothing of the kind in it) and has a VLI file only
//   where a track runs.
// - dtm.json + dtm.bin: LiDAR DTM, EPSG:3003 (CC BY 4.0): the manifest's 1 m tiles in priority
//   order (a cell keeps the first value written; for lucido the 2010 flight, then the 2012 flight
//   for the Carrara side of the ridge and Monte Sagro, which 2010 flew only in part), mosaicked,
//   cropped to the play area plus MARGIN (`dtm-mosaic.ts`) and averaged to 2 m cells (the game grid
//   is 4 m); int16 decimetres, each row delta-coded, deflated. The few cells no tile has come
//   from the 10 m DTM (CC BY 3.0 IT), bent onto the LiDAR around each hole.
// - ucs.json.gz: land cover 1:10 000, 2019 ("Uso e copertura del suolo", CC BY 4.0), EPSG:3003:
//   the open covers OSM mostly lacks in the mountains (quarries, bare rock, sparse vegetation,
//   pastures, heath), from the WFS.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { deflateSync, gunzipSync, gzipSync, inflateSync } from "node:zlib"

import { UCS, ctrUrl, dtm10Url, lidarUrl, parseGml, wfsUrl } from "./cartoteca.ts"
import { ascHeader, cropOf, eachCell } from "./dtm-mosaic.ts"
import { manifestPath, readManifest } from "./manifest.ts"
import { getText } from "./net.ts"
import { PARTS } from "./region.ts"
import { fetchZip, findFile, mustFind } from "./rt-cache.ts"
import { subsetShp } from "./shp.ts"
import { UCS_CODES } from "./ucs.ts"

const ROOT = join(import.meta.dirname, "../..")
const OUT = join(ROOT, "data/raw/rt")
/** `ctr` fetches the CTR sheets alone; no argument fetches everything. */
const stage = process.argv[2]
if (stage !== undefined && stage !== "ctr")
  throw new Error(`unknown stage ${stage}: use ctr or none`)

// One part until #7: a second one would widen the crop over the land between them, all of it holes.
if (PARTS.length !== 1)
  throw new Error(`fetch-rt mosaics one part; PARTS has ${PARTS.length} (more arrive with #7)`)
const [PART] = PARTS
if (!existsSync(manifestPath(PART!.key)))
  throw new Error(`no data/parts/${PART!.key}.json: run pick-sheets and pick-lidar with --write`)
const manifest = readManifest(PART!.key)
/** The 2019 CTR 1:2000 sheets that map ground in the play area (cartoteca layer rt_cartoteca.ctr2k). */
const CTR_SHEETS = manifest.ctr
/** Layers copied whole; AED and AZR are in every sheet. */
const CTR_LAYERS = ["AED", "AGE", "AVI", "AZR", "AFE"] as const
/** CTR code of a railway track centreline, the only VLI records kept. */
const TRACK = "0117"
/**
 * The LiDAR DTM tiles with data in the crop (cartoteca layer rt_cartoteca.lidar2k; the suffix is
 * the archive's MD5), in priority order: a cell keeps the first value written.
 */
const DTM_TILES = manifest.lidar
/** The 10 m DTM from the CTR 1:10 000: the fallback for cells no LiDAR tile covers (one province until #10). */
if (manifest.dtm10.length > 1)
  throw new Error(
    `fetch-rt fills holes from one 10 m DTM; the manifest lists ${manifest.dtm10.join(", ")}`,
  )
const [DTM10] = manifest.dtm10

/** Writes `bytes`, packed, to `path`, unless the file there already unpacks to the same bytes. */
const pin = (
  path: string,
  bytes: Buffer,
  pack: (b: Buffer) => Buffer = (b) => gzipSync(b, { level: 9 }),
  unpack: (b: Buffer) => Buffer = gunzipSync,
): void => {
  if (existsSync(path) && unpack(readFileSync(path)).equals(bytes)) return
  writeFileSync(path, pack(bytes))
  console.log(`wrote ${path.slice(ROOT.length + 1)}`)
}

mkdirSync(join(OUT, "ctr"), { recursive: true })

for (const sheet of CTR_SHEETS) {
  const dir = await fetchZip(ctrUrl(sheet))
  const out = (layer: string, ext: string) => join(OUT, "ctr", `${sheet}_${layer}.${ext}.gz`)
  for (const layer of CTR_LAYERS)
    for (const ext of ["shp", "dbf"]) {
      const name = `S_${sheet}_2019_${layer}.${ext}`,
        file = layer === "AED" || layer === "AZR" ? mustFind(dir, name) : findFile(dir, name)
      if (file !== undefined) pin(out(layer, ext), readFileSync(file))
    }
  const tracks = subsetShp(
    readFileSync(mustFind(dir, `S_${sheet}_2019_VLI.shp`)),
    readFileSync(mustFind(dir, `S_${sheet}_2019_VLI.dbf`)),
    (attrs) => attrs.Cod_CTR === TRACK,
  )
  if (tracks !== undefined) {
    pin(out("VLI", "shp"), tracks.shp)
    pin(out("VLI", "dbf"), tracks.dbf)
  }
}
if (stage === "ctr") process.exit(0)

// The crop: play-area corners in Gauss-Boaga, widened by MARGIN, on the tiles' cell centres (x.5).
const crop = cropOf(PART!.rects)
const { e0, n0, cols, rows } = crop
const NODATA = -32768
const dm = new Int16Array(cols * rows).fill(NODATA) // row 0 = south

for (const tile of DTM_TILES) {
  const lines = readFileSync(mustFind(await fetchZip(lidarUrl(tile)), "*.asc"), "latin1").split(
    "\n",
  )
  eachCell(lines, crop, tile, (k, z) => {
    if (dm[k] === NODATA) dm[k] = Math.round(z * 10)
  })
}

/**
 * Bilinear sampler (decimetres) of the 10 m DTM over the crop. Its header gives cell corners
 * (xllcorner), so cell centres sit 5 m in. Only the rows over the crop are parsed.
 */
const dtm10 = async (): Promise<(e: number, n: number) => number> => {
  if (DTM10 === undefined) throw new Error("cells without LiDAR, and no 10 m DTM in the manifests")
  const buf = readFileSync(mustFind(await fetchZip(dtm10Url(DTM10)), "*.asc"))
  const starts = [0]
  for (let o = buf.indexOf(10); o >= 0 && starts.length <= 6; o = buf.indexOf(10, o + 1))
    starts.push(o + 1)
  const { ncols, nrows, xllcorner, yllcorner, cellsize, nodata_value } = ascHeader(
    buf.toString("latin1", 0, starts[6]).split("\n"),
  )
  const x0 = xllcorner! + cellsize! / 2,
    yTop = yllcorner! + (nrows! - 0.5) * cellsize!
  // File rows (north first) spanning the crop, one spare each side for the bilinear stencil.
  const r0 = Math.max(0, Math.floor((yTop - (n0 + rows)) / cellsize!) - 1),
    r1 = Math.min(nrows! - 1, Math.ceil((yTop - n0) / cellsize!) + 1)
  const z = new Float64Array((r1 - r0 + 1) * ncols!)
  for (let r = 0, o = starts[6]!; r <= r1; r++) {
    const end = buf.indexOf(10, o)
    if (r >= r0)
      buf
        .toString("latin1", o, end)
        .trim()
        .split(/\s+/)
        .forEach(
          (v, c) =>
            (z[(r - r0) * ncols! + c] = Number(v) === nodata_value ? Number.NaN : Number(v)),
        )
    o = end + 1
  }
  return (e, n) => {
    const fc = (e - x0) / cellsize!,
      fr = (yTop - n) / cellsize! - r0
    const c = Math.floor(fc),
      r = Math.floor(fr),
      u = fc - c,
      v = fr - r
    const at = (i: number, j: number) => z[j * ncols! + i]!
    const top = at(c, r) + (at(c + 1, r) - at(c, r)) * u,
      bottom = at(c, r + 1) + (at(c + 1, r + 1) - at(c, r + 1)) * u
    const value = (top + (bottom - top) * v) * 10
    if (Number.isNaN(value)) throw new Error(`no 10 m DTM at ${e}, ${n}`)
    return value
  }
}

// Holes: each 4-connected run of cells without LiDAR takes the 10 m DTM plus the (LiDAR - DTM)
// residual of the cells around it, spread over the hole by inverse squared distance, so it meets
// the LiDAR without a step (the residual varies by tens of metres around a big hole).
let holes = 0
let sample: ((e: number, n: number) => number) | undefined
for (let k0 = 0; k0 < dm.length; k0++) {
  if (dm[k0] !== NODATA) continue
  sample ??= await dtm10()
  const run: Array<number> = [k0],
    rim = new Set<number>()
  dm[k0] = NODATA + 1 // visited
  for (let q = 0; q < run.length; q++) {
    const k = run[q]!,
      c = k % cols
    for (const nb of [c > 0 ? k - 1 : -1, c < cols - 1 ? k + 1 : -1, k - cols, k + cols]) {
      if (nb < 0 || nb >= dm.length) continue
      if (dm[nb] === NODATA) {
        dm[nb] = NODATA + 1
        run.push(nb)
      } else if (dm[nb] !== NODATA + 1) rim.add(nb)
    }
  }
  const at = (k: number) => sample!(e0 + (k % cols), n0 + Math.floor(k / cols))
  const edge = [...rim],
    residual = edge.map((k) => dm[k]! - at(k))
  for (const k of run) {
    const c = k % cols,
      r = Math.floor(k / cols)
    let sw = 0,
      sv = 0
    edge.forEach((e, i) => {
      const w = 1 / (((e % cols) - c) ** 2 + (Math.floor(e / cols) - r) ** 2)
      sw += w
      sv += w * residual[i]!
    })
    dm[k] = Math.round(at(k) + (sw > 0 ? sv / sw : 0))
  }
  holes += run.length
  const lo = Math.min(...residual) / 10,
    hi = Math.max(...residual) / 10
  console.log(
    `hole at ${e0 + (k0 % cols)}, ${n0 + Math.floor(k0 / cols)}: ${run.length} m², LiDAR - 10 m DTM ${lo.toFixed(1)} to ${hi.toFixed(1)} m on its rim`,
  )
}

// 2 × 2 means: cell (i, j) covers 1 m cells 2i..2i+1, 2j..2j+1, so its centre is 0.5 m past theirs.
const cols2 = Math.floor(cols / 2),
  rows2 = Math.floor(rows / 2)
const deltas = new Int16Array(cols2 * rows2)
for (let j = 0, prev = 0; j < rows2; j++)
  for (let i = 0; i < cols2; i++) {
    const k = 2 * j * cols + 2 * i
    const mean = Math.round((dm[k]! + dm[k + 1]! + dm[k + cols]! + dm[k + cols + 1]!) / 4)
    deltas[j * cols2 + i] = i === 0 ? mean : mean - prev
    prev = mean
  }
pin(
  join(OUT, "dtm.bin"),
  Buffer.from(deltas.buffer),
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
}
pin(
  join(OUT, "dtm.json"),
  Buffer.from(`${JSON.stringify(meta, null, 2)}\n`),
  (b) => b,
  (b) => b,
)
console.log({ ...meta, bytes: readFileSync(join(OUT, "dtm.bin")).length, filledFrom10m: holes })

// Land cover: every polygon of a kept class whose box meets the crop, sorted by id. Coordinates in
// EPSG:3003 to the decimetre; rings as gml gives them (outer first). The server's BBOX filter
// sometimes loses features near the box's edge, so the box is padded by UCS.pad (readUcs clips).
const gml = await getText(
  wfsUrl(UCS.map, UCS.layer, [
    e0 - UCS.pad,
    n0 - UCS.pad,
    e0 + cols + UCS.pad,
    n0 + rows + UCS.pad,
  ]),
)
// One entry per polygon (a multipolygon has several), each its outer ring then its holes.
const ucs = parseGml(gml)
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
)
console.log({ ucs: ucs.length })
