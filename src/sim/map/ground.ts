/**
 * Where the ground is, in metres a.s.l.: the terrain as the mesh draws it (each 4 m cell split
 * along its south-west to north-east diagonal), station platforms at their tops, at-grade roads
 * floating `ROAD_LIFT` above their profile, and bridge decks and tunnels. Wheels, feet, sound
 * sources and the renderer all read their heights here, so what is drawn and what stands on it agree.
 * The roads come from the tiles (each 16 m bucket of them from the tile holding it, `placeAt`), so
 * the answers are the whole map's whichever tiles are in memory; the platforms from the global file.
 *
 * @module map/ground
 */
import { pointInRing, segDist2 } from "../collide.ts"
import { addToBuckets, bucketItems, type Buckets, emptyBuckets } from "./buckets.ts"
import { MAP, roadClassOf } from "./index.ts"
import { anchorOf, HALO, type RoadClass, vergeOf } from "./kinds.ts"
import { cellCorners, derived, nodeAt, type Place, placeAt } from "./tiles.ts"
import { roadLineAt } from "./vectors.ts"

/**
 * How far each road class's surface floats above its profile (m); wider classes on top, so junctions
 * never z-fight. Primary, secondary and tertiary roads share one: they are the same asphalt. A step
 * of 0.04 m keeps a class's painted lines (0.02 m over it) under the next class's asphalt where a
 * slip road meets a trunk road or a motorway.
 */
export const ROAD_LIFT = {
  motorway: 0.24,
  trunk: 0.2,
  primary: 0.16,
  secondary: 0.16,
  tertiary: 0.16,
  unclassified: 0.14,
  residential: 0.12,
  service: 0.1,
  track: 0.08,
  steps: 0.07,
  path: 0.06,
} as const satisfies Record<RoadClass, number>

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

/** Scratch for the four nodes of a cell. */
const corners = new Int32Array(4)

/**
 * Terrain elevation under (x, y) on the drawn mesh: each cell is split along its south-west to
 * north-east diagonal. The cell is measured from the region's anchor (`anchorOf`).
 */
