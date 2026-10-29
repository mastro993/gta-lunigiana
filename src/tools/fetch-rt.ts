// Downloads the Regione Toscana sources (Geoscopio cartoteca) and writes the pinned subsets the map
// build reads to data/raw/rt. Run: node src/tools/fetch-rt.ts  (pnpm fetch-rt), or
// `node src/tools/fetch-rt.ts ctr` (pnpm fetch-rt ctr) for the CTR sheets alone, which leaves the
// LiDAR and the land cover as they are. Needs `unzip` on the PATH. The archives are cached in the
// OS temp directory. A file whose unpacked bytes equal the new ones is not rewritten, so another
// zlib never churns a pinned file.
// - ctr/<sheet>_<layer>.shp.gz + .dbf.gz: CTR 1:2000, 2019 flight, EPSG:6707 (CC BY 4.0). AED =
//   buildings, AGE = other areas (garages, ruins, station platforms, level crossings), AVI = road
//   areas, AZR = the mapped area of each sheet, AFE = the rail ballast bed (its bridge and tunnel
//   spans), VLI = the railway track centrelines only (code 0117; the rest of the layer, mostly
//   contour lines, is dropped). Some sheets map only part of their frame; where none does, OSM
//   fills in. A sheet may lack AGE, AVI or AFE (nothing of the kind in it) and has a VLI file only
//   where a track runs.
// - dtm.json + dtm.bin: LiDAR DTM, EPSG:3003 (CC BY 4.0): the 1 m tiles of the 2010 flight, then
//   the 2012 flight where 2010 has no data (the Carrara side of the ridge, Monte Sagro), mosaicked,
//   cropped to the play area plus MARGIN and averaged to 2 m cells (the game grid is 4 m); int16
//   decimetres, each row delta-coded, deflated. The few cells neither flight has come from the
//   10 m DTM (CC BY 3.0 IT), bent onto the LiDAR around each hole.
// - ucs.json.gz: land cover 1:10 000, 2019 ("Uso e copertura del suolo", CC BY 4.0), EPSG:3003:
//   the open covers OSM mostly lacks in the mountains (quarries, bare rock, sparse vegetation,
//   pastures, heath), from the WFS.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { deflateSync, gunzipSync, gzipSync, inflateSync } from "node:zlib"

import { latLonToGaussBoaga } from "./crs.ts"
import { BOUNDS, fromLocal } from "./geometry.ts"
import { subsetShp } from "./shp.ts"
import { UCS_CODES } from "./ucs.ts"

const ROOT = join(import.meta.dirname, "../..")
const OUT = join(ROOT, "data/raw/rt")
const CACHE = join(tmpdir(), "gta-lunigiana-rt")
const BASE = "https://www502.regione.toscana.it/geoscopio/download"
/** The only thing the requests say about who asks: the project (no names, no addresses). */
const HEADERS = { "User-Agent": "gta-lunigiana map build" }
/** `ctr` fetches the CTR sheets alone; no argument fetches everything. */
const stage = process.argv[2]
if (stage !== undefined && stage !== "ctr")
  throw new Error(`unknown stage ${stage}: use ctr or none`)

/** Every 2019 CTR 1:2000 sheet that maps ground in the play area (cartoteca layer rt_cartoteca.ctr2k). */
const CTR_SHEETS = [
  "23D11",
  "23D12",
  "23D13",
  "23D14",
  "23D15",
  "23D18",
  "23D19",
  "23D20",
  "23D21",
  "23D26",
  "23D27",
  "23D28",
  "23D29",
  "23D30",
  "23D31",
  "23D34",
  "23D35",
  "23D36",
  "23D37",
  "23D43",
  "23D46",
  "23D47",
  "23D53",
  "23D54",
  "23D55",
] as const
/** Layers copied whole; AED and AZR are in every sheet. */
const CTR_LAYERS = ["AED", "AGE", "AVI", "AZR", "AFE"] as const
/** CTR code of a railway track centreline, the only VLI records kept. */
const TRACK = "0117"
/**
 * Every LiDAR DTM tile with data in the crop (cartoteca layer rt_cartoteca.lidar2k; the suffix is
 * the archive's MD5), in priority order: a cell keeps the first value written. The 2010 flight
 * (lot 004) first, then the 2012 flight (lot 005) for what it lacks. The 2008 lot (006) adds
 * nothing here and is CC BY-SA.
 */
