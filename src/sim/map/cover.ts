/**
 * The land cover of the 4 m terrain cells (`./raster.ts` says how the build makes it), read from the
 * tiles: the terrain is painted from it, the tyres grip by it (through `surfaceAt`) and the sound
 * reads it.
 *
 * @module map/cover
 */
import { MAP } from "./global.ts"
import { type Cover, coverName } from "./raster.ts"
import { coverCell } from "./tiles.ts"

export { type Cover, coverName, rasterCover } from "./raster.ts"

const { cell, x0, y0 } = MAP.heightmap,
  COLS = MAP.heightmap.cols - 1,
  ROWS = MAP.heightmap.rows - 1

/** The land-cover index (`coverName` names it) of heightmap cell (i, j), clamped to the map: what the terrain mesh paints. */
export const coverIndexAt = (i: number, j: number): number =>
  coverCell(Math.min(COLS - 1, Math.max(0, i)), Math.min(ROWS - 1, Math.max(0, j)))

/** The land cover of the 4 m cell under (x, y), clamped to the map. */
export const coverAt = (x: number, y: number): Cover =>
  coverName(coverIndexAt(Math.floor((x - x0) / cell), Math.floor((y - y0) / cell)))
