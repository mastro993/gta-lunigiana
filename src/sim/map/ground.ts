/**
 * Where the ground is, in metres a.s.l.: the terrain as the mesh draws it (each 4 m cell split
 * along its south-west to north-east diagonal), station platforms at their tops, at-grade roads
 * floating `ROAD_LIFT` above their profile, and bridge decks and tunnels. Wheels, feet, sound
 * sources and the renderer all read their heights here, so what is drawn and what stands on it agree.
 *
 * @module map/ground
 */
import { pointInRing, segDist2 } from "../collide.ts"
import { MAP, type Road, roadClassOf } from "./index.ts"
import { type RoadClass, vergeOf } from "./kinds.ts"
import { nodeAt } from "./tiles.ts"

/** How far each road class's surface floats above its profile (m); wider classes on top, so junctions never z-fight. */
export const ROAD_LIFT = {
  tertiary: 0.16,
  unclassified: 0.14,
  residential: 0.12,
  service: 0.1,
  track: 0.08,
  steps: 0.07,
  path: 0.06,
} as const satisfies Record<RoadClass, number>

const hm = MAP.heightmap
/**
 * Terrain node elevation at grid index (i, j), row 0 = south; indices outside the grid clamp to
 * the edge, which is how the apron beyond the map bounds continues the landscape.
 */
export const terrainNodeZ = (i: number, j: number): number =>
  nodeAt(Math.min(hm.cols - 1, Math.max(0, i)), Math.min(hm.rows - 1, Math.max(0, j))) / 10

/** Terrain elevation under (x, y) on the drawn mesh: each cell is split along its south-west to north-east diagonal. */
export const terrainZ = (x: number, y: number): number => {
  const fx = (x - hm.x0) / hm.cell,
    fy = (y - hm.y0) / hm.cell
  const i = Math.floor(fx),
    j = Math.floor(fy)
  const u = fx - i,
    v = fy - j
  const sw = terrainNodeZ(i, j),
    se = terrainNodeZ(i + 1, j),
    nw = terrainNodeZ(i, j + 1),
    ne = terrainNodeZ(i + 1, j + 1)
  return u >= v ? sw + (se - sw) * u + (ne - se) * v : sw + (ne - nw) * u + (nw - sw) * v
}

interface RoadSegment {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
  readonly za: number
  readonly zb: number
  readonly half: number
  readonly lift: number
  /** Bridge or tunnel: the surface is the profile, never the terrain. */
  readonly lifted: boolean
  /** A bridge's or a tunnel's reach either side of its centreline to its walkers' verge (m): within it, someone on foot is on the deck or in the tunnel; 0 for a road at grade. */
  readonly foot: number
}

