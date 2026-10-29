// The 1 m LiDAR mosaic's grid and tile reader, shared by `fetch-rt` (which writes the mosaic) and
// `pick-lidar` (which replays it to see which tiles write a cell). A cell keeps the first value a
// tile gives it, so the tiles' order decides the mosaic.

import { gaussBoagaBox } from "./geometry.ts"
import type { Rect } from "./region.ts"

/** A 1 m grid in EPSG:3003: cell (col, row) is centred on (e0 + col, n0 + row), row 0 south. */
export interface Crop {
  readonly e0: number
  readonly n0: number
  readonly cols: number
  readonly rows: number
}

/** DTM kept beyond the play area, m: room for the terrain grid's box filter and the projection's rotation. */
export const MARGIN = 32

/** The crop of the rectangles: the EPSG:3003 box round their corners, widened by MARGIN, on the tiles' cell centres (x.5). */
export const cropOf = (rects: ReadonlyArray<Rect>): Crop => {
  const [e0, n0, e1, n1] = gaussBoagaBox(rects, MARGIN)
  const ce = Math.floor(e0) + 0.5,
    cn = Math.floor(n0) + 0.5
  return { e0: ce, n0: cn, cols: Math.ceil(e1 - ce) + 1, rows: Math.ceil(n1 - cn) + 1 }
}

/** The 6-line header of an ESRI ASCII grid, keys lower-cased. */
export const ascHeader = (lines: ReadonlyArray<string>): Record<string, number> =>
  Object.fromEntries(
    lines
      .slice(0, 6)
      .map((line) => line.trim().split(/\s+/))
      .map(([k, v]) => [k!.toLowerCase(), Number(v)]),
  )

/**
 * Calls `write(k, z)` for each cell of a 1 m tile (the lines of its ESRI ASCII grid, centre-
 * registered) that lies in the crop and holds data: `k` = row × cols + col, `z` in metres.
 */
export const eachCell = (
  lines: ReadonlyArray<string>,
  crop: Crop,
  name: string,
  write: (k: number, z: number) => void,
): void => {
  const { ncols, nrows, xllcenter, yllcenter, cellsize, nodata_value } = ascHeader(lines)
  if (cellsize !== 1) throw new Error(`${name}: cell size ${cellsize}`)
  if (xllcenter === undefined || yllcenter === undefined)
    throw new Error(`${name}: no xllcenter/yllcenter (a corner-registered grid)`)
  for (let r = 0; r < nrows!; r++) {
    const row = Math.round(yllcenter + (nrows! - 1 - r) - crop.n0)
    if (row < 0 || row >= crop.rows) continue
    const values = lines[6 + r]!.trim().split(/\s+/)
    for (let c = 0; c < ncols!; c++) {
      const col = Math.round(xllcenter + c - crop.e0),
        z = Number(values[c])
      if (col >= 0 && col < crop.cols && z !== nodata_value) write(row * crop.cols + col, z)
    }
  }
}
