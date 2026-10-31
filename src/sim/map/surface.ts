/**
 * What a tyre or a foot is on: the road whose carriageway it is deepest inside, by its OSM
 * surface, else the land cover under it (`coverAt`). The tyres grip by it, the sound plays it. The
 * roads come from the tile holding the point (`placeAt`), which holds every one that reaches it.
 *
 * @module map/surface
 */
import { segDist2 } from "../collide.ts"
import { addToBuckets, bucketItems, emptyBuckets } from "./buckets.ts"
import { type Cover, coverAt } from "./cover.ts"
import { MAP, type RoadInfo } from "./index.ts"
import { derived, type Place, placeAt } from "./tiles.ts"

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

/** Bucket side of the roads' broad phase, m. */
const CELL = 32

/**
 * A place's road segments (flat ax, ay, bx, by), each one's road (index into `MAP.roads`) and the
 * profile at its ends, in 32 m buckets (of segment indices) by its carriageway's box: by road then
 * vertex, as the whole map's broad phase visited a point's candidates. Built on a place's first use.
 */
const roadsOf = derived((place: Place) => {
  const segs: Array<number> = [],
    road: Array<number> = [],
    z: Array<number> = [],
    near = emptyBuckets<number>(CELL)
  const { ids, items } = place.vectors.roads
  ids.forEach((id, n) => {
    const { pts, z: profile } = items[n]!,
      reach = MAP.roads[id]!.w / 2 + VERGE
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i]!,
        ay = pts[i + 1]!,
        bx = pts[i + 2]!,
        by = pts[i + 3]!
      addToBuckets(
        near,
        road.length,
        Math.min(ax, bx) - reach,
        Math.min(ay, by) - reach,
        Math.max(ax, bx) + reach,
        Math.max(ay, by) + reach,
      )
      segs.push(ax, ay, bx, by)
      road.push(id)
      z.push(profile[i / 2]!, profile[i / 2 + 1]!)
    }
  })
  return { segs, road, z, near }
})

/**
 * What a foot or a tyre at (x, y) is on: the road whose carriageway it is deepest inside, else the land cover. Given the elevation it
 * stands at (`level`, m a.s.l.), a bridge deck or tunnel not at that level is not underfoot: the hillside over a tunnel is its cover,
 * the river bank under a deck its own. Of equally deep ones, the last in the whole map's order (by road, then segment).
 */
export const surfaceAt = (x: number, y: number, level?: number): Surface => {
  const { segs, road, z, near } = roadsOf(placeAt(x, y))
  let deepest = 0,
    on: RoadInfo | undefined
  for (const i of bucketItems(near, Math.floor(x / CELL), Math.floor(y / CELL))) {
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
      continue
    const depth = r.w / 2 + VERGE - Math.sqrt(d2)
    if (depth >= deepest) [deepest, on] = [depth, r]
  }
  return on === undefined ? COVER_SURFACE[coverAt(x, y)] : (ROAD_SURFACE[on.surface] ?? "asphalt")
}
