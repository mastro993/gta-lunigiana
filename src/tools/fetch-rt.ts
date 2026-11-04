// Downloads the Regione Toscana sources (Geoscopio cartoteca) and writes the pinned subsets the map
// build reads to data/raw/rt. Run: node src/tools/fetch-rt.ts <part>  (pnpm fetch-rt <part>), or
// `node src/tools/fetch-rt.ts <part> ctr` for the part's surveys alone (the CTR sheets and
// sections, the DBT), which leaves the terrain and the land cover as they are, or `<part> ucs` for
// its land cover alone. What it downloads comes from the part's manifest, data/parts/<part>.json
// (`manifest.ts`); the terrain mosaics every Lunigiana part's in order. With `--region <key>` of a
// test region with terrain of its own (`ownTerrain`, issue #10) it writes that region's terrain
// alone, to data/raw/rt/<key>; of one with buildings of its own (`ownBuildings`, issue #11), the
// surveys its manifest lists alone, to data/raw/rt/<key> (`surveyDir`). Needs `unzip` on the PATH,
// and `bsdtar` for the DBT. The archives are cached in the OS temp directory (`rt-cache.ts`). A file
// whose unpacked bytes equal the new ones is not rewritten, so another zlib never churns a pinned
// file. Either way, a file whose bytes the lock does not hold is recorded there with its source,
// for `pnpm pin-raw` (`raw-lock.ts`).
// - ctr/<sheet>_<layer>.shp.gz + .dbf.gz: CTR 1:2000, 2019 flight, EPSG:6707 (CC BY 4.0). AED =
//   buildings, AGE = other areas (garages, ruins, station platforms, level crossings), AVI = road
//   areas, AZR = the mapped area of each sheet, AFE = the rail ballast bed (its bridge and tunnel
//   spans), VLI = the railway track centrelines only (code 0117; the rest of the layer, mostly
//   contour lines, is dropped). Some sheets map only part of their frame; where none does, OSM
//   fills in. A sheet may lack AGE, AVI or AFE (nothing of the kind in it) and has a VLI file only
//   where a track runs. Two parts listing one sheet write the same files.
// - ctr2009/<sheet>_<layer>.shp.gz + .dbf.gz: CTR 1:2000, 2009 flight, the old schema, EPSG:6707
//   (CC BY: 3.0 IT as the cartoteca lists it, 4.0 as its archive's licence states): AE_a = buildings,
//   AV_a = road areas, AC_a = the mapped area, with the surveyors' names blanked (`SURVEYORS`),
//   ML_l = the ruins only (code 0205; the rest of the layer, other man-made lines, is dropped). A
//   sheet may lack AE_a or AV_a (it maps no building or road: lucido's 22D02, 22D06, 22D07), and
//   has an ML_l file only where it draws a ruin (not lucido's 22D06 and 22D07).
// - ctr10k/<section>_<layer>.shp.gz + .dbf.gz: CTR 1:10 000, the 2010 edition of each section
//   (CC BY 4.0), the same schema and layers.
// - dbt2k/<ISTAT>_<layer>.shp.gz + .dbf.gz: DBT 1:2000 of a comune (CC BY 4.0), EPSG:3003, only
//   the records whose box meets the part's EPSG:3003 box + 500 m (a comune's archive holds all of
//   it): un_vol = volumetric units, mn_ind = industrial artefacts, ar_str = road areas, ac_vei =
//   carriageways, ar_vms = dirt tracks, zona_r = the mapped zones. No field of these names a
//   person (zona_r_dt names the survey firms).
// - dtm/<i>_<j>.bin: the terrain, a file a 2 km map tile (`dtm-tiles.ts`, issue #17): the tiles the
//   part's rectangles meet, each over its square cut to the region's box and HALO round it, on 2 m
//   cells in EPSG:3003. Each cell a tile's file holds stays as it is; the others are the 2 × 2 means
//   of a 1 m mosaic (`fetch-dtm.ts`): every Lunigiana part's manifest's LiDAR DTM tiles (CC BY 4.0)
//   in the parts' order, then each its own order (a cell keeps the first value written; for lucido
//   the 2010 flight, then the 2012 flight for the Carrara side of the ridge and Monte Sagro, which
//   2010 flew only in part), then the fallback chain for the cells no tile has (`fill-chain.ts`,
//   `terrain-sources.ts`): the 2021 surface model on open ground, the province 10 m DTMs, Liguria's
//   DTM ed. 2023 from the crops `fetch-lig` wrote for the parts (data/raw/lig/<part>/dtm: run it
//   first), Emilia-Romagna's DTM 5x5 beyond Tuscany, each bent onto the cells before it, the held
//   ones among them. So a part adds its tiles, and fills in the cells its grown box adds to tiles
//   another part's fetch wrote, without moving one (run the fetch of every part whose tiles the box
//   grew into; the build names any it lacks). To fetch a part's terrain again, delete its tiles'
//   files first. A test region with terrain of its own writes one mosaic instead, on its own cells:
//   dtm.json + dtm.bin + dtm-src.bin (`writeMosaic`).
// - ucs/<part>.json.gz: land cover 1:10 000, 2019 ("Uso e copertura del suolo", CC BY 4.0),
//   EPSG:3003: the open covers OSM mostly lacks in the mountains (quarries, bare rock, sparse
//   vegetation, pastures, heath), the rivers' gravel, the water bodies and the broadleaf, conifer
//   and mixed woods, from the WFS over the part's terrain; the polygons the file already holds stay
//   as they are (by id), so a later fetch only adds.
import { existsSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parseArgs } from "node:util"

