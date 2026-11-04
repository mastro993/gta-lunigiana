// The terrain fetch-rt writes: a 1 m crop's LiDAR mosaic (the tiles in priority order, a cell
// keeping the first value written) filled by the fallback chain for the cells no tile has
// (`fillCrop`, `fill-chain.ts`, `terrain-sources.ts`, issue #10), averaged to 2 m cells and written
// as a test region's own mosaic (`writeMosaic`: dtm.json, dtm.bin, dtm-src.bin) or into the map's
// tile files (`writeTiles`, `dtm-tiles.ts`, issue #17). For the tiles, the crop is seeded with the
// cells their files already hold (`tileCrop`): the LiDAR and the chain fill only the cells none
// holds, and the chain's bend meets the held ones, so a part's fetch never moves another's cell and
// joins it without a step.
import { readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { deflateSync, inflateSync } from "node:zlib"

import { dsm2021Url, dtm10Url, lidarUrl } from "./cartoteca.ts"
import { type Crop, ascHeader, eachCell } from "./dtm-mosaic.ts"
import {
  CELL,
  type Cells,
  type DtmTile,
  blockOf,
  cropOver,
  emptyTile,
  encodeTile,
  intersect,
  readTile,
  tileGrid,
  tileKeys,
  tilePath,
} from "./dtm-tiles.ts"
import { type Filler, type Mosaic, NONE, OUT, fillStep } from "./fill-chain.ts"
import { getBytes } from "./net.ts"
import { RAW_DIR, readLock, writeRaw } from "./raw-lock.ts"
import { fetchZip, mustFind } from "./rt-cache.ts"
import {
  LIG_FADE,
  MAX_SWEEPS,
  SOURCES,
  type Source,
  ascWindow,
  clearCanopy,
  codeOf,
  geoTiffRaster,
  ligRaster,
  openGround,
  rasterFiller,
  rerUrl,
  utmBox,
  utmOfCrop,
} from "./terrain-sources.ts"

/** A UCS polygon as the WFS answers it (`parseGml`): its attributes and its rings in EPSG:3003. */
export interface UcsFeature {
  readonly attrs: Readonly<Record<string, string>>
  readonly polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
}

/** What the fill takes past a crop's seeds: the archives, Liguria's crops and the land cover, and how its source string names them. */
export interface ChainInputs {
  /** The LiDAR DTM tiles' archives in priority order (a cell keeps the first value written). */
  readonly lidar: ReadonlyArray<string>
  /** How the source names the list the LiDAR comes from (`data/parts/lucido.json`). */
  readonly lidarFrom: string
  /** The 2021 surface model's elements, for open ground. */
  readonly dsm2021: ReadonlyArray<string>
  /** The province 10 m DTMs, in priority order. */
  readonly dtm10: ReadonlyArray<string>
  /** Liguria's DTM crops (`fetch-lig`) and how the source names them; none outside Liguria. */
  readonly lig: { readonly files: ReadonlyArray<string>; readonly from: string } | undefined
  /** The UCS's polygons over the crop, whose open ground the surface model may fill, and their source. */
  readonly features: ReadonlyArray<UcsFeature>
  readonly ucsFrom: string
}

/** A box of crop cells [c0, r0, c1, r1], ends included. */
type Box = [number, number, number, number]

/** Whether the ESRI ASCII grid `text`'s cells meet the crop: its header's centres against the crop's. */
const meetsCrop = (text: string, crop: Crop): boolean => {
  const { ncols, nrows, xllcenter, yllcenter } = ascHeader(text.slice(0, 400).split("\n"))
  return (
    xllcenter! + ncols! - 1 >= crop.e0 &&
    xllcenter! <= crop.e0 + crop.cols - 1 &&
    yllcenter! + nrows! - 1 >= crop.n0 &&
    yllcenter! <= crop.n0 + crop.rows - 1
  )
}

/**
 * Fills `m`'s NaN cells, those of the crop it must fill: first the LiDAR tiles in order, each cell
 * the first value written, then the chain for the cells no tile has: the 2021 surface model on the
 * open ground (less its canopy, against the 10 m DTMs), the province 10 m DTMs, Liguria's DTM ed.
 * 2023, Emilia-Romagna's DTM 5x5 beyond Tuscany, each bent onto the cells before it (`fillStep`).
 * Throws when a cell is still empty. Returns the sources it took, in order, for the files' source.
 */
export const fillCrop = async (
  crop: Crop,
  m: Mosaic,
  inputs: ChainInputs,
): Promise<Array<string>> => {
  const { e0, n0, cols, rows } = crop,
    { dm, src } = m
  for (const tile of inputs.lidar) {
    const text = readFileSync(mustFind(await fetchZip(lidarUrl(tile)), "*.asc"), "latin1")
    if (!meetsCrop(text, crop)) continue
    eachCell(text.split("\n"), crop, tile, (k, z) => {
      if (Number.isNaN(dm[k]!)) {
        dm[k] = Math.round(z * 10)
        src[k] = codeOf("lidar")
      }
    })
  }
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
  /** The 10 m DTMs named, over a box of crop cells, as one filler: the first with data at a cell wins. */
  const dtm10 = async (names: ReadonlyArray<string>, box: Box): Promise<Filler> => {
    const rasters = []
    for (const name of names) {
      const file = mustFind(await fetchZip(dtm10Url(name)), "*.asc")
      const raster = ascWindow(readFileSync(file), gbAround(box, 10), name)
      if (raster !== undefined) rasters.push(raster)
    }
    return rasterFiller("dtm10", crop, rasters)
  }
  const { lig } = inputs
  /** The chain after the LiDAR, each step loaded once cells are still empty, with where it comes from. */
  const steps: Array<(box: Box) => Promise<{ readonly filler: Filler; readonly source: string }>> =
    [
      ...(inputs.dsm2021.length === 0
        ? []
        : [
            async (box: Box) => {
              if (inputs.dtm10.length === 0)
                throw new Error("the surface model needs a 10 m DTM to tell canopy from ground")
              const open = openGround(inputs.features, crop),
                window = utmAround(box, 2)
              const rasters = []
              for (const element of inputs.dsm2021) {
                const file = mustFind(await fetchZip(dsm2021Url(element)), "*.asc")
                const raster = ascWindow(readFileSync(file), window, element)
                if (raster !== undefined) rasters.push(raster)
              }
              const dsm = rasterFiller("dsm2021", crop, rasters, utm)
              const bare = () =>
                open.reduce((n, o, k) => n + Number(o === 1 && Number.isNaN(dm[k]!)), 0)
              const before = bare()
              clearCanopy(open, dsm, await dtm10(inputs.dtm10, box), crop, box)
              console.log(
                `dsm2021: ${before} m² of open ground without LiDAR, ${before - bare()} m² of it canopy, pits or scraps`,
              )
              return {
                filler: { ...dsm, where: (k: number) => open[k] === 1 },
                source: `the 2021 surface model's elements ${inputs.dsm2021.join(", ")} (${dsm2021Url("<element>")}) on the open ground of ${inputs.ucsFrom}, less its canopy (its height over the 10 m DTMs)`,
              }
            },
          ]),
      ...inputs.dtm10.map((name) => async (box: Box) => ({
        filler: await dtm10([name], box),
        source: dtm10Url(name),
      })),
      ...(lig === undefined || lig.files.length === 0
        ? []
        : [
            async () => {
              const { raster, sweeps } = (await ligRaster(lig.files.map((f) => readFileSync(f))))!
              console.log(
                `lig: its whole metres smoothed in ${sweeps} sweeps${sweeps === MAX_SWEEPS ? ", the most unround makes: not settled" : ""}`,
              )
              return {
                filler: { ...rasterFiller("lig", crop, [raster]), fade: LIG_FADE },
                source: lig.from,
              }
            },
          ]),
      async (box: Box) => {
        const url = rerUrl(utmAround(box, 10))
        return {
          filler: rasterFiller("rer", crop, [await geoTiffRaster(await getBytes(url))], utm),
          source: `${url}, fetched ${new Date().toISOString().slice(0, 10)}`,
        }
      },
    ]
  const used = [`the lidar archives of ${inputs.lidarFrom} (${lidarUrl("<lidar>")})`]
  for (const step of steps) {
    const box = emptyBox()
    if (box === undefined) break
    const { filler, source } = await step(box)
    const r = fillStep(m, filler)
    if (r.cells === 0) continue
    used.push(source)
    const name = SOURCES[r.source]!,
      d = (v: number) => (v / 10).toFixed(1)
    console.log(
      `${name}: ${r.cells} m², rim ${r.rim} cells (better - ${name} ${d(r.residual[0])} to ${d(r.residual[1])} m), ${r.fit} fitted; the lattice leaves ≤ ${d(r.leftover)} m (${r.iterations} iterations), the band ${r.band} cells in ${r.sweeps} sweeps`,
    )
  }
  const left = emptyBox()
  if (left !== undefined)
    throw new Error(
      `no terrain source covers EPSG:3003 ${gbAround(left, 0).join(", ")} (the box round the cells left)`,
    )
  return used
}

/** The 2 m cell over 1 m crop cells (2c, 2r) to (2c + 1, 2r + 1): their mean, dm, and the most of their sources, ties to the earlier. */
const mean2 = (m: Mosaic, c: number, r: number, votes: Uint8Array): readonly [number, number] => {
  const k = 2 * r * m.cols + 2 * c,
    four = [k, k + 1, k + m.cols, k + m.cols + 1]
  const mean = Math.round((m.dm[k]! + m.dm[k + 1]! + m.dm[k + m.cols]! + m.dm[k + m.cols + 1]!) / 4)
  votes.fill(0)
  for (const q of four) votes[m.src[q]!]!++
  return [mean, votes.indexOf(Math.max(...votes))]
}

/**
 * Writes a test region's own mosaic to `out` (dtm.bin, dtm-src.bin, dtm.json): the crop's 2 × 2
 * means, so cell (i, j) covers 1 m cells 2i..2i+1, 2j..2j+1 and its centre is 0.5 m past theirs;
 * int16 decimetres, each row delta-coded, deflated; its source the most of its four cells'.
 */
export const writeMosaic = (
  out: string,
  crop: Crop,
  m: Mosaic,
  used: ReadonlyArray<string>,
): void => {
  const cols2 = Math.floor(crop.cols / 2),
    rows2 = Math.floor(crop.rows / 2)
  const deltas = new Int16Array(cols2 * rows2),
    sources = new Uint8Array(cols2 * rows2),
    votes = new Uint8Array(SOURCES.length)
  for (let j = 0, prev = 0; j < rows2; j++)
    for (let i = 0; i < cols2; i++) {
      const [mean, source] = mean2(m, i, j, votes)
      deltas[j * cols2 + i] = i === 0 ? mean : mean - prev
      prev = mean
      sources[j * cols2 + i] = source
    }
  /** The mosaic's sources: the archives, each named with its MD5, and the services. */
  const mosaic = used.join("; then ")
  const deflate = (b: Buffer) => deflateSync(b, { level: 9 })
  writeRaw(join(out, "dtm.bin"), Buffer.from(deltas.buffer), mosaic, deflate, inflateSync)
  writeRaw(join(out, "dtm-src.bin"), Buffer.from(sources.buffer), mosaic, deflate, inflateSync)
  const meta = {
    crs: "EPSG:3003",
    e0: crop.e0 + 0.5,
    n0: crop.n0 + 0.5,
    cols: cols2,
    rows: rows2,
    cell: 2,
    unit: "dm",
    encoding: "int16le, row 0 = south, each row delta-coded from its first value, deflate",
    sources: SOURCES,
    sourceEncoding: "dtm-src.bin: uint8 per cell, its index in sources, row 0 = south, deflate",
  }
  writeRaw(
    join(out, "dtm.json"),
    Buffer.from(`${JSON.stringify(meta, null, 2)}\n`),
    mosaic,
    (b) => b,
    (b) => b,
  )
  const counts = SOURCES.map((_, code) => sources.reduce((n, s) => n + (s === code ? 1 : 0), 0))
  console.log({
    ...meta,
    bytes: readFileSync(join(out, "dtm.bin")).length,
    km2: Object.fromEntries(SOURCES.map((s, code) => [s, (counts[code]! * 4) / 1e6])),
  })
}

/** Tile `t` with its sources renamed to SOURCES' order (a file written before a source was added). */
const inSources = (t: DtmTile, name: string): DtmTile => {
  if (t.names.length === SOURCES.length && t.names.every((s, k) => s === SOURCES[k])) return t
  const code = t.names.map((s) => {
    if (!(SOURCES as ReadonlyArray<string>).includes(s))
      throw new Error(`${name}: unknown source ${s}`)
    return codeOf(s as Source)
  })
  return { ...t, names: SOURCES, codes: t.codes.map((c) => (c === NONE ? NONE : code[c]!)) }
}

/** Every tile file in `dir`, by key. */
export const tileFiles = (dir: string): Map<string, DtmTile> =>
  new Map(
    tileKeys(dir).map(({ i, j }) => [
      `${i}_${j}`,
      inSources(readTile(dir, i, j)!, `${i}_${j}.bin`),
    ]),
  )

/**
 * The 1 m crop over the 2 m cells `needs` lists (each the cells a tile must hold), seeded: a cell
 * some file of `held` holds takes its height and source (its four 1 m cells), a cell a need lists
 * and none holds is NaN for the fill, and every other cell is OUT, left alone. The crop's 1 m cells
 * pair into the lattice's 2 m ones, (2c, 2r) to (2c + 1, 2r + 1).
 */
export const tileCrop = (
  needs: ReadonlyArray<Cells>,
  held: Iterable<DtmTile>,
): {
  readonly crop: Crop
  readonly mosaic: Mosaic
  readonly block: Cells
  readonly empty: number
} => {
  const block = blockOf(needs),
    { e0, n0 } = block
  const crop = cropOver(block)
  const dm = new Float32Array(crop.cols * crop.rows),
    src = new Uint8Array(crop.cols * crop.rows).fill(OUT)
  /** Sets 2 m cell (c, r) of the block's four 1 m cells. */
  const set = (c: number, r: number, h: number, s: number) => {
    const k = 2 * r * crop.cols + 2 * c
    for (const q of [k, k + 1, k + crop.cols, k + crop.cols + 1]) {
      dm[q] = h
      src[q] = s
    }
  }
  for (const need of needs) {
    const dc = (need.e0 - e0) / CELL,
      dr = (need.n0 - n0) / CELL
    for (let r = 0; r < need.rows; r++)
      for (let c = 0; c < need.cols; c++) set(dc + c, dr + r, Number.NaN, NONE)
  }
  for (const t of held) {
    const shared = intersect(t, block)
    if (shared === undefined) continue
    for (let r = 0; r < shared.rows; r++)
      for (let c = 0; c < shared.cols; c++) {
        const tc: number = (shared.e0 - t.e0) / CELL + c,
          tr: number = (shared.n0 - t.n0) / CELL + r,
          k = tr * t.cols + tc
        if (t.codes[k] === NONE) continue
        set((shared.e0 - e0) / CELL + c, (shared.n0 - n0) / CELL + r, t.dm[k]!, t.codes[k]!)
      }
  }
  let empty = 0
  for (let k = 0; k < dm.length; k++) if (Number.isNaN(dm[k]!)) empty++
  return { crop, mosaic: { cols: crop.cols, rows: crop.rows, dm, src }, block, empty }
}

/** Writes a tile file's unpacked bytes, deflated, unless the file already holds them, and records it in the lock (`writeRaw`). */
const putTile = (file: string, bytes: Buffer, source: string): void =>
  writeRaw(file, bytes, source, (b) => deflateSync(b, { level: 9 }), inflateSync)

/** The source the lock records for `file` under data/raw; undefined when it records none. */
const lockedSource = (file: string): string | undefined =>
  readLock()[relative(RAW_DIR, file).split(sep).join("/")]?.source

/**
 * Writes each of `tiles` (i, j and the cells it must hold) into its file in `dir` through `put`:
 * the cells its file already holds (`held`) stay, and each it must hold and lacks takes the filled
 * crop's 2 × 2 mean over `block` and the most of their sources. The lock keeps one source a file,
 * so a file that held cells keeps the source `prior` gives for them, this fetch's following it for
 * the cells it adds; a new file takes this fetch's alone.
 */
export const writeTiles = (
  dir: string,
  tiles: ReadonlyArray<{ readonly i: number; readonly j: number; readonly need: Cells }>,
  held: ReadonlyMap<string, DtmTile>,
  block: Cells,
  m: Mosaic,
  used: ReadonlyArray<string>,
  put: (file: string, bytes: Buffer, source: string) => void = putTile,
  prior: (file: string) => string | undefined = lockedSource,
): void => {
  const source = used.join("; then "),
    votes = new Uint8Array(SOURCES.length)
  for (const { i, j, need } of tiles) {
    const t = held.get(`${i}_${j}`) ?? emptyTile(i, j, SOURCES),
      g = tileGrid(i, j)
    if (t.e0 !== g.e0 || t.n0 !== g.n0 || t.cols !== g.cols || t.rows !== g.rows)
      throw new Error(`tile ${i}_${j}'s file is not its cells ${JSON.stringify(g)}`)
    const dm = Int16Array.from(t.dm),
      codes = Uint8Array.from(t.codes)
    let added = 0
    for (let r = 0; r < need.rows; r++)
      for (let c = 0; c < need.cols; c++) {
        const k = ((need.n0 - t.n0) / CELL + r) * t.cols + (need.e0 - t.e0) / CELL + c
        if (codes[k] !== NONE) continue
        const [mean, s] = mean2(
          m,
          (need.e0 - block.e0) / CELL + c,
          (need.n0 - block.n0) / CELL + r,
          votes,
        )
        dm[k] = mean
        codes[k] = s
        added++
      }
    console.log(`tile ${i}_${j}: ${added} cells added`)
    const file = tilePath(dir, i, j),
      before = held.has(`${i}_${j}`) ? prior(file) : undefined
    // A file this fetch adds no cell to keeps its source alone: its bytes change only where its
    // sources' names are put in today's order (`inSources`), and none of its cells is this fetch's.
    const named =
      before === undefined
        ? source
        : added === 0
          ? before
          : `${before}; then, for the ${added} cells it lacked: ${source}`
    put(file, encodeTile({ ...t, names: SOURCES, dm, codes }), named)
  }
}
