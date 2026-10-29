/**
 * Where the ground is, in render space. Three world = (x = east, y = elevation − ELEVATION_BASE,
 * z = −north). The heights themselves are the sim's (`src/sim/map/ground.ts`), so the terrain
 * mesh, the road ribbons, every actor and the wheels the physics rolls on agree. They read the map
 * tiles in memory; a read that can stray past them (a shadow fit's rays, a far bolt, a sight line's
 * far end) takes `farTerrainY`, which falls back to the coarse grid there.
 *
 * @module render/ground
 */
import { coarseHeightAt } from "../sim/map/coarse.ts"
import { atGrade, drawnZ, groundZ, roadZ, terrainNodeZ, terrainZ } from "../sim/map/ground.ts"
import { MAP } from "../sim/map/index.ts"
import { isResidentAt } from "../sim/map/tiles.ts"

/** Metres a.s.l. subtracted from every elevation before it reaches the GPU (the map spans ≈150–1800 m). */
const ELEVATION_BASE = 200

/** Render y of a map elevation (m a.s.l.). */
export const yOf = (z: number): number => z - ELEVATION_BASE

/** Map elevation (m a.s.l.) of a render y. */
export const zOf = (y: number): number => y + ELEVATION_BASE

/** Terrain node height at grid index (i, j), row 0 = south, clamped to the edge (the apron). */
export const terrainNodeY = (i: number, j: number): number => yOf(terrainNodeZ(i, j))

/** Terrain height under (x, y) on the rendered mesh. */
export const terrainY = (x: number, y: number): number => yOf(terrainZ(x, y))

const { cell } = MAP.heightmap
/**
 * Whether the terrain under (x, y) is in memory: the tiles of its cell's four nodes, which straddle
 * a seam in a tile's last row or column. `terrainY`, `groundY` and `atGradeY` there read nothing else.
 */
export const terrainResident = (x: number, y: number): boolean =>
  isResidentAt(x, y) &&
  isResidentAt(x + cell, y) &&
  isResidentAt(x, y + cell) &&
  isResidentAt(x + cell, y + cell)

/** `terrainY` where the terrain is in memory, else the coarse 64 m grid's height: for reads that can stray far from the player. */
export const farTerrainY = (x: number, y: number): number =>
  terrainResident(x, y) ? terrainY(x, y) : yOf(coarseHeightAt(x, y))

/** Surface y of a road whose profile is `z` (m a.s.l.) at (x, y): at-grade roads never dip under the terrain mesh. */
export const surfaceY = (z: number, x: number, y: number, lift: number, lifted: boolean): number =>
  yOf(roadZ(z, x, y, lift, lifted))

/** Where an actor at (x, y) stands in render y, keeping to the level nearest `near` (its previous render height); see `groundZ`. */
export const groundY = (x: number, y: number, near?: number): number =>
  yOf(groundZ(x, y, near === undefined ? undefined : near + ELEVATION_BASE))

/** The ground at (x, y) on the terrain's level, in render y: a road at grade, never a deck above or a tunnel below (`atGrade`). */
export const atGradeY = (x: number, y: number): number => yOf(atGrade(x, y))

/**
 * What shows on top at (x, y) on the level nearest `near` (render y), in render y: the ground there, or the higher road ribbon
 * drawn over it at a junction or a hairpin (`drawnZ`). Flat things laid on the ground (a blood pool) lie on it.
 */
export const drawnY = (x: number, y: number, near: number): number =>
  yOf(drawnZ(x, y, groundZ(x, y, near + ELEVATION_BASE)))

/** Faces steeper than this (normal y below it, ≈ 50°) show bare rock, and hold no snow (render/terrain, render/sky/surface). */
export const ROCK_NORMAL_Y = 0.64
