/**
 * The whole map's terrain and land cover on the coarse 64 m lattice (`MAP.coarse`): for hosts that
 * read far from the player, where no tile is in memory (sound paths and their ground, shadow fits,
 * lightning). Pure functions of the global file, so they answer anywhere at any time; the sim never
 * reads them (it reads the exact tiles near the player).
 *
 * @module map/coarse
 */
import { MAP } from "./global.ts"
import { type Cover, coverName } from "./raster.ts"

const { cell, cols, rows, x0, y0, heights, cover } = MAP.coarse

/** The coarse terrain height (m a.s.l.) at (x, y): bilinear between the 64 m lattice's nodes, clamped to the lattice. */
export const coarseHeightAt = (x: number, y: number): number => {
  const fx = Math.min(cols - 1, Math.max(0, (x - x0) / cell)),
    fy = Math.min(rows - 1, Math.max(0, (y - y0) / cell))
  const i = Math.min(cols - 2, Math.floor(fx)),
    j = Math.min(rows - 2, Math.floor(fy))
  const tx = fx - i,
    ty = fy - j,
    k = j * cols + i
  const south = heights[k]! + (heights[k + 1]! - heights[k]!) * tx
  const north = heights[k + cols]! + (heights[k + cols + 1]! - heights[k + cols]!) * tx
  return (south + (north - south) * ty) / 10
}

/** The coarse land cover at (x, y): the 4 m cell at the 64 m lattice node south-west of it, clamped to the lattice. */
export const coarseCoverAt = (x: number, y: number): Cover => {
  const i = Math.min(cols - 1, Math.max(0, Math.floor((x - x0) / cell))),
    j = Math.min(rows - 1, Math.max(0, Math.floor((y - y0) / cell)))
  return coverName(cover[j * cols + i]!)
}