export const terrainZ = (x: number, y: number): number => {
  const fx = (x - AX) / hm.cell,
    fy = (y - AY) / hm.cell
  const fi = Math.floor(fx),
    fj = Math.floor(fy)
  const u = fx - fi,
    v = fy - fj
  const i = fi + AI,
    j = fj + AJ
  // Every wheel and foot reads here each step: on the grid, its nodes in one lookup where it can;
  // on the apron each node clamps on its own.
  if (i >= 0 && j >= 0 && i < hm.cols - 1 && j < hm.rows - 1) cellCorners(i, j, corners)
  else for (let k = 0; k < 4; k++) corners[k] = clampedNode(i + (k & 1), j + (k >> 1))
  const sw = corners[0]! / 10,
    se = corners[1]! / 10,
    nw = corners[2]! / 10,
    ne = corners[3]! / 10
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

/** Bucket side, m: 125 buckets to a tile's side, so a bucket lies in one tile. */
const BUCKET = 16

/**
 * A place's road segments in 16 m buckets by their carriageway's box, or a bridge's or tunnel's
 * out to its walkers' verges, by road (index into `MAP.roads`) then vertex: a bucket in the place
 * holds what the whole map's buckets held there, in their order.
 */
const segmentsOf = derived((place: Place): Buckets<RoadSegment> => {
  const out = emptyBuckets<RoadSegment>(BUCKET),
    { ids, items } = place.vectors.roads
  for (let n = 0; n < ids.length; n++) {
    const road = MAP.roads[ids[n]!]!,
      { pts, z } = items[n]!
    const lifted = road.bridge === true || road.tunnel === true
    const lift = ROAD_LIFT[roadClassOf(road)],
      verge = Math.max(road.w / 2 + 0.3, (road.verge ?? vergeOf(roadClassOf(road), road.w)) + 0.5)
    for (let k = 0; k + 1 < z.length; k++) {
      const s: RoadSegment = {
        ax: pts[2 * k]!,
        ay: pts[2 * k + 1]!,
        bx: pts[2 * k + 2]!,
        by: pts[2 * k + 3]!,
        za: z[k]!,
        zb: z[k + 1]!,
        half: road.w / 2 + 0.3,
        lift,
        lifted,
        foot: lifted ? verge : 0,
      }
      const reach = Math.max(s.half, s.foot)
      addToBuckets(
        out,
        s,
        Math.min(s.ax, s.bx) - reach,
        Math.min(s.ay, s.by) - reach,
        Math.max(s.ax, s.bx) + reach,
        Math.max(s.ay, s.by) + reach,
      )
    }
  }
  return out
})

/**
 * The road segments reaching into bucket (bx, by) (the one holding (x, y) is (⌊x / 16⌋, ⌊y / 16⌋)), by road then vertex, as the
 * place holding the bucket's centre has them: a box lookup crossing a seam reads each bucket from its own tile.
 */
const segmentsIn = (bx: number, by: number): ReadonlyArray<RoadSegment> =>
  bucketItems(segmentsOf(placeAt(BUCKET * bx + BUCKET / 2, BUCKET * by + BUCKET / 2)), bx, by)

/** A platform's rings, its box and its top along its axis (`Platform` in ./index.ts). */
interface PlatformShape {
  readonly rings: ReadonlyArray<ReadonlyArray<number>>
  readonly box: readonly [number, number, number, number]
  readonly axis: ReadonlyArray<number>
  readonly top: ReadonlyArray<number>
}
/** Every platform in 16 m buckets by its box, in `MAP.railway.platforms` order, from the global file: the trains' look-out reads them anywhere. */
const platforms = emptyBuckets<PlatformShape>(BUCKET)
MAP.railway.platforms.forEach((p, k) => {
  const rings = MAP.derived.platforms[k]!,
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
  addToBuckets(
    platforms,
    { rings, box: [x0, y0, x1, y1], axis: p.axis, top: p.top },
    x0,
    y0,
    x1,
    y1,
  )
})

/**
 * The top of the station platform or rail-level walkway (`MAP.railway.platforms`) at (x, y), m
 * a.s.l.: its top at the nearest point of its axis; undefined off every platform.
 */
export const platformTop = (x: number, y: number): number | undefined => {
  for (const p of bucketItems(platforms, Math.floor(x / BUCKET), Math.floor(y / BUCKET))) {
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
  const segments = segmentsIn(Math.floor(x / BUCKET), Math.floor(y / BUCKET))
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
      for (const s of segmentsIn(bx, by)) {
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
  for (const s of segmentsIn(Math.floor(x / BUCKET), Math.floor(y / BUCKET))) {
    if (s.foot === 0) continue
    const { d2, t } = segDist2(x, y, s.ax, s.ay, s.bx, s.by)
    if (d2 <= s.foot * s.foot) return roadZ(s.za + (s.zb - s.za) * t, x, y, s.lift, true)
  }
  return groundZ(x, y)
}

/**
 * The surface elevation of road `road` (index into `MAP.roads`) at the point of it nearest (x, y), m a.s.l., where (x, y) lies
 * within `HALO` of it: where a vehicle on that road stands, whatever is above or below. Undefined farther off, where nothing
 * stands on it (its line is read from the tile holding (x, y), which holds every road within `HALO` of the point).
 */
export const roadLevel = (road: number, x: number, y: number): number | undefined => {
  const line = roadLineAt(road, x, y)
  if (line === undefined) return undefined
  const info = MAP.roads[road]!,
    { pts, z } = line
  let best = Number.MAX_VALUE,
    level = z[0]!
  for (let k = 0; k + 1 < z.length; k++) {
    const { d2, t } = segDist2(x, y, pts[2 * k]!, pts[2 * k + 1]!, pts[2 * k + 2]!, pts[2 * k + 3]!)
    if (d2 < best) [best, level] = [d2, z[k]! + (z[k + 1]! - z[k]!) * t]
  }
  if (best > HALO * HALO) return undefined
  return roadZ(
    level,
    x,
    y,
    ROAD_LIFT[roadClassOf(info)],
    info.bridge === true || info.tunnel === true,
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
  for (const s of segmentsIn(Math.floor(x / BUCKET), Math.floor(y / BUCKET))) {
    const h = s.lifted ? undefined : onSegment(s, x, y)
    if (h !== undefined && over(h)) top = h
  }
  return top
}
