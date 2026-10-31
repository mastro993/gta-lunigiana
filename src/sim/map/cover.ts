/**
 * The land cover of the 4 m terrain cells (`./raster.ts` says how the build makes it), read from the
 * tiles: the terrain is painted from it, the tyres grip by it (through `surfaceAt`) and the sound
 * reads it.
 *
 * @module map/cover
 */
import { MAP } from "./global.ts"
import { anchorOf } from "./kinds.ts"
import { type Cover, coverName } from "./raster.ts"
import { coverCell } from "./tiles.ts"

export { type Cover, coverName } from "./raster.ts"

const { cell } = MAP.heightmap,
  { x: AX, y: AY, i: AI, j: AJ } = anchorOf(MAP.heightmap),
  COLS = MAP.heightmap.cols - 1,
  ROWS = MAP.heightmap.rows - 1

/** The land-cover index (`coverName` names it) of heightmap cell (i, j), clamped to the map: what the terrain mesh paints. */
export const coverIndexAt = (i: number, j: number): number =>
  coverCell(Math.min(COLS - 1, Math.max(0, i)), Math.min(ROWS - 1, Math.max(0, j)))

/** The land cover of the 4 m cell under (x, y), clamped to the map; the cell measured from the region's anchor (`anchorOf`). */
export const coverAt = (x: number, y: number): Cover =>
  coverName(coverIndexAt(Math.floor((x - AX) / cell) + AI, Math.floor((y - AY) / cell) + AJ))
