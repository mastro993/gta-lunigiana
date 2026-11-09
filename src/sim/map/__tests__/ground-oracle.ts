// The ground, surface and water lookups over the whole map, as they were before the vectors left the
// global file (issue #63): one broad phase over the whole map's roads, platforms, rivers and water
// areas, built here from the map joined back from its tiles (`wholeMap`); the ground is the ground
// model over the whole data (`wholeGround`). ground.map-test.ts holds the tiled lookups to them, to
// the bit: the tiling, not the rules, is what it checks.

import type { JoinedMap } from "../../../tools/map-file.ts"
import { segDist2, staticGrid } from "../../collide.ts"
import { coverAt } from "../cover.ts"
import { groundBuckets, wholeGround } from "../ground-model.ts"
import { terrainNodeZ } from "../ground.ts"
import type { Road } from "../index.ts"
import { anchorOf } from "../kinds.ts"
import type { Surface } from "../surface.ts"
import { mainWater } from "./water-oracle.ts"

/** Off the road, by land cover (surface.ts's table). */
const COVER_SURFACE: Record<string, Surface> = {
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
  river: "gravel",
  lake: "dirt",
  conifer: "leaves",
  mixed: "leaves",
  olive: "grass",
}

/** The roads' OSM `surface` values (surface.ts's table). */
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

/** The old lookups over `map` whole: the ground model over the whole map's roads and platforms (`wholeGround`), the surface and the water as they were. */
export const oracle = (map: JoinedMap) => {
  const hm = map.heightmap,
    { x, y, i: ai, j: aj } = anchorOf(hm)
  const roads = map.roads.map(({ pts, z, cls, w, verge, bridge, tunnel }) => ({
    pts,
    z,
    cls,
    w,
    verge,
    bridge,
    tunnel,
  }))
  const { platformTop, groundZ, deckNear, footZ, roadLevel, atGrade, drawnZ } = wholeGround({
    anchor: { x, y },
    cell: hm.cell,
    // The tiles' nodes one by one (the joined heightmap holds none in an unlisted tile): the game
    // reads a cell's four in one lookup where one tile holds them.
    corners: (fi, fj, out) => {
      for (let k = 0; k < 4; k++)
        out[k] = Math.round(terrainNodeZ(fi + ai + (k & 1), fj + aj + (k >> 1)) * 10)
    },
    roads,
    platforms: map.railway.platforms.map(({ area, axis, top }) => ({
      rings: map.areas[area]!.rings,
      axis,
      top,
    })),
  })
  /** Every 16 m bucket some road reaches into, by key (`../buckets.ts`). */
  const buckets = groundBuckets(roads.map((r, index) => ({ ...r, index }))).lists

  // surface.ts
  const VERGE = 0.5,
    OFF_LEVEL = 1
  const segs: Array<number> = [],
    segRoad: Array<number> = [],
    segZ: Array<number> = []
  map.roads.forEach(({ pts, z: profile }, k) => {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      segs.push(pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!)
      segRoad.push(k)
      segZ.push(profile[i / 2]!, profile[i / 2 + 1]!)
    }
  })
  const roadsNear = staticGrid(
    segRoad.length,
    (i) => {
      const reach = map.roads[segRoad[i]!]!.w / 2 + VERGE
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
  const surfaceAt = (x: number, y: number, level?: number): Surface => {
    let deepest = 0,
      on: Road | undefined
    roadsNear(x, y, x, y, (i) => {
      const r = map.roads[segRoad[i]!]!
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
        Math.abs(segZ[2 * i]! + (segZ[2 * i + 1]! - segZ[2 * i]!) * t - level) > OFF_LEVEL
      )
        return
      const depth = r.w / 2 + VERGE - Math.sqrt(d2)
      if (depth >= deepest) [deepest, on] = [depth, r]
    })
    return on === undefined
      ? COVER_SURFACE[coverAt(x, y)]!
      : (ROAD_SURFACE[on.surface] ?? "asphalt")
  }

  // water/rivers.ts, main's (water-oracle.ts), with its lakes and river polygons
  const ON_BRIDGE = 1,
    water = mainWater(map.water, map.areas)
  const waterAt = water.at
  const waterUnder = (x: number, y: number, inWater: boolean, q: number) =>
    water.under(
      x,
      y,
      () => (inWater ? atGrade(x, y) : (deckNear(x, y, ON_BRIDGE) ?? groundZ(x, y))),
      q,
    )

  return {
    buckets,
    platformTop,
    groundZ,
    deckNear,
    footZ,
    roadLevel,
    atGrade,
    drawnZ,
    surfaceAt,
    waterAt,
    waterUnder,
  }
}
