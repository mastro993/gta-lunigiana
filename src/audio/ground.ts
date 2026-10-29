/**
 * The map under sounds that can lie past the tiles in memory (a bell 5 km off, a train, a level
 * crossing, a thunderclap) and along the way to them. Each read is the exact map's where the tiles it
 * reads are in memory (`isResidentAt` in src/sim/map/tiles.ts) and the coarse 64 m grid's elsewhere
 * (src/sim/map/coarse.ts), so the audio never reads a tile that is not there and sounds as it did
 * wherever the tiles are. Within `STEP_REACH` of the player every tile is in memory (the host keeps
 * them for the sim): reads that never reach farther read the exact map directly.
 *
 * @module audio/ground
 */
import { coarseCoverAt, coarseHeightAt } from "../sim/map/coarse.ts"
import { type Cover, coverAt } from "../sim/map/cover.ts"
import { groundZ } from "../sim/map/ground.ts"
import { heightAt, MAP } from "../sim/map/index.ts"
import { isResidentAt } from "../sim/map/tiles.ts"

const { cell } = MAP.heightmap
/** A read this near a seam (m) checks the tiles on both sides: the lookups' own arithmetic may round across it. */
const SEAM = 1

/**
 * Whether the exact map can be read at (x, y): every tile its terrain cell touches is in memory (the
 * cell's east and north nodes may be the next tile's), within `SEAM` m.
 */
export const exactAt = (x: number, y: number): boolean => {
  const x0 = x - SEAM,
    y0 = y - SEAM,
    x1 = x + cell + SEAM,
    y1 = y + cell + SEAM
  return (
    isResidentAt(x0, y0) && isResidentAt(x1, y0) && isResidentAt(x0, y1) && isResidentAt(x1, y1)
  )
}

/** The terrain at (x, y), m a.s.l.: `heightAt`, else the coarse grid's. */
export const terrainAt = (x: number, y: number): number =>
  exactAt(x, y) ? heightAt(x, y) : coarseHeightAt(x, y)

/** The land cover at (x, y): `coverAt`, else the coarse grid's. */
export const landAt = (x: number, y: number): Cover =>
  exactAt(x, y) ? coverAt(x, y) : coarseCoverAt(x, y)

/** Elevation a.s.l. of what stands at (x, y): the terrain, a road, or the bridge deck nearest `near` (a previous elevation), as `groundZ`; else the coarse terrain. */
export const groundAt = (x: number, y: number, near?: number): number =>
  exactAt(x, y) ? groundZ(x, y, near) : coarseHeightAt(x, y)