const DTM_TILES = [
  "22d02_1x1_dtm_004_2010_3003_4a54b85717f269dbf5b5d7eb1257b276",
  "22d05_1x1_dtm_004_2010_3003_481e79acc4a67d67625f66a3108b1b63",
  "22d06_1x1_dtm_004_2010_3003_aeaeaa4f4018483c22e44652b0af3d3e",
  "22d07_1x1_dtm_004_2010_3003_7a1daf5d4f70e8427f57f8760a3362aa",
  "22d15_1x1_dtm_004_2010_3003_931f8ecf21411191369750f12b28c80a",
  "23d10_1x1_dtm_004_2010_3003_f7ad492db7c7b72600ec64388e12df88",
  "23d11_1x1_dtm_004_2010_3003_6608383f82231dd57fa923769433d385",
  "23d12_1x1_dtm_004_2010_3003_2826377b2b700ff0a7060d9bed617ab7",
  "23d13_1x1_dtm_004_2010_3003_1058df2745552875df0878b3da36071c",
  "23d14_1x1_dtm_004_2010_3003_09bca37edbf646f8ab803203817935e5",
  "23d15_1x1_dtm_004_2010_3003_7746c853bcaaf12405754da9f3e515f4",
  "23d18_1x1_dtm_004_2010_3003_5932526d02e4a47fa030ccc26ccf1d0f",
  "23d19_1x1_dtm_004_2010_3003_79631f7e59953c2b5f52498e38497bd2",
  "23d20_1x1_dtm_004_2010_3003_f42c50305640d0ef1c3ba3bd6e234344",
  "23d21_1x1_dtm_004_2010_3003_7544001883ae9050bb6ec48414cfd722",
  "23d22_1x1_dtm_004_2010_3003_7ada4a2d6f5035a20d0f77a59a525089",
  "23d23_1x1_dtm_004_2010_3003_9c62ac55ac19f671d69793dbfb0a819b",
  "23d26_1x1_dtm_004_2010_3003_2f6fe17319bfc91ec4a10bc1f851414d",
  "23d27_1x1_dtm_004_2010_3003_45bf50a7a74bd231018f1061ea2b1f1e",
  "23d28_1x1_dtm_004_2010_3003_2253b9e5f1401b55954ffc8358cd4273",
  "23d29_1x1_dtm_004_2010_3003_7abfda497246d368fdc40e821e0b76a5",
  "23d30_1x1_dtm_004_2010_3003_bd57a1103bdcaef6b9fbbb1fc22b94e2",
  "23d31_1x1_dtm_004_2010_3003_59369346fb9069198b710663f998edfe",
  "23d34_1x1_dtm_004_2010_3003_ab6644e6be652e3a86228d8e5f63d1df",
  "23d35_1x1_dtm_004_2010_3003_185c6a113a23995baa9392b253fefb85",
  "23d36_1x1_dtm_004_2010_3003_2a95a140e5e8f6c1c4c10b643b8a5ba6",
  "23d37_1x1_dtm_004_2010_3003_af2fa3f16045fe73a80c650d4fcb42f5",
  "23d38_1x1_dtm_004_2010_3003_731025ed45065aea1bbd9ffe85b68407",
  "23d39_1x1_dtm_004_2010_3003_da364bd89c786b7373608ae85d3da1e5",
  "23d42_1x1_dtm_004_2010_3003_11c886a6545962071525e1664cf7dd03",
  "23d43_1x1_dtm_004_2010_3003_c201b52aea6bb63900171237c8f8a401",
  "23d44_1x1_dtm_004_2010_3003_2452372f4f645bb96b6ac6ecf3f7128f",
  "23d45_1x1_dtm_004_2010_3003_e4ffc1589869e3f59ad176e0646037c5",
  "23d46_1x1_dtm_004_2010_3003_b163a12c7b2e02f0ae85307d41bc65a8",
  "23d47_1x1_dtm_004_2010_3003_c826024ffba15e9e390bf043e36d9355",
  "23d50_1x1_dtm_004_2010_3003_925a49729b67b2be33014a4e7befe6f0",
  "23d51_1x1_dtm_004_2010_3003_6dda7b39f0fa4749e4203b8e4e08bc5c",
  "23d52_1x1_dtm_004_2010_3003_432c09370bdaee427ad048f60ed43184",
  "23d53_1x1_dtm_004_2010_3003_33f4dd2f9fc11bd9393615d66712ad5e",
  "23d54_1x1_dtm_004_2010_3003_13bb19046c82c46c031718bf1a06ee6a",
  "23d55_1x1_dtm_004_2010_3003_f5e6af2caf035973c8f00fa47c3b5737",
  "23d58_1x1_dtm_004_2010_3003_a55ded51f9dabfa79848ba96cc68d9ed",
  "23d60_1x1_dtm_004_2010_3003_6fa5a3c9637045e8ef3efbe74db3fae7",
  "23d61_1x1_dtm_004_2010_3003_d40e25a4c3805e2d0ad3c6169a5c6d5a",
  "23d62_1x1_dtm_004_2010_3003_6e5bba4270cc499d7c5526d9f5117345",
  "23d63_1x1_dtm_004_2010_3003_dc936d47809625b61851685f423d84c4",
  "22d02_1x1_dtm_005_2012_3003_f8e9d437fe8e103d427225b63d1f308b",
  "22d03_1x1_dtm_005_2012_3003_d146c623f9a65f11823e731e5163f5ca",
  "22d04_1x1_dtm_005_2012_3003_e2857a700da40f56396f237bb8375340",
  "22d05_1x1_dtm_005_2012_3003_87288bd53d778ed2a49c41d736aaca0d",
  "22d06_1x1_dtm_005_2012_3003_a2168ae5aab7ae58d44cda36e14cb334",
  "22d07_1x1_dtm_005_2012_3003_758faa1dab81b0b2f48e45b24d2bec81",
  "22d10_1x1_dtm_005_2012_3003_c5e297ff2ac750c4f8c12960c9dd5045",
  "22d11_1x1_dtm_005_2012_3003_e2104a14662d17945efa0972c29107b7",
  "22d12_1x1_dtm_005_2012_3003_1ee34e87267244330554634b277bcb3e",
  "22d13_1x1_dtm_005_2012_3003_c412ed28d5622e3c00c1f4cdf35b6e41",
  "22d14_1x1_dtm_005_2012_3003_fbca9acb1f75e8217ab21bbf2b30528b",
  "22d15_1x1_dtm_005_2012_3003_9fcde44da738b717ac22ceba48de4a2e",
  "23d50_1x1_dtm_005_2012_3003_f5366c179300b05f554d9ff657f4ac09",
  "23d51_1x1_dtm_005_2012_3003_7ad8470aacad520edf4861aa522deef5",
  "23d52_1x1_dtm_005_2012_3003_6f78653813882e7cf682a50a55b2399a",
  "23d58_1x1_dtm_005_2012_3003_f9e4afbd665f93575886abff9f003b74",
  "23d59_1x1_dtm_005_2012_3003_324ba537d0f2cbe6fe8c86ff7cbc9822",
  "23d60_1x1_dtm_005_2012_3003_a5f500b4a1c5ef920727816aa4e4480a",
  "23d61_1x1_dtm_005_2012_3003_288cb9bd121b939dd8e4635b62c6107a",
] as const
/** The 10 m DTM of the province of Massa-Carrara, from the CTR 1:10 000: the fallback for cells no LiDAR flight covers. */
const DTM10 = "MS_dtm10x10_epsg3003_md5_f691fc7fe3e6cdcb89d6dd82f65bb408"
/** DTM kept beyond the play area, m: room for the terrain grid's box filter and the projection's rotation. */
const MARGIN = 32
const UCS_WFS =
  "https://www502.regione.toscana.it/wmsraster/com.rt.wms.RTmap/wms?map=wmsucs&service=WFS&version=1.0.0&request=GetFeature&typeName=ms:rt_ucs.iducs.10k.2019.rt.full"