import {
  UCS,
  WFS_PAD,
  ctr10kUrl,
  ctrUrl,
  dbt2kUrl,
  meetingBox,
  parseGml,
  wfsUrl,
  withoutSurveyors,
} from "./cartoteca.ts"
import { cropOf } from "./dtm-mosaic.ts"
import { type DtmTile, partTiles } from "./dtm-tiles.ts"
import { fillCrop, tileCrop, tileFiles, writeMosaic, writeTiles } from "./fetch-dtm.ts"
import { NONE } from "./fill-chain.ts"
import { gaussBoagaBox } from "./geometry.ts"
import { dtmTiles } from "./liguria.ts"
import { manifestPath, readManifest } from "./manifest.ts"
import { getText } from "./net.ts"
import { fetchedToday, writeRaw } from "./raw-lock.ts"
import { REGION, dtmDir, ligDir, surveyDir, ucsFile } from "./region.ts"
import { fetch7z, fetchZip, findFile, mustFind } from "./rt-cache.ts"
import { subsetShp } from "./shp.ts"
import { UCS_CODES, readUcsFile } from "./ucs.ts"

const ROOT = join(import.meta.dirname, "../..")
const { positionals } = parseArgs({
  allowPositionals: true,
  options: { region: { type: "string" } },
  strict: true,
})
if (REGION.id !== "lunigiana") throw new Error(`fetch-rt fetches for Lunigiana, not ${REGION.key}`)
if (REGION.test && !REGION.ownTerrain && !REGION.ownBuildings)
  throw new Error(`--region ${REGION.key} is built from Lunigiana's inputs: fetch none for it`)
/** What a test region has of its own, which is all fetch-rt writes for it. */
const own = REGION.ownTerrain ? "terrain" : REGION.ownBuildings ? "buildings" : undefined
if (own !== undefined && positionals.length > 0)
  throw new Error(`--region ${REGION.key} has ${own} alone: run fetch-rt without a stage`)
/** The part fetched for: a Lunigiana part named first, or a test region's own one. */
const PART =
  own === undefined
    ? REGION.parts.find((p) => p.key === positionals[0])
    : REGION.parts.length === 1
      ? REGION.parts[0]
      : undefined
