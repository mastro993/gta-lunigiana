// Picks a part's LiDAR DTM tiles by replaying `fetch-rt`'s first-wins mosaic (`dtm-mosaic.ts`'s
// reader) on a one-byte mask of the 1 m cells it fills for the part. For a Lunigiana part, those are
// the cells its tiles need (`partTiles`: each tile's square cut to the region's bounds, HALO round
// it, the 2 m cells in 1 m pairs as `tileCrop` takes them), and every other cell of the box round
// them is out of the replay (`needMask`); a cell a tile file in data/raw/rt/dtm already holds counts
// as written before any tile, as fetch-rt keeps it, and then every earlier part's manifest tiles
// write theirs, in PARTS order, as fetch-rt mosaics every part's before the next. A part of a test
// region with terrain of its own replays on its rectangles' crop (`cropOf`), all of it to fill,
// as fetch-rt mosaics it. Then the candidates go in lot order (the lots named, 004 then 005 by
// default), then by sheet, and a tile is kept when it writes at least one needed cell nothing wrote
// before. Run: node src/tools/pick-lidar.ts <part> [--lots 004,005] [--write]
// (pnpm pick-lidar <part> …). Reads .research/<part>/index.json (`rt-index` writes it; refused when
// its box is short of the one rt-index asks over today, `checkIndexBox`) and the tiles' archives
// through the cache (`rt-cache.ts`; needs `unzip` on the PATH); an earlier part's tile the index does
// not list lies wholly past the box, so it is not read. Only RT's tiles (CC BY 4.0) are candidates:
// lots 006 and 007 (MATTM, CC BY-SA 3.0 IT) and the private lidar2k_noRT layer never are. Prints
// the tiles skipped and why, the cells needed and held, each candidate's needed cells and cells
// given first (1 m cells, m²), the holes no tile fills (the cells fetch-rt fills through the
// fallback chain, `fill-chain.ts`: count, 4-connected holes, the largest), the 2021 surface model's
// elements whose index footprint meets a hole (the chain's second step), and how the picks differ
// from data/parts/<part>.json, order included. --write keeps the tiles and elements the manifest
// lists, which wrote the cells its fetch holds, and adds the picks it lacks after them (`lidar`, in
// priority order) and the elements (`dsm2021`, by number): once a part's fetch has run, its cells
// are held, so a run picks only the tiles a fetch would still take, where a grown region box adds
// cells (lucido's when Fivizzano grew the box, issue #17). To pick a part from the start, empty its
// `lidar` and `dsm2021` and delete its tiles' files first, as to fetch it again.

import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parseArgs } from "node:util"

import { lidarUrl } from "./cartoteca.ts"
import { gaussBoagaToLatLon } from "./crs.ts"
import { type Crop, cropOf, eachCell } from "./dtm-mosaic.ts"
import {
  CELL,
  type Cells,
  type DtmTile,
  blockOf,
  cropOver,
  intersect,
  partTiles,
  readTile,
  tileGrid,
  tileKeys,
} from "./dtm-tiles.ts"
import { NONE } from "./fill-chain.ts"
import { fillPolygon, toLocal } from "./geometry.ts"
import { manifestPath, readManifest, updateManifest } from "./manifest.ts"
import { pool } from "./net.ts"
import { diffLines, diffList } from "./pick-diff.ts"
import { PARTS, type Part, dtmDir, partOf, regionOfPart } from "./region.ts"
import { fetchZip, mustFind } from "./rt-cache.ts"
import { checkIndexBox, readIndex } from "./rt-index-file.ts"

/** A cell of the mask no tile of the part needs: past its tiles' cells, never written, never a hole. */
export const OUTSIDE = 3

/** What a tile gives the mosaic: its data cells the part needs, and those of them nothing gave before. */
interface TileCells {
  readonly inCrop: number
  readonly first: number
}

/**
 * Replays one tile (its ESRI ASCII grid's lines) over `written`, one byte per crop cell: marks
 * the needed data cells nothing marked before, as fetch-rt's mosaic keeps a cell's first value.
 */
export const replayTile = (
  written: Uint8Array,
  crop: Crop,
  lines: ReadonlyArray<string>,
  name: string,
): TileCells => {
  let inCrop = 0,
    first = 0
  eachCell(lines, crop, name, (k) => {
    if (written[k] === OUTSIDE) return
    inCrop++
    if (written[k] === 0) {
      written[k] = 1
      first++
    }
  })
  return { inCrop, first }
}