const BUCKET = 16
const buckets = new Map<number, Array<RoadSegment>>()
/** A bucket's key: distinct for every bucket within ±524 km of the origin (16 m × 32768 each way). */
const keyOf = (bx: number, by: number) => (bx + 32768) * 65536 + by + 32768
for (const road of MAP.roads) {
  const lifted = road.bridge === true || road.tunnel === true
  const lift = ROAD_LIFT[roadClassOf(road)],
    verge = Math.max(road.w / 2 + 0.3, (road.verge ?? vergeOf(roadClassOf(road), road.w)) + 0.5)
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

/** A platform's rings, its box and its top along its axis (`Platform` in ./index.ts). */
interface PlatformShape {
  readonly rings: ReadonlyArray<ReadonlyArray<number>>
  readonly box: readonly [number, number, number, number]
  readonly axis: ReadonlyArray<number>
  readonly top: ReadonlyArray<number>
}
const platformBuckets = new Map<number, Array<PlatformShape>>()
for (const p of MAP.railway.platforms) {
  const rings = MAP.areas[p.area]!.rings,
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

/**
 * The top of the station platform or rail-level walkway (`MAP.railway.platforms`) at (x, y), m
 * a.s.l.: its top at the nearest point of its axis; undefined off every platform.
 */
export const platformTop = (x: number, y: number): number | undefined => {
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

/** Surface elevation of a road whose profile is `z` (m a.s.l.) at (x, y): at-grade roads never dip under the terrain mesh. */
export const roadZ = (z: number, x: number, y: number, lift: number, lifted: boolean): number =>
  (lifted ? z : Math.max(z, terrainZ(x, y))) + lift

/** Surface elevation of segment `s` at (x, y), or undefined when (x, y) lies farther than `reach` m off it. */
const onSegment = (s: RoadSegment, x: number, y: number, reach = s.half): number | undefined => {
  const { d2, t } = segDist2(x, y, s.ax, s.ay, s.bx, s.by)
  return d2 > reach * reach ? undefined : roadZ(s.za + (s.zb - s.za) * t, x, y, s.lift, s.lifted)
}

/** A bridge deck or tunnel within this height (m) of where an actor was is the one it is on. */
export const ON_DECK = 0.5

/**
 * Where an actor at (x, y) stands, m a.s.l. On a platform the ground is its top (`platformTop`), or
 * the terrain where that stands higher (the back of Monzone's north platform rises to the street);
 * elsewhere the terrain. At-grade roads are part of the ground: where several overlap (a junction),
 * their surfaces blend, each weighted by the square of how deep inside its carriageway the point is,
 * so the ground stays continuous where their profiles disagree (by up to a few metres); then the
 * higher of that and the platform or terrain. Bridge decks and tunnels compete with that
 * ground for the one nearest `near`, the actor's previous elevation, so it stays on the level it
 * was on; without `near`, the highest wins. A deck within ON_DECK of `near` wins outright: on a ramp
 * over a gully the ground below can be nearer than the climbing deck, and the actor must not drop
 * onto it. With `verges`, for someone on foot, a deck or a tunnel reaches out to its walkers' verges.
 */
export const groundZ = (x: number, y: number, near?: number, verges = false): number => {
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

/**
 * The highest bridge deck within `pad` m past its edge at (x, y), m a.s.l., or undefined: someone on a bridge's verge (half a
 * metre past its carriageway, as the walkers keep to it) is on the bridge, not on the bank or in the river under it.
 */
export const deckNear = (x: number, y: number, pad: number): number | undefined => {
  let top: number | undefined
  const terrain = terrainZ(x, y)
  // Buckets hold segments by their carriageway's box: look in every bucket the pad reaches.
  for (let bx = Math.floor((x - pad) / BUCKET); bx <= Math.floor((x + pad) / BUCKET); bx++)
    for (let by = Math.floor((y - pad) / BUCKET); by <= Math.floor((y + pad) / BUCKET); by++)
      for (const s of buckets.get(keyOf(bx, by)) ?? []) {
        if (!s.lifted) continue
        const { d2, t } = segDist2(x, y, s.ax, s.ay, s.bx, s.by)
        if (d2 > (s.half + pad) * (s.half + pad)) continue
        const h = roadZ(s.za + (s.zb - s.za) * t, x, y, s.lift, true)
        // A tunnel's floor under the hill is no deck.
        if (h >= terrain && (top === undefined || h > top)) top = h
      }
  return top
}

/**
 * Where someone on foot at (x, y) stands, m a.s.l.: keeping to the level nearest `near`, their last (`groundZ` with the decks and
 * tunnels out to their verges); with no previous height to go by, within a road bridge's or tunnel's reach to its verges, its deck
 * or its floor (people walk the road over or through, not the ground under the deck nor the bank over the tunnel), else the
 * highest ground there.
 */
export const footZ = (x: number, y: number, near?: number): number => {
  if (near !== undefined) return groundZ(x, y, near, true)
  for (const s of buckets.get(keyOf(Math.floor(x / BUCKET), Math.floor(y / BUCKET))) ?? []) {
    if (s.foot === 0) continue
    const { d2, t } = segDist2(x, y, s.ax, s.ay, s.bx, s.by)
    if (d2 <= s.foot * s.foot) return roadZ(s.za + (s.zb - s.za) * t, x, y, s.lift, true)
  }
  return groundZ(x, y)
}

/** The surface elevation of `road` at the point of it nearest (x, y), m a.s.l.: where a vehicle on that road stands, whatever is above or below. */
export const roadLevel = (road: Road, x: number, y: number): number => {
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
    ROAD_LIFT[roadClassOf(road)],
    road.bridge === true || road.tunnel === true,
  )
}

/** The ground at (x, y) on the level of the terrain there: a road at grade, never a deck above or a tunnel below. */
export const atGrade = (x: number, y: number): number => groundZ(x, y, terrainZ(x, y))

/** How far over a wheel's ground (m) `drawnZ` looks for the surface drawn there: junction and hairpin ribbons stand up to 2.9 m over it. */
const DRAWN_REACH = 3

/**
 * What shows on top over ground `near` at (x, y): the highest at-grade road ribbon as it is drawn (each at its own profile), or the
 * terrain, within DRAWN_REACH over it, where the blended `groundZ` sits under a junction's or a hairpin's higher ribbon; else `near`
 * (a deck, or a tunnel's floor under the hill). Tyre marks lie on it.
 */
export const drawnZ = (x: number, y: number, near: number): number => {
  let top = near
  const over = (h: number) => h > top && h <= near + DRAWN_REACH
  if (over(terrainZ(x, y))) top = terrainZ(x, y)
  for (const s of buckets.get(keyOf(Math.floor(x / BUCKET), Math.floor(y / BUCKET))) ?? []) {
    const h = s.lifted ? undefined : onSegment(s, x, y)
    if (h !== undefined && over(h)) top = h
  }
  return top
}
