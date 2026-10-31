/**
 * What a tyre or a foot is on: the road whose carriageway it is deepest inside, by its OSM
 * surface, else the land cover under it (`coverAt`). The tyres grip by it, the sound plays it.
 *
 * @module map/surface
 */
import { segDist2, staticGrid } from "../collide.ts"
import { type Cover, coverAt } from "./cover.ts"
import { MAP, type Road } from "./index.ts"

/** Every surface, as a closed set: road surfaces, stone paving, and the land cover off the road. */
const SURFACES = ["asphalt", "stone", "gravel", "dirt", "grass", "leaves"] as const
/** What a foot or a tyre is on. */
export type Surface = (typeof SURFACES)[number]

/**
 * Off the road, by land cover, as the terrain is painted: green covers are grass (scrub's brush is leaves), grey ones hard
 * (loose stones are gravel; bare rock, quarry floors and village paving are stone).
 */
const COVER_SURFACE = {
  meadow: "grass",
  forest: "leaves",
  grassland: "grass",
  scrub: "leaves",
  sparse: "gravel",
  scree: "gravel",
  rock: "stone",
  quarry: "stone",
  residential: "grass",
  farmland: "grass",
  farmyard: "dirt",
  vineyard: "grass",
  park: "grass",
  school: "grass",
  cemetery: "gravel",
  pitch: "grass",
  parking: "asphalt",
  industrial: "asphalt",
  paved: "stone",
  platform: "asphalt",
  ruins: "stone",
  pebble: "gravel",
  river: "gravel", // a river polygon's bed, its gravel where the water leaves it
  lake: "dirt", // a lake's silt
} as const satisfies Record<Cover, Surface>

/** The roads' OSM `surface` values; anything else is asphalt. */
const ROAD_SURFACE: Partial<Record<string, Surface>> = {
  asphalt: "asphalt",
  paved: "asphalt",
  concrete: "asphalt",
  cement: "asphalt",
  cobblestone: "stone",
  sett: "stone",
  paving_stones: "stone",
  pebblestone: "stone",
  unhewn_cobblestone: "stone",
  stone: "stone",
  gravel: "gravel",
  fine_gravel: "gravel",
  compacted: "gravel",
  dirt: "dirt",
  ground: "dirt",
  earth: "dirt",
  unpaved: "dirt",
  mud: "dirt",
  grass: "dirt",
}

/** A foot or a wheel this far past a carriageway's edge is still on the road, m. */
const VERGE = 0.5

/** A bridge deck or tunnel farther than this (m) from the asked level is not the one underfoot. */
const OFF_LEVEL = 1

/** Every road segment (flat ax, ay, bx, by) with its road and the profile elevations at its ends, gridded by its carriageway's box. */
const indexRoads = () => {
  const segs: Array<number> = [],
    road: Array<number> = [],
    z: Array<number> = []
  MAP.roads.forEach(({ pts, z: profile }, k) => {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      segs.push(pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!)
      road.push(k)
      z.push(profile[i / 2]!, profile[i / 2 + 1]!)
    }
  })
  const near = staticGrid(
    road.length,
    (i) => {
      const reach = MAP.roads[road[i]!]!.w / 2 + VERGE
      const ax = segs[4 * i]!,
        ay = segs[4 * i + 1]!,
        bx = segs[4 * i + 2]!,
        by = segs[4 * i + 3]!
      return [
        Math.min(ax, bx) - reach,
        Math.min(ay, by) - reach,
        Math.max(ax, bx) + reach,
        Math.max(ay, by) + reach,
      ]
    },
    32,
  )
  return { segs, road, z, near }
}
let roads: ReturnType<typeof indexRoads> | undefined

/**
 * What a foot or a tyre at (x, y) is on: the road whose carriageway it is deepest inside, else the land cover. Given the elevation it
 * stands at (`level`, m a.s.l.), a bridge deck or tunnel not at that level is not underfoot: the hillside over a tunnel is its cover,
 * the river bank under a deck its own.
 */
export const surfaceAt = (x: number, y: number, level?: number): Surface => {
  const { segs, road, z, near } = (roads ??= indexRoads())
  let deepest = 0,
    on: Road | undefined
  near(x, y, x, y, (i) => {
    const r = MAP.roads[road[i]!]!
    const { d2, t } = segDist2(
      x,
      y,
      segs[4 * i]!,
      segs[4 * i + 1]!,
      segs[4 * i + 2]!,
      segs[4 * i + 3]!,
    )
    if (
      level !== undefined &&
      (r.bridge === true || r.tunnel === true) &&
      Math.abs(z[2 * i]! + (z[2 * i + 1]! - z[2 * i]!) * t - level) > OFF_LEVEL
    )
      return
    const depth = r.w / 2 + VERGE - Math.sqrt(d2)
    if (depth >= deepest) [deepest, on] = [depth, r]
  })
  return on === undefined ? COVER_SURFACE[coverAt(x, y)] : (ROAD_SURFACE[on.surface] ?? "asphalt")
}