/**
 * The mask over the 1 m crop of the 2 m cells `needs` lists (`cropOver` the box round them, the crop
 * `tileCrop` seeds): each 1 m cell of a needed 2 m cell 0, or 1 where a file of `held` holds that
 * cell (fetch-rt seeds it, so no tile writes it), and every other cell OUTSIDE. So a cell is 0
 * exactly where `tileCrop`'s mosaic is NaN, the cells fetch-rt's LiDAR writes. `held` is read once,
 * a file at a time; the needed and held 1 m cells are counted.
 */
export const needMask = (
  needs: ReadonlyArray<Cells>,
  held: Iterable<DtmTile>,
): {
  readonly crop: Crop
  readonly written: Uint8Array
  readonly needed: number
  readonly held: number
} => {
  const block = blockOf(needs),
    crop = cropOver(block),
    { cols } = crop
  const written = new Uint8Array(cols * crop.rows).fill(OUTSIDE)
  for (const need of needs) {
    const c0 = 2 * ((need.e0 - block.e0) / CELL),
      r0 = 2 * ((need.n0 - block.n0) / CELL)
    for (let r = r0; r < r0 + 2 * need.rows; r++)
      written.fill(0, r * cols + c0, r * cols + c0 + 2 * need.cols)
  }
  /** Marks 1 m cell q held where it is needed: a held cell past the needs stays out of the replay. */
  const hold = (q: number) => {
    if (written[q] === 0) written[q] = 1
  }
  for (const t of held) {
    const shared = intersect(t, block)
    if (shared === undefined) continue
    const dc = (shared.e0 - t.e0) / CELL,
      dr = (shared.n0 - t.n0) / CELL,
      bc = (shared.e0 - block.e0) / CELL,
      br = (shared.n0 - block.n0) / CELL
    for (let r = 0; r < shared.rows; r++)
      for (let c = 0; c < shared.cols; c++) {
        if (t.codes[(dr + r) * t.cols + dc + c] === NONE) continue
        const k = 2 * (br + r) * cols + 2 * (bc + c)
        hold(k)
        hold(k + 1)
        hold(k + cols)
        hold(k + cols + 1)
      }
  }
  let needed = 0,
    holds = 0
  for (const w of written)
    if (w !== OUTSIDE) {
      needed++
      if (w === 1) holds++
    }
  return { crop, written, needed, held: holds }
}

/** The files in `dir` of the tiles whose cells meet `block`, read one at a time (`needMask` keeps none). */
function* filesOver(dir: string, block: Cells): Generator<DtmTile> {
  for (const { i, j } of tileKeys(dir))
    if (intersect(tileGrid(i, j), block) !== undefined) yield readTile(dir, i, j)!
}

/** The parts whose manifests' tiles fetch-rt mosaics before `part`'s: those before it in `parts`, none for a part not among them (a test region's). */
export const earlierParts = (part: Part, parts: ReadonlyArray<Part> = PARTS): ReadonlyArray<Part> =>
  parts.slice(0, Math.max(0, parts.indexOf(part)))

/** A LiDAR tile to replay: its archive's name and its ESRI ASCII grid's lines, read when it is replayed. */
interface Grid {
  readonly name: string
  readonly lines: () => ReadonlyArray<string>
}

/**
 * Replays the part's mosaic on `written` as fetch-rt writes it: the earlier parts' tiles first, then
 * the candidates in order. Returns the cells the earlier tiles wrote and what each candidate gives;
 * a candidate is kept when it gives a cell first.
 */
export const replayPart = (
  written: Uint8Array,
  crop: Crop,
  earlier: Iterable<Grid>,
  candidates: Iterable<Grid>,
): { readonly earlier: number; readonly candidates: Array<TileCells> } => {
  let before = 0
  for (const t of earlier) before += replayTile(written, crop, t.lines(), t.name).first
  return {
    earlier: before,
    candidates: [...candidates].map((t) => replayTile(written, crop, t.lines(), t.name)),
  }
}

/** A 4-connected run of cells no tile wrote: its size and its cells' mean and extent (crop col, row). */
interface Hole {
  readonly cells: number
  readonly col: number
  readonly row: number
  readonly box: readonly [number, number, number, number]
}

