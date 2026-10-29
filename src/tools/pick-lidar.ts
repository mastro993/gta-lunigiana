// Picks a part's LiDAR DTM tiles by replaying `fetch-rt`'s first-wins mosaic over the part's crop
// (`dtm-mosaic.ts`: the EPSG:3003 box round its rectangles, an L's notch included, as fetch-rt
// mosaics it while it reads one part; issue #7 revisits both): tiles go in lot order (the lots
// named, 004 then 005 by default), then by sheet, and a tile is kept when it gives at least one
// cell no earlier tile gave. Run: node src/tools/pick-lidar.ts <part> [--lots 004,005] [--write]
// (pnpm pick-lidar <part> …). Reads .research/<part>/index.json (`rt-index` writes it) and the
// tiles' archives through the cache (`rt-cache.ts`; needs `unzip` on the PATH). Only RT's tiles
// (CC BY 4.0) are candidates: lots 006 and 007 (MATTM, CC BY-SA 3.0 IT) and the private lidar2k_noRT
// layer never are. Prints the tiles skipped and why, each candidate's cells in the crop and cells
// given first (1 m cells, m²), the holes no tile fills (the cells fetch-rt takes from the 10 m DTM:
// count, 4-connected holes, the largest), and how the picks differ from data/parts/<part>.json,
// order included. --write stores the picks there as `lidar`, in priority order.

import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parseArgs } from "node:util"

import { lidarUrl } from "./cartoteca.ts"
import { gaussBoagaToLatLon } from "./crs.ts"
import { type Crop, cropOf, eachCell } from "./dtm-mosaic.ts"
import { toLocal } from "./geometry.ts"
import { manifestPath, readManifest, updateManifest } from "./manifest.ts"
import { pool } from "./net.ts"
import { diffLines, diffList } from "./pick-diff.ts"
import { partOf } from "./region.ts"
import { fetchZip, mustFind } from "./rt-cache.ts"
import { readIndex } from "./rt-index-file.ts"

/** What a tile gives the mosaic: its data cells in the crop, and those no earlier tile gave. */
interface TileCells {
  readonly inCrop: number
  readonly first: number
}

/**
 * Replays one tile (its ESRI ASCII grid's lines) over `written`, one byte per crop cell: marks
 * the data cells no earlier tile marked, as fetch-rt's mosaic keeps a cell's first value.
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
    inCrop++
    if (written[k] === 0) {
      written[k] = 1
      first++
    }
  })
  return { inCrop, first }
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

  const crop = cropOf(part.rects)
  const written = new Uint8Array(crop.cols * crop.rows)
  const urls = candidates.map((t) => lidarUrl(t.dtm!))
  const dirs = await pool(urls, 4, fetchZip)
  console.log(
    `${part.key}: crop ${crop.cols} × ${crop.rows} m from EPSG:3003 ${crop.e0}, ${crop.n0}; ${candidates.length} candidates in lot order ${lots.join(", ")}`,
  )
  const picks: Array<string> = []
  candidates.forEach((t, i) => {
    const lines = readFileSync(mustFind(dirs[i]!, "*.asc"), "latin1").split("\n")
    const { inCrop, first } = replayTile(written, crop, lines, t.dtm!)
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

  const path = relative(join(import.meta.dirname, "../.."), manifestPath(part.key))
  for (const line of diffLines(diffList(readManifest(part.key).lidar, picks), path))
    console.log(line)
  if (values.write === true) {
    updateManifest(part.key, { lidar: picks })
    console.log(`wrote ${path}`)
  }
}