if (PART === undefined)
  throw new Error(
    `usage: fetch-rt <part> [ctr | ucs], the part one of ${REGION.parts.map((p) => p.key).join(", ")}`,
  )
/** `ctr` fetches the surveys alone, `ucs` the land cover alone; none fetches everything. */
const stage = own === undefined ? positionals[1] : undefined
if (positionals.length > 2 || (stage !== undefined && stage !== "ctr" && stage !== "ucs"))
  throw new Error(`unknown stage ${positionals.slice(1).join(" ")}: use ctr, ucs or none`)
const OUT = join(ROOT, dtmDir(REGION)),
  SURVEYS = join(ROOT, surveyDir(REGION))
if (!existsSync(manifestPath(PART.key)))
  throw new Error(`no data/parts/${PART.key}.json: run pick-sheets and pick-lidar with --write`)
const manifest = readManifest(PART.key)
/**
 * The surveys of the ground the manifest lists, none for the land cover alone or a region with
 * terrain alone: the 2019 CTR 1:2000 sheets that map ground in the play area (cartoteca layer
 * rt_cartoteca.ctr2k), the 2009 ones (the same layer), the CTR 1:10 000 sections (ctr10k) and the
 * DBT's comuni (dbt.2k).
 */
const surveys =
  stage === "ucs" || REGION.ownTerrain ? { ctr: [], ctr2009: [], ctr10k: [], dbt2k: [] } : manifest
/** Layers copied whole; AED and AZR are in every sheet. */
const CTR_LAYERS = ["AED", "AGE", "AVI", "AZR", "AFE"] as const
/** CTR code of a railway track centreline, the only VLI records kept. */
const TRACK = "0117"
/** A shapefile's main file and table, raw, cut to what is pinned of them; undefined when nothing is. */
type Cut = (shp: Buffer, dbf: Buffer) => { readonly shp: Buffer; readonly dbf: Buffer } | undefined
const whole: Cut = (shp, dbf) => ({ shp, dbf })
/**
 * Pins the layer `member` (.shp and .dbf) of an archive extracted in `dir` as `<out>.shp.gz` and
 * `<out>.dbf.gz`, through `cut` (whole by default); a missing member throws unless `optional`.
 * Whether it pinned anything: not when the member is missing or `cut` keeps no record.
 */
const pinLayer = (
  dir: string,
  member: string,
  out: string,
  source: string,
  { optional = false, cut = whole }: { readonly optional?: boolean; readonly cut?: Cut } = {},
): boolean => {
  const shp = optional ? findFile(dir, `${member}.shp`) : mustFind(dir, `${member}.shp`)
  if (shp === undefined) return false
  const kept = cut(readFileSync(shp), readFileSync(mustFind(dir, `${member}.dbf`)))
  if (kept === undefined) return false
  writeRaw(`${out}.shp.gz`, kept.shp, source)
  writeRaw(`${out}.dbf.gz`, kept.dbf, source)
  return true
}

/** Old-schema code of a ruin, the only ML_l records kept (`readOldCtr` reads the closed ones). */
const RUIN = "0205"
/**
 * The old schema's layers (`readOldCtr`) and how each is pinned: buildings and road areas, which a
 * sheet may lack, whole; the mapped area with its surveyors blanked; the ruins of ML_l, none when a
 * sheet draws none.
 */
const OLD_CTR_LAYERS = {
  AE_a: { optional: true },
  AV_a: { optional: true },
  AC_a: { cut: withoutSurveyors },
  ML_l: {
    optional: true,
    cut: (shp, dbf) => subsetShp(shp, dbf, (attrs) => attrs.Codice === RUIN),
  },
} satisfies Record<string, { readonly optional?: boolean; readonly cut?: Cut }>
/** Pins the old-schema archive at `url` as `<folder>/<key>_<layer>`, from its files `member(layer)`. */
const pinOldCtr = async (
  url: string,
  folder: string,
  key: string,
  member: (layer: string) => string,
): Promise<void> => {
  const dir = await fetchZip(url)
  for (const [layer, how] of Object.entries(OLD_CTR_LAYERS))
    pinLayer(dir, member(layer), join(SURVEYS, folder, `${key}_${layer}`), url, how)
}