/** The holes in `written` (cols × rows, row-major): their cells, their number, the largest. Marks every hole cell 2. */
export const findHoles = (
  written: Uint8Array,
  cols: number,
  rows: number,
): { readonly cells: number; readonly count: number; readonly largest?: Hole } => {
  let cells = 0
  for (let k = 0; k < cols * rows; k++) if (written[k] === 0) cells++
  // Each hole cell is queued once over all holes, so one queue of `cells` entries serves them all.
  const queue = new Int32Array(cells)
  let count = 0,
    largest: Hole | undefined
  for (let k0 = 0, tail = 0; k0 < cols * rows; k0++) {
    if (written[k0] !== 0) continue
    const head0 = tail
    written[k0] = 2
    queue[tail++] = k0
    let sc = 0,
      sr = 0,
      c0 = cols,
      r0 = rows,
      c1 = -1,
      r1 = -1
    for (let q = head0; q < tail; q++) {
      const k = queue[q]!,
        c = k % cols,
        r = (k - c) / cols
      sc += c
      sr += r
      c0 = Math.min(c0, c)
      c1 = Math.max(c1, c)
      r0 = Math.min(r0, r)
      r1 = Math.max(r1, r)
      for (const nb of [c > 0 ? k - 1 : -1, c < cols - 1 ? k + 1 : -1, k - cols, k + cols])
        if (nb >= 0 && nb < cols * rows && written[nb] === 0) {
          written[nb] = 2
          queue[tail++] = nb
        }
    }
    const n = tail - head0
    count++
    if (n > (largest?.cells ?? 0))
      largest = { cells: n, col: sc / n, row: sr / n, box: [c0, r0, c1, r1] }
  }
  return { cells, count, ...(largest === undefined ? {} : { largest }) }
}

/**
 * The 2021 surface model's elements (RT's, archive answering 200) whose index footprint, EPSG:3003,
 * holds the centre of a hole cell (`written` 2, as `findHoles` marks them), by number.
 */
export const elementsOverHoles = (
  elements: ReadonlyArray<{
    readonly element: string
    readonly owner: string
    readonly status?: number
    readonly polygons: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
  }>,
  written: Uint8Array,
  crop: Crop,
): Array<string> => {
  const block = { c0: 0, r0: 0, cols: crop.cols, rows: crop.rows }
  return elements
    .filter(({ owner, status, polygons }) => {
      if (owner !== "RT" || status !== 200) return false
      let meets = false
      for (const rings of polygons)
        fillPolygon(rings, crop.e0 - 0.5, crop.n0 - 0.5, 1, block, (k) => {
          meets ||= written[k] === 2
        })
      return meets
    })
    .map((e) => e.element)
    .toSorted()
}

/**
 * What `--write` stores: the manifest's tiles as they are, which wrote the cells its fetch holds,
 * then the picks it lacks; its surface model's elements and the new ones, by number.
 */
