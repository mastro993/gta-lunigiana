// The ground, surface and water lookups as they were before the vectors left the global file (issue
// #63): one broad phase over the whole map's roads, platforms, rivers and water areas, built here
// from the map joined back from its tiles (`wholeMap`). ground.map-test.ts holds the tiled lookups
// to them, to the bit.

import type { JoinedMap } from "../../../tools/map-file.ts"
import { pointInRing, segDist2, staticGrid } from "../../collide.ts"
import { coverAt } from "../cover.ts"
import { ON_DECK, ROAD_LIFT, roadZ, terrainZ } from "../ground.ts"
import type { Road } from "../index.ts"
import { isRoadClass, type RoadClass, vergeOf } from "../kinds.ts"
import type { Surface } from "../surface.ts"
import { mainWater } from "./water-oracle.ts"

const classOf = (road: Road): RoadClass => (isRoadClass(road.cls) ? road.cls : "path")

interface RoadSegment {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
  readonly za: number
  readonly zb: number
  readonly half: number
  readonly lift: number
  readonly lifted: boolean
  readonly foot: number
}

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

/** The old lookups over `map` whole. */
export const oracle = (map: JoinedMap) => {
  const BUCKET = 16
  const buckets = new Map<number, Array<RoadSegment>>()
  const keyOf = (bx: number, by: number) => (bx + 32768) * 65536 + by + 32768
  for (const road of map.roads) {
    const lifted = road.bridge === true || road.tunnel === true
    const lift = ROAD_LIFT[classOf(road)],
      verge = Math.max(road.w / 2 + 0.3, (road.verge ?? vergeOf(classOf(road), road.w)) + 0.5)
    for (let k = 0; k + 1 < road.z.length; k++) {
      const s: RoadSegment = {
        ax: road.pts[2 * k]!,
        ay: road.pts[2 * k + 1]!,
        bx: road.pts[2 * k + 2]!,
        by: road.pts[2 * k + 3]!,
        za: road.z[k]!,
        zb: road.z[k + 1]!,
        half: road.w / 2 + 0.3,
        lift,
        lifted,
        foot: lifted ? verge : 0,
      }
      const reach = Math.max(s.half, s.foot)
      const x0 = Math.floor((Math.min(s.ax, s.bx) - reach) / BUCKET),
        x1 = Math.floor((Math.max(s.ax, s.bx) + reach) / BUCKET)
      const y0 = Math.floor((Math.min(s.ay, s.by) - reach) / BUCKET),
        y1 = Math.floor((Math.max(s.ay, s.by) + reach) / BUCKET)
      for (let bx = x0; bx <= x1; bx++)
        for (let by = y0; by <= y1; by++) {
          const list = buckets.get(keyOf(bx, by))
          if (list === undefined) buckets.set(keyOf(bx, by), [s])
          else list.push(s)
        }
    }
  }

  interface PlatformShape {
    readonly rings: ReadonlyArray<ReadonlyArray<number>>
    readonly box: readonly [number, number, number, number]
    readonly axis: ReadonlyArray<number>
    readonly top: ReadonlyArray<number>
  }
  const platformBuckets = new Map<number, Array<PlatformShape>>()
  for (const p of map.railway.platforms) {
    const rings = map.areas[p.area]!.rings,
      outer = rings[0]!
    let x0 = outer[0]!,
      y0 = outer[1]!,
      x1 = x0,
      y1 = y0
    for (let k = 2; k + 1 < outer.length; k += 2)
      [x0, y0, x1, y1] = [
        Math.min(x0, outer[k]!),
        Math.min(y0, outer[k + 1]!),
        Math.max(x1, outer[k]!),
        Math.max(y1, outer[k + 1]!),
      ]
    const shape: PlatformShape = { rings, box: [x0, y0, x1, y1], axis: p.axis, top: p.top }
    for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++)
      for (let by = Math.floor(y0 / BUCKET); by <= Math.floor(y1 / BUCKET); by++) {
        const list = platformBuckets.get(keyOf(bx, by))
        if (list === undefined) platformBuckets.set(keyOf(bx, by), [shape])
        else list.push(shape)
      }
  }

  const platformTop = (x: number, y: number): number | undefined => {
    for (const p of platformBuckets.get(keyOf(Math.floor(x / BUCKET), Math.floor(y / BUCKET))) ??
      []) {
      const [x0, y0, x1, y1] = p.box
      if (x < x0 || x > x1 || y < y0 || y > y1 || !pointInRing(x, y, p.rings[0]!)) continue
      if (p.rings.some((hole, i) => i > 0 && pointInRing(x, y, hole))) continue
      let best = Number.MAX_VALUE,
        top = p.top[0]!
      for (let k = 0; k + 1 < p.top.length; k++) {
        const { d2, t } = segDist2(
          x,
          y,
          p.axis[2 * k]!,
          p.axis[2 * k + 1]!,
          p.axis[2 * k + 2]!,
          p.axis[2 * k + 3]!,
        )
        if (d2 < best) [best, top] = [d2, p.top[k]! + (p.top[k + 1]! - p.top[k]!) * t]
      }
      return top
    }
    return undefined
  }

  const onSegment = (s: RoadSegment, x: number, y: number, reach = s.half): number | undefined => {
    const { d2, t } = segDist2(x, y, s.ax, s.ay, s.bx, s.by)
    return d2 > reach * reach ? undefined : roadZ(s.za + (s.zb - s.za) * t, x, y, s.lift, s.lifted)
  }

  const groundZ = (x: number, y: number, near?: number, verges = false): number => {
    const segments = buckets.get(keyOf(Math.floor(x / BUCKET), Math.floor(y / BUCKET))) ?? []
    const terrain = terrainZ(x, y)
    let best = Math.max(terrain, platformTop(x, y) ?? terrain),
      sum = 0,
      weights = 0
    for (const s of segments) {
      if (s.lifted) continue
      const { d2, t } = segDist2(x, y, s.ax, s.ay, s.bx, s.by)
      if (d2 > s.half * s.half) continue
      const depth = s.half - Math.sqrt(d2),
        weight = depth * depth + 1e-9
      sum += weight * roadZ(s.za + (s.zb - s.za) * t, x, y, s.lift, false)
      weights += weight
    }
    if (weights > 0) best = Math.max(best, sum / weights)
    let score = near === undefined ? -best : Math.abs(best - near)
    for (const s of segments) {
      if (!s.lifted) continue
      const h = onSegment(s, x, y, verges ? s.foot : s.half)
      if (h === undefined) continue
      const off = near === undefined ? 0 : Math.abs(h - near)
      const sc = near === undefined ? -h : off < ON_DECK ? off - ON_DECK : off
      if (sc < score) [best, score] = [h, sc]
    }
    return best
  }

  const deckNear = (x: number, y: number, pad: number): number | undefined => {
    let top: number | undefined
    const terrain = terrainZ(x, y)
    for (let bx = Math.floor((x - pad) / BUCKET); bx <= Math.floor((x + pad) / BUCKET); bx++)
      for (let by = Math.floor((y - pad) / BUCKET); by <= Math.floor((y + pad) / BUCKET); by++)
        for (const s of buckets.get(keyOf(bx, by)) ?? []) {
          if (!s.lifted) continue
          const { d2, t } = segDist2(x, y, s.ax, s.ay, s.bx, s.by)
          if (d2 > (s.half + pad) * (s.half + pad)) continue
          const h = roadZ(s.za + (s.zb - s.za) * t, x, y, s.lift, true)
          if (h >= terrain && (top === undefined || h > top)) top = h
        }
    return top
  }

  const footZ = (x: number, y: number, near?: number): number => {
    if (near !== undefined) return groundZ(x, y, near, true)
    for (const s of buckets.get(keyOf(Math.floor(x / BUCKET), Math.floor(y / BUCKET))) ?? []) {
      if (s.foot === 0) continue
      const { d2, t } = segDist2(x, y, s.ax, s.ay, s.bx, s.by)
      if (d2 <= s.foot * s.foot) return roadZ(s.za + (s.zb - s.za) * t, x, y, s.lift, true)
    }
    return groundZ(x, y)
  }

  const roadLevel = (index: number, x: number, y: number): number => {
    const road = map.roads[index]!
    let best = Number.MAX_VALUE,
      level = road.z[0]!
    for (let k = 0; k + 1 < road.z.length; k++) {
      const { d2, t } = segDist2(
        x,
        y,
        road.pts[2 * k]!,
        road.pts[2 * k + 1]!,
        road.pts[2 * k + 2]!,
        road.pts[2 * k + 3]!,
      )
      if (d2 < best) [best, level] = [d2, road.z[k]! + (road.z[k + 1]! - road.z[k]!) * t]
    }
    return roadZ(
      level,
      x,
      y,
      ROAD_LIFT[classOf(road)],
      road.bridge === true || road.tunnel === true,
    )
  }

  const atGrade = (x: number, y: number): number => groundZ(x, y, terrainZ(x, y))

  const DRAWN_REACH = 3
  const drawnZ = (x: number, y: number, near: number): number => {
    let top = near
    const over = (h: number) => h > top && h <= near + DRAWN_REACH
    if (over(terrainZ(x, y))) top = terrainZ(x, y)
    for (const s of buckets.get(keyOf(Math.floor(x / BUCKET), Math.floor(y / BUCKET))) ?? []) {
      const h = s.lifted ? undefined : onSegment(s, x, y)
      if (h !== undefined && over(h)) top = h
    }
    return top
  }

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