/** The DBT's layers (`readDbt`) by the name they are pinned under, each its archive member's. */
const DBT_LAYERS = {
  un_vol: "020101_un_vol",
  mn_ind: "020201_mn_ind",
  ar_str: "010104_ar_str",
  ac_vei: "010101_ac_vei",
  ar_vms: "010105_ar_vms",
  zona_r: "000201_zona_r",
} as const
/** The part's EPSG:3003 box + WFS_PAD, on whole metres outwards: the DBT's records whose box meets it are pinned. */
const dbtBox = gaussBoagaBox(PART.rects, WFS_PAD).map((v, k) =>
  k < 2 ? Math.floor(v) : Math.ceil(v),
)

for (const sheet of surveys.ctr) {
  const dir = await fetchZip(ctrUrl(sheet))
  const out = (layer: string) => join(SURVEYS, "ctr", `${sheet}_${layer}`)
  for (const layer of CTR_LAYERS)
    pinLayer(dir, `S_${sheet}_2019_${layer}`, out(layer), ctrUrl(sheet), {
      optional: layer !== "AED" && layer !== "AZR",
    })
  pinLayer(dir, `S_${sheet}_2019_VLI`, out("VLI"), ctrUrl(sheet), {
    cut: (shp, dbf) => subsetShp(shp, dbf, (attrs) => attrs.Cod_CTR === TRACK),
  })
}
for (const sheet of surveys.ctr2009)
  // The archive's layers are `<sheet><layer>`, with no underscore between.
  await pinOldCtr(ctrUrl(sheet, 2009), "ctr2009", sheet, (layer) => `${sheet}${layer}`)
for (const name of surveys.ctr10k) {
  const [, section, year] = name.split("_")
  await pinOldCtr(ctr10kUrl(name), "ctr10k", section!, (layer) => `S_${section}_${year}_${layer}`)
}
for (const name of surveys.dbt2k) {
  const url = dbt2kUrl(name),
    source = `${url}, the records whose box meets EPSG:3003 ${dbtBox.join(",")}`
  const dir = await fetch7z(
    url,
    Object.values(DBT_LAYERS).flatMap((member) => [`${member}.shp`, `${member}.dbf`]),
  )
  for (const [layer, member] of Object.entries(DBT_LAYERS)) {
    const out = join(SURVEYS, "dbt2k", `${name.split("_")[1]}_${layer}`)
    const pinned = pinLayer(dir, member, out, source, {
      cut: (shp, dbf) => meetingBox(shp, dbf, dbtBox),
    })
    if (!pinned && layer === "zona_r")
      throw new Error(`${name}: no mapped zone meets EPSG:3003 ${dbtBox.join(",")}`)
  }
}
if (stage === "ctr" || REGION.ownBuildings) process.exit(0)

// The terrain's crop. A Lunigiana part's: the 2 m cells its tiles must hold (each tile's square cut
// to the region's box, HALO round it), as 1 m cells seeded from what every tile file holds
// (`tileCrop`); a test region's own: its rectangles' EPSG:3003 box widened by MARGIN, on the 1 m
// tiles' cell centres (x.5), all of it to fill.
const DTM = join(OUT, "dtm"),
  held = REGION.ownTerrain ? new Map<string, DtmTile>() : tileFiles(DTM)
const tiles = REGION.ownTerrain ? [] : partTiles(PART.rects, REGION.bounds)
const { crop, mosaic, block, empty } = REGION.ownTerrain
  ? (() => {
      const c = cropOf(PART.rects),
        n = c.cols * c.rows
      const dm = new Float32Array(n).fill(Number.NaN),
        src = new Uint8Array(n).fill(NONE)
      return {
        crop: c,
        mosaic: { cols: c.cols, rows: c.rows, dm, src },
        block: undefined,
        empty: n,
      }
    })()
  : tileCrop(
      tiles.map((t) => t.need),
      held.values(),
    )