export const keptAndPicked = (
  manifest: { readonly lidar: ReadonlyArray<string>; readonly dsm2021: ReadonlyArray<string> },
  picks: ReadonlyArray<string>,
  dsm2021: ReadonlyArray<string>,
): { readonly lidar: Array<string>; readonly elements: Array<string> } => ({
  lidar: [...manifest.lidar, ...picks.filter((t) => !manifest.lidar.includes(t))],
  elements: [...new Set([...manifest.dsm2021, ...dsm2021])].toSorted(),
})

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { lots: { type: "string", default: "004,005" }, write: { type: "boolean" } },
    allowPositionals: true,
  })
  const lots = values.lots.split(",")
  const part = partOf(positionals[0])
  const index = readIndex(part.key)
  const label = (t: { sheet: string; lot: string }) => `${t.sheet}/${t.lot}`

  // Candidates: RT's tiles of the lots named, with an archive to fetch. The rest, and why not.
  const requested = index.lidar.filter((t) => lots.includes(t.lot))
  const others = new Map<string, number>()
  for (const t of index.lidar)
    if (!lots.includes(t.lot)) others.set(t.lot, (others.get(t.lot) ?? 0) + 1)
  for (const [lot, n] of [...others].toSorted(([a], [b]) => (a < b ? -1 : 1)))
    console.log(`lot ${lot}: ${n} tiles not requested`)
  const unusable = (t: (typeof index.lidar)[number]): string | undefined => {
    if (t.owner !== "RT")
      return `owner ${t.owner ?? "unknown"}, licence ${t.licence ?? "unknown"}: only RT's CC BY 4.0 tiles`
    if (t.dtm === undefined) return "no DTM archive in its GetFeatureInfo"
    if (t.status !== 200) return `archive HEAD ${t.status ?? "none"}`
    return undefined
  }
  const candidates = requested
    .filter((t) => {
      const why = unusable(t)
      if (why !== undefined) console.log(`skipped ${label(t)}: ${why}`)
      return why === undefined
    })
    .toSorted((a, b) => lots.indexOf(a.lot) - lots.indexOf(b.lot) || (a.sheet < b.sheet ? -1 : 1))

  // The mask: a Lunigiana part's tiles' cells, those the tile files hold written; a test region's
  // own crop, all of it to fill.
  const region = regionOfPart(part),
    root = join(import.meta.dirname, "../.."),
    dir = join(root, dtmDir(region), "dtm")
  checkIndexBox(index.box, part, region)
  const tiles = region.ownTerrain ? [] : partTiles(part.rects, region.bounds)
  const { crop, written, needed, held } = region.ownTerrain
    ? (() => {
        const own = cropOf(part.rects),
          n = own.cols * own.rows
        return { crop: own, written: new Uint8Array(n), needed: n, held: 0 }
      })()
    : needMask(
        tiles.map((t) => t.need),
        filesOver(dir, blockOf(tiles.map((t) => t.need))),
      )
  // The earlier parts' tiles over the crop: the index lists every tile that meets its box, which
  // holds the crop, so one it does not list writes no cell of it.
  const earlier = earlierParts(part),
    listed = new Set(index.lidar.map((t) => t.dtm))
  const before = [...new Set(earlier.flatMap((p) => readManifest(p.key).lidar))].filter((name) =>
    listed.has(name),
  )
  const archives = [...new Set([...before, ...candidates.map((t) => t.dtm!)])]
  const dirs = await pool(archives.map(lidarUrl), 4, fetchZip)
  /** The tile `name` to replay, its grid read from its cached archive when replayed. */
  const grid = (name: string) => ({
    name,
    lines: () =>
      readFileSync(mustFind(dirs[archives.indexOf(name)]!, "*.asc"), "latin1").split("\n"),
  })
  console.log(
    `${part.key}: crop ${crop.cols} × ${crop.rows} m from EPSG:3003 ${crop.e0}, ${crop.n0}; ${candidates.length} candidates in lot order ${lots.join(", ")}`,
  )
  if (!region.ownTerrain)
    console.log(
      `its ${tiles.length} tiles need ${needed} m², ${held} m² of them held by ${relative(root, dir)}`,
    )
  const replayed = replayPart(
    written,
    crop,
    before.map(grid),
    candidates.map((t) => grid(t.dtm!)),
  )
  if (earlier.length > 0)
    console.log(
      `${earlier.map((p) => p.key).join(", ")}: ${before.length} tiles over the crop write ${replayed.earlier} m² first`,
    )
  const picks: Array<string> = []
  candidates.forEach((t, i) => {
    const { inCrop, first } = replayed.candidates[i]!
    if (first > 0) picks.push(t.dtm!)
    console.log(
      `  ${label(t)} ${t.year}  in crop ${inCrop} m²  first ${first} m²  ${first > 0 ? "kept" : "dropped"}`,
    )
  })
  console.log(`${picks.length} kept`)

  const holes = findHoles(written, crop.cols, crop.rows)
  console.log(
    `holes: ${holes.cells} m² (${(holes.cells / 1e6).toFixed(4)} km²) in ${holes.count} 4-connected holes`,
  )
  if (holes.largest !== undefined) {
    const { cells, col, row, box } = holes.largest
    const e = crop.e0 + col,
      n = crop.n0 + row
    const [x, y] = toLocal(...gaussBoagaToLatLon(e, n))
    console.log(
      `largest: ${cells} m², centred at EPSG:3003 ${e.toFixed(0)}, ${n.toFixed(0)} (local ${x.toFixed(0)}, ${y.toFixed(0)}), ${box[2] - box[0] + 1} × ${box[3] - box[1] + 1} m`,
    )
  }

  const dsm2021 = elementsOverHoles(index.dsm2021, written, crop)
  console.log(`the 2021 surface model's elements over the holes: ${dsm2021.join(", ") || "none"}`)

  const path = relative(root, manifestPath(part.key))
  const manifest = readManifest(part.key)
  const { lidar, elements } = keptAndPicked(manifest, picks, dsm2021)
  for (const line of [
    ...diffLines(diffList(manifest.lidar, lidar), path),
    ...diffLines(diffList(manifest.dsm2021, elements), `${path} dsm2021`),
  ])
    console.log(line)
  if (values.write === true) {
    updateManifest(part.key, { lidar, dsm2021: elements })
    console.log(`wrote ${path}`)
  }
}
