/**
 * Where the ground is, in metres a.s.l.: the ground model (`./ground-model.ts`) over the game's map.
 * Wheels, feet, sound sources and the renderer all read their heights here, so what is drawn and
 * what stands on it agree. The roads come from the tiles (each 16 m bucket of them from the tile
 * holding it, `placeAt`), so the answers are the whole map's whichever tiles are in memory; the
 * platforms from the global file.
 *
 * @module map/ground
 */
import { type GroundRoad, groundBuckets, groundModel } from "./ground-model.ts"
import { MAP } from "./index.ts"
import { anchorOf, ON_DECK, ROAD_LIFT } from "./kinds.ts"
import { cellCorners, derived, nodeAt, type Place, placeAt } from "./tiles.ts"
import { roadIndexAt } from "./vectors.ts"

export { ON_DECK, ROAD_LIFT }

const hm = MAP.heightmap
const { x: AX, y: AY, i: AI, j: AJ } = anchorOf(hm)
/** Terrain node (i, j) in decimetres, its indices clamped to the grid (`terrainNodeZ`). */
const clampedNode = (i: number, j: number): number =>
  nodeAt(Math.min(hm.cols - 1, Math.max(0, i)), Math.min(hm.rows - 1, Math.max(0, j)))

/**
 * Terrain node elevation at grid index (i, j), row 0 = south; indices outside the grid clamp to
 * the edge, which is how the apron beyond the map bounds continues the landscape.
 */
export const terrainNodeZ = (i: number, j: number): number => clampedNode(i, j) / 10

/** A place's roads as the ground reads them, in its `vectors.roads` order: the whole map's. */
const roadsOf = derived((place: Place): ReadonlyArray<GroundRoad> => {
  const { ids, items } = place.vectors.roads
  return Array.from(ids, (index, n): GroundRoad => {
    const { cls, w, verge, bridge, tunnel } = MAP.roads[index]!,
      { pts, z } = items[n]!
    return { index, pts, z, cls, w, verge, bridge, tunnel }
  })
})

/** A place's road segments in the ground model's buckets: a bucket in the place holds what the whole map's buckets held there. */
const bucketsOf = derived((place: Place) => groundBuckets(roadsOf(place)))

const ground = groundModel({
  anchor: { x: AX, y: AY },
  cell: hm.cell,
  corners: (fi, fj, out) => {
    const i = fi + AI,
      j = fj + AJ
    // Every wheel and foot reads here each step: on the grid, its nodes in one lookup where it can;
    // on the apron each node clamps on its own.
    if (i >= 0 && j >= 0 && i < hm.cols - 1 && j < hm.rows - 1) cellCorners(i, j, out)
    else for (let k = 0; k < 4; k++) out[k] = clampedNode(i + (k & 1), j + (k >> 1))
  },
  roadsAt: (x, y) => bucketsOf(placeAt(x, y)),
  // The tile holding (x, y) holds every road within `HALO` of the point.
  road: (index, x, y) => {
    const place = placeAt(x, y),
      k = roadIndexAt(place, index)
    return k < 0 ? undefined : roadsOf(place)[k]
  },
  platforms: MAP.railway.platforms.map(({ axis, top }, k) => ({
    rings: MAP.derived.platforms[k]!,
    axis,
    top,
  })),
})

/** Terrain elevation under (x, y) on the drawn mesh (`groundModel`). */
export const terrainZ = ground.terrainZ
/** The top of the station platform or walkway at (x, y), m a.s.l., or undefined (`groundModel`). */
export const platformTop = ground.platformTop
/** Surface elevation of a road whose profile is `z` at (x, y): at-grade roads never dip under the terrain (`groundModel`). */
export const roadZ = ground.roadZ
/** Where an actor at (x, y) stands, m a.s.l., on the level nearest `near` (`groundModel`). */
export const groundZ = ground.groundZ
/** The ground a wheel on ground at `z` at (x0, y0) comes to rolling straight to (x1, y1) (`groundModel`). */
export const rolledTo = ground.rolledTo
/** Which way the ground at (x, y) on the level nearest `near` faces (`groundModel`). */
export const facingAt = ground.facingAt
/** The highest bridge deck within `pad` m past its edge at (x, y), or undefined (`groundModel`). */
export const deckNear = ground.deckNear
/** Where someone on foot at (x, y) stands, m a.s.l. (`groundModel`). */
export const footZ = ground.footZ
/** Road `road`'s surface elevation at its point nearest (x, y), within `HALO` of it (`groundModel`). */
export const roadLevel = ground.roadLevel
/** The ground at (x, y) on the terrain's level: a road at grade, never a deck or a tunnel (`groundModel`). */
export const atGrade = ground.atGrade
/** What shows on top over ground `near` at (x, y): the highest at-grade ribbon or the terrain (`groundModel`). */
export const drawnZ = ground.drawnZ