const { e0, n0, cols, rows } = crop

// Land cover: every polygon whose box meets the crop. The server's BBOX filter sometimes loses
// features near the box's edge, so the box is padded by UCS.pad (readUcs clips). A Lunigiana part
// pins those of the kept classes, sorted by id, in EPSG:3003 to the decimetre, rings as gml gives
// them (outer first), adding them to those its file holds; the open ground among them is where the
// surface model may fill the terrain. A region with terrain alone asks only when its manifest lists
// the surface model.
const ucsUrl = wfsUrl(UCS.map, UCS.layer, [
  e0 - UCS.pad,
  n0 - UCS.pad,
  e0 + cols + UCS.pad,
  n0 + rows + UCS.pad,
])
const asksUcs = !REGION.ownTerrain || manifest.dsm2021.length > 0
const features = asksUcs ? parseGml(await getText(ucsUrl)) : []
if (!REGION.ownTerrain) {
  const file = join(ROOT, ucsFile(PART)),
    before = existsSync(file) ? readUcsFile(file).polygons : []
  const ids = new Set(before.map((p) => p.id))
  // One entry per polygon (a multipolygon has several), each its outer ring then its holes.
  const fetched = features.flatMap(({ attrs, polygons }) =>
    Object.hasOwn(UCS_CODES, attrs.ucs2019 ?? "") && !ids.has(Number(attrs.pk_uid))
      ? polygons.map((rings) => ({
          id: Number(attrs.pk_uid),
          code: attrs.ucs2019!,
          rings: rings.map((ring) => ring.map((v) => Math.round(v * 10) / 10)),
        }))
      : [],
  )
  const ucs = [...before, ...fetched].sort((a, b) => a.id - b.id)
  if (ucs.length === 0) throw new Error("UCS WFS: no polygons")
  writeRaw(
    file,
    Buffer.from(JSON.stringify({ crs: "EPSG:3003", year: 2019, polygons: ucs })),
    fetchedToday(ucsUrl),
  )
  console.log({ ucs: ucs.length, added: fetched.length })
}
if (stage === "ucs") process.exit(0)
if (empty === 0) {
  console.log(`every terrain cell ${PART.key}'s tiles need is held: nothing to fetch`)
  process.exit(0)
}

/** Every Lunigiana part whose inputs the terrain reads: the test region's own, or the region's, in order. */
const parts = REGION.ownTerrain ? [PART] : REGION.parts
const manifests = parts.map((p) => readManifest(p.key))
const unique = (lists: ReadonlyArray<ReadonlyArray<string>>) => [...new Set(lists.flat())]
/** Liguria's DTM crops `fetch-lig` wrote for the parts' tiles (`dtmTiles`): none where it has not run, or a tile has no data. */
const ligCrops = parts.flatMap((p) =>
  dtmTiles(p.rects)
    .map(({ i, j }) => join(ROOT, ligDir(p), "dtm", `${i}_${j}.tif`))
    .filter((f) => existsSync(f)),
)
const used = await fillCrop(crop, mosaic, {
  lidar: unique(manifests.map((m) => m.lidar)),
  lidarFrom: parts.map((p) => `data/parts/${p.key}.json`).join(", "),
  dsm2021: unique(manifests.map((m) => m.dsm2021)),
  dtm10: unique(manifests.map((m) => m.dtm10)),
  lig:
    ligCrops.length === 0
      ? undefined
      : {
          files: ligCrops,
          from: `the Liguria DTM ed. 2023's crops ${ligCrops.map((f) => relative(ROOT, f)).join(", ")} (pnpm fetch-lig <part>)`,
        },
  features,
  ucsFrom: fetchedToday(ucsUrl),
})
if (REGION.ownTerrain) writeMosaic(OUT, crop, mosaic, used)
else writeTiles(DTM, tiles, held, block!, mosaic, used)