/** Whether `dir` holds a file at any depth: macOS purges the temp directory's files but keeps its folders. */
const holdsFiles = (dir: string): boolean =>
  existsSync(dir) &&
  readdirSync(dir, { recursive: true, withFileTypes: true }).some((e) => e.isFile())

/** The archive at `url`, extracted under CACHE; an extracted folder without files counts as missing. */
const fetchZip = async (url: string): Promise<string> => {
  const zip = join(CACHE, basename(url)),
    dir = zip.replace(/\.zip$/, "")
  if (!holdsFiles(dir)) {
    if (!existsSync(zip)) {
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
      writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
    }
    execFileSync("unzip", ["-o", "-q", zip, "-d", dir])
  }
  return dir
}

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

const findFile = (dir: string, name: string): string | undefined =>
  execFileSync("find", [dir, "-name", name], { encoding: "utf8" }).trim().split("\n")[0] ||
  undefined
const mustFind = (dir: string, name: string): string => {
  const hit = findFile(dir, name)
  if (hit === undefined) throw new Error(`${name} missing under ${dir}`)
  return hit
}

mkdirSync(CACHE, { recursive: true })
mkdirSync(join(OUT, "ctr"), { recursive: true })

for (const sheet of CTR_SHEETS) {
  const dir = await fetchZip(`${BASE}/ctr2k/SHP/S_${sheet}_2019_6707.zip`)
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
const corners = [
  [BOUNDS.minX, BOUNDS.minY],
  [BOUNDS.maxX, BOUNDS.minY],
  [BOUNDS.minX, BOUNDS.maxY],
  [BOUNDS.maxX, BOUNDS.maxY],
].map(([x, y]) => latLonToGaussBoaga(...fromLocal(x!, y!)))
const e0 = Math.floor(Math.min(...corners.map((c) => c[0])) - MARGIN) + 0.5,
  n0 = Math.floor(Math.min(...corners.map((c) => c[1])) - MARGIN) + 0.5
const cols = Math.ceil(Math.max(...corners.map((c) => c[0])) + MARGIN - e0) + 1,
  rows = Math.ceil(Math.max(...corners.map((c) => c[1])) + MARGIN - n0) + 1
const NODATA = -32768
const dm = new Int16Array(cols * rows).fill(NODATA) // row 0 = south

/** The 6-line header of an ESRI ASCII grid, keys lower-cased. */
const ascHeader = (lines: ReadonlyArray<string>): Record<string, number> =>
  Object.fromEntries(
    lines
      .slice(0, 6)
      .map((line) => line.trim().split(/\s+/))
      .map(([k, v]) => [k!.toLowerCase(), Number(v)]),
  )

for (const tile of DTM_TILES) {
  const lines = readFileSync(
    mustFind(await fetchZip(`${BASE}/altimetria/lidar/dtm/${tile}.zip`), "*.asc"),
    "latin1",
  ).split("\n")
  const { ncols, nrows, xllcenter, yllcenter, cellsize, nodata_value } = ascHeader(lines)
  if (cellsize !== 1) throw new Error(`${tile}: cell size ${cellsize}`)
  for (let r = 0; r < nrows!; r++) {
    const row = Math.round(yllcenter! + (nrows! - 1 - r) - n0)
    if (row < 0 || row >= rows) continue
    const values = lines[6 + r]!.trim().split(/\s+/)
    for (let c = 0; c < ncols!; c++) {
      const col = Math.round(xllcenter! + c - e0),
        z = Number(values[c])
      if (col >= 0 && col < cols && z !== nodata_value && dm[row * cols + col] === NODATA)
        dm[row * cols + col] = Math.round(z * 10)
    }
  }
}

/**
 * Bilinear sampler (decimetres) of the 10 m DTM over the crop. Its header gives cell corners
 * (xllcorner), so cell centres sit 5 m in. Only the rows over the crop are parsed.
 */
const dtm10 = async (): Promise<(e: number, n: number) => number> => {
  const buf = readFileSync(
    mustFind(await fetchZip(`${BASE}/altimetria/da_ctr10k/gb/dtm10x10/${DTM10}.zip`), "*.asc"),
  )
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
// sometimes loses features near the box's edge, so the box is padded by UCS_PAD (readUcs clips).
const UCS_PAD = 500
const gml = await (
  await fetch(
    `${UCS_WFS}&BBOX=${e0 - UCS_PAD},${n0 - UCS_PAD},${e0 + cols + UCS_PAD},${n0 + rows + UCS_PAD}`,
    { headers: HEADERS },
  )
).text()
const ucs = [...gml.matchAll(/<gml:featureMember>([\s\S]*?)<\/gml:featureMember>/g)]
  .flatMap(([, f]) => {
    const code = /<ms:ucs2019>(\d+)</.exec(f!)?.[1],
      id = Number(/<ms:pk_uid>(\d+)</.exec(f!)?.[1])
    if (code === undefined || !Object.hasOwn(UCS_CODES, code)) return []
    // One entry per polygon (a multipolygon has several), each its outer ring then its holes.
    return [...f!.matchAll(/<gml:Polygon[\s\S]*?<\/gml:Polygon>/g)].map(([poly]) => ({
      id,
      code,
      rings: [...poly.matchAll(/<gml:coordinates>([^<]*)</g)].map(([, cs]) =>
        cs!
          .trim()
          .split(/\s+/)
          .flatMap((p) => p.split(",").map((v) => Math.round(Number(v) * 10) / 10)),
      ),
    }))
  })
  .sort((a, b) => a.id - b.id)
if (!gml.includes("</wfs:FeatureCollection>")) throw new Error("UCS WFS: truncated answer")
if (ucs.length === 0) throw new Error("UCS WFS: no polygons")
pin(
  join(OUT, "ucs.json.gz"),
  Buffer.from(JSON.stringify({ crs: "EPSG:3003", year: 2019, polygons: ucs })),
)
console.log({ ucs: ucs.length })
