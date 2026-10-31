/**
 * The water at a point: which reach of which river or stream is there, or which lake, how high its
 * surface stands at the discharge the catchment gives, and how fast and which way it flows. A reach
 * holds water out to its gravel bed's half-width (`Water.bed`; a narrow stream's 3 m), where the map
 * build carves its bank; across that the surface is level, downstream it runs from the depth and
 * speed of `channelOf` between its two vertices. A river polygon (`Area.waters`) widens its
 * waterways' beds to its outline: anywhere in it the water is that of the nearest reach of its own
 * waterways. A lake (`Area.level`) stands still at its level. The current runs down the reach,
 * slower where the water is shallower (Manning's speed with depth, `DEPTH_SPEED`); it is zero where
 * the water meets the bank, and in a lake. The water comes from the tile holding the point
 * (`placeAt`), which holds every river whose bed reaches it, every water area over it, and each of
 * those areas' waterways (src/tools/tile-vectors.ts).
 *
 * @module water/rivers
 */
import { Ops } from "@typeonce/ritmo-math"

import { walkBy } from "../body.ts"
import { pointInRing, segDist2 } from "../collide.ts"
import { addToBuckets, bucketItems, emptyBuckets } from "../map/buckets.ts"
import { atGrade, deckNear, groundZ } from "../map/ground.ts"
import { type Area, isWaterArea, type Water } from "../map/index.ts"
import type { Layer } from "../map/packed.ts"
import { derived, eachTile, type Place, placeAt } from "../map/tiles.ts"
import { channelOf, reachOf, SPEED, STAGE } from "./channel.ts"

/** One straight reach between two vertices of a water piece, with what its two ends carry. */
interface Reach {
  /** The piece's index in the whole map's water. */
  readonly piece: number
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
  /** Unit vector downstream. */
  readonly ux: number
  readonly uy: number
  /** How far across (m) it holds water: the bed's half-width. */
  readonly reach: number
  readonly bedA: number
  readonly bedB: number
  readonly stageA: number
  readonly stageB: number
  readonly speedA: number
  readonly speedB: number
}

/** A water area's surface at a point whatever the flow: the bed, how far it rises per unit stage, and its flow (a unit vector downstream and the mean speed per unit), as a river's ribbon carries them. */
interface PoolSurface {
  readonly bed: number
  readonly stage: number
  readonly ux: number
  readonly uy: number
  readonly speed: number
}

/** A lake or a river polygon: its index in the whole map's areas, its rings, and still water's level or the reaches of its waterways. */
interface Pool {
  readonly id: number
  readonly rings: ReadonlyArray<ReadonlyArray<number>>
  /** The box of its outer ring: minX, minY, maxX, maxY. */
  readonly box: readonly [number, number, number, number]
  /** Still water's level, m a.s.l. */
  readonly level?: number
  /** A river polygon's reaches, by piece then vertex, when it has no `level`. */
  readonly reaches: ReadonlyArray<Reach>
  /** Its surface at (x, y) whatever the flow: its level, or its nearest waterway's bed, stage and flow there. */
  readonly surface: (x: number, y: number) => PoolSurface
}

/** Speed grows with depth as Jarrett's Manning does (R^0.83): the shallows at the edge flow slower than the middle. */
const DEPTH_SPEED = 2 / 3 + 0.16
/** At most this many times the mean depth counts toward the speed (a pothole is no faster). */
const DEEPEST = 1.5
/** Bucket side of the reaches' broad phase, m. */
const CELL = 32

/**
 * The water where a body stands: its depth there (m), the surface's height (m a.s.l.), the current (m/s, world frame), and the
 * way across to the nearer bank (a unit vector, square to the reach; toward the nearest shore in a lake).
 */
export interface WaterHere {
  readonly depth: number
  readonly level: number
  readonly vx: number
  readonly vy: number
  readonly bankX: number
  readonly bankY: number
}

/** Where along which reach a point's water comes from (none: a lake's), and the water area it lies in. */
interface Hit {
  readonly reach: Reach | undefined
  readonly t: number
  readonly pool: Pool | undefined
}

/** Whether (x, y) is inside `rings`, even-odd over them all (a hole's inside is outside), as the land cover fills them. */
const inRings = (rings: ReadonlyArray<ReadonlyArray<number>>, x: number, y: number): boolean => {
  let inside = false
  for (const ring of rings) if (pointInRing(x, y, ring)) inside = !inside
  return inside
}

/** `items` as a layer, each its own index: the whole map's lists, as a test hands them. */
const whole = <T>(items: ReadonlyArray<T> | Layer<T>): Layer<T> =>
  "ids" in items ? items : { ids: items.map((_, k) => k), items }

/** The nearest reach of `own` (by piece then vertex) to (x, y), however far, and where along it: the first on a tie. */
const nearestOf = (own: ReadonlyArray<Reach>, x: number, y: number) => {
  let best = own[0]!,
    bestD2 = Number.MAX_VALUE,
    bestT = 0
  for (const r of own) {
    const { d2, t } = segDist2(x, y, r.ax, r.ay, r.bx, r.by)
    if (d2 < bestD2) [best, bestD2, bestT] = [r, d2, t]
  }
  return { reach: best, t: bestT }
}

/** The reaches of `w`'s pieces, by piece then vertex (a zero-length one holds none). */
const reachesOf = (w: Layer<Water>): Array<Reach> => {
  const out: Array<Reach> = []
  w.items.forEach((piece, k) => {
    const ch = channelOf(piece),
      { pts } = piece
    for (let i = 0; i + 1 < pts.length / 2; i++) {
      const ax = pts[2 * i]!,
        ay = pts[2 * i + 1]!,
        bx = pts[2 * i + 2]!,
        by = pts[2 * i + 3]!,
        length = Ops.hypot(bx - ax, by - ay)
      if (length <= 0) continue
      out.push({
        piece: w.ids[k]!,
        ax,
        ay,
        bx,
        by,
        ux: (bx - ax) / length,
        uy: (by - ay) / length,
        reach: reachOf(piece),
        bedA: ch.bed[i]!,
        bedB: ch.bed[i + 1]!,
        stageA: ch.stage[i]!,
        stageB: ch.stage[i + 1]!,
        speedA: ch.speed[i]!,
        speedB: ch.speed[i + 1]!,
      })
    }
  })
  return out
}

/** The lakes and river polygons of `a`, lakes first, each kind by index, with their waterways' reaches among `reaches`. */
const poolsOf = (a: Layer<Area>, reaches: ReadonlyArray<Reach>): Array<Pool> =>
  a.items
    .flatMap((area, k): Array<Pool> => {
      if (!isWaterArea(area.kind) || (area.level === undefined && area.waters === undefined))
        return []
      const ring = area.rings[0]!
      let minX = Number.MAX_VALUE,
        minY = Number.MAX_VALUE,
        maxX = -Number.MAX_VALUE,
        maxY = -Number.MAX_VALUE
      for (let n = 0; n < ring.length; n += 2) {
        minX = Math.min(minX, ring[n]!)
        maxX = Math.max(maxX, ring[n]!)
        minY = Math.min(minY, ring[n + 1]!)
        maxY = Math.max(maxY, ring[n + 1]!)
      }
      const own = new Set(area.waters ?? []),
        { level } = area
      const ownReaches = level === undefined ? reaches.filter((r) => own.has(r.piece)) : []
      return [
        {
          id: a.ids[k]!,
          rings: area.rings,
          box: [minX, minY, maxX, maxY],
          ...(level === undefined ? {} : { level }),
          reaches: ownReaches,
          surface: (x, y) => {
            if (level !== undefined) return { bed: level, stage: 0, ux: 1, uy: 0, speed: 0 }
            const { reach: r, t } = nearestOf(ownReaches, x, y)
            return {
              bed: r.bedA + (r.bedB - r.bedA) * t,
              stage: r.stageA + (r.stageB - r.stageA) * t,
              ux: r.ux,
              uy: r.uy,
              speed: r.speedA + (r.speedB - r.speedA) * t,
            }
          },
        },
      ]
    })
    .sort((p, q) => (p.level === undefined ? 1 : 0) - (q.level === undefined ? 1 : 0))

/** The unit vector from (x, y) toward the nearest edge of a lake's rings (an island's too). */
const shoreward = (pool: Pool, x: number, y: number): readonly [number, number] => {
  let bx = 1,
    by = 0,
    best = Number.MAX_VALUE
  for (const ring of pool.rings)
    for (let k = 0, n = ring.length; k < n; k += 2) {
      const ax = ring[k]!,
        ay = ring[k + 1]!,
        ex = ring[(k + 2) % n]! - ax,
        ey = ring[(k + 3) % n]! - ay
      const { d2, t } = segDist2(x, y, ax, ay, ax + ex, ay + ey)
      if (d2 >= best || d2 <= 0) continue
      const d = Math.sqrt(d2)
      ;[best, bx, by] = [d2, (ax + ex * t - x) / d, (ay + ey * t - y) / d]
    }
  return [bx, by]
}

/** The water of `hit` at (x, y) over a floor at `floor` m a.s.l. at `q` m³/s per km²; undefined where the floor is above it. */
const waterOf = (
  x: number,
  y: number,
  hit: Hit,
  floor: number,
  q: number,
): WaterHere | undefined => {
  const { pool, reach: r, t } = hit
  if (r === undefined) {
    const level = pool!.level!,
      depth = level - floor
    if (depth <= 0) return undefined
    const [bankX, bankY] = shoreward(pool!, x, y)
    return { depth, level, vx: 0, vy: 0, bankX, bankY }
  }
  const mean = (r.stageA + (r.stageB - r.stageA) * t) * (q > 0 ? Ops.pow(q, STAGE) : 0),
    level = r.bedA + (r.bedB - r.bedA) * t + mean,
    depth = level - floor
  if (depth <= 0) return undefined
  const along =
    mean > 0
      ? (r.speedA + (r.speedB - r.speedA) * t) *
        Ops.pow(q, SPEED) *
        Ops.pow(Math.min(DEEPEST, depth / mean), DEPTH_SPEED)
      : 0
  // Square to the reach, toward the side the point is on (the left bank from the very middle), in a
  // river polygon too: an edge of its own may be another polygon's of the same river.
  const side = (x - r.ax) * -r.uy + (y - r.ay) * r.ux >= 0 ? 1 : -1
  return {
    depth,
    level,
    vx: r.ux * along,
    vy: r.uy * along,
    bankX: -r.uy * side,
    bankY: r.ux * side,
  }
}

/**
 * The water of `water` (rivers and streams) and of the water areas of `areas`, each with its index
 * in the whole map's list (ascending; a plain list, a test's or the whole map's, counts from 0), as
 * lookups at a point: the game's over a tile's (`waterAt`, `waterUnder`), a test's over its own.
 */
export const waterIndex = (
  water: Layer<Water> | ReadonlyArray<Water>,
  areas: Layer<Area> | ReadonlyArray<Area>,
) => {
  const reaches = reachesOf(whole(water)),
    near = emptyBuckets<Reach>(CELL)
  for (const r of reaches)
    addToBuckets(
      near,
      r,
      Math.min(r.ax, r.bx) - r.reach,
      Math.min(r.ay, r.by) - r.reach,
      Math.max(r.ax, r.bx) + r.reach,
      Math.max(r.ay, r.by) + r.reach,
    )
  // The lakes first: where a stream runs through one, the water is the lake's.
  const pools = poolsOf(whole(areas), reaches)

  /** The water a point takes: its lake's, its river polygon's, or the nearest reach holding water there. */
  const hitAt = (x: number, y: number): Hit | undefined => {
    const pool = pools.find(
      ({ box, rings }) =>
        x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3] && inRings(rings, x, y),
    )
    if (pool?.level !== undefined) return { reach: undefined, t: 0, pool }
    if (pool !== undefined && pool.reaches.length > 0)
      return { ...nearestOf(pool.reaches, x, y), pool }
    let nearest: Reach | undefined,
      nearestD2 = Number.MAX_VALUE,
      nearestT = 0
    for (const r of bucketItems(near, Math.floor(x / CELL), Math.floor(y / CELL))) {
      const { d2, t } = segDist2(x, y, r.ax, r.ay, r.bx, r.by)
      if (d2 <= r.reach * r.reach && d2 < nearestD2) [nearest, nearestD2, nearestT] = [r, d2, t]
    }
    return nearest === undefined ? undefined : { reach: nearest, t: nearestT, pool: undefined }
  }

  return {
    /** The lakes and river polygons, lakes first, each kind by index. */
    pools,
    /** The water at (x, y) over a floor at `floor` m a.s.l. at `q` m³/s per km² (`waterAt`). */
    at: (x: number, y: number, floor: number, q: number): WaterHere | undefined => {
      const hit = hitAt(x, y)
      return hit === undefined ? undefined : waterOf(x, y, hit, floor, q)
    },
    /** As `at`, with the floor read only where there is water: `floor()` reads the tiles. */
    under: (x: number, y: number, floor: () => number, q: number): WaterHere | undefined => {
      const hit = hitAt(x, y)
      return hit === undefined ? undefined : waterOf(x, y, hit, floor(), q)
    },
  }
}

/** Each place's water, built on its first use from the water and the areas it holds. */
const placeWater = derived((place: Place) => waterIndex(place.vectors.water, place.vectors.areas))

/**
 * The water at (x, y) over a floor at `floor` m a.s.l. (the ground a body stands on, or a car's
 * underbody) at `q` m³/s per km² of catchment (`specificDischarge`): a lake's, a river polygon's, or
 * the nearest reach's that holds water there (at a confluence, the one the point is on); undefined
 * where none does (dry ground, or a deck or bank above the surface).
 */
export const waterAt = (x: number, y: number, floor: number, q: number): WaterHere | undefined =>
  placeWater(placeAt(x, y)).at(x, y, floor, q)

/** The lakes and river polygons a lookup at (x, y) reads (the tile holding it holds every one over it), lakes first. */
export const poolsAt = (x: number, y: number): ReadonlyArray<Pool> =>
  placeWater(placeAt(x, y)).pools

/**
 * The lakes and river polygons of the tiles over the box, each once, in the whole map's order
 * (lakes first, each kind by index), each with its surface (`Pool.surface`, the same from any tile
 * that holds it, as such a tile holds its waterways whole): what the render draws in a chunk.
 */
export const poolsIn = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): ReadonlyArray<Pool> => {
  const byId = new Map<number, Pool>()
  eachTile(minX, minY, maxX, maxY, (tile) => {
    for (const pool of placeWater(tile).pools) if (!byId.has(pool.id)) byId.set(pool.id, pool)
  })
  const still = (p: Pool) => (p.level === undefined ? 1 : 0)
  return [...byId.values()].sort((p, q) => still(p) - still(q) || p.id - q.id)
}

/** A body this near a bridge deck's edge is on the bridge, m: a walker on its verge, half a metre past it, and its radius. */
const ON_BRIDGE = 1

/**
 * The water a body at (x, y) stands in at `q` m³/s per km²: one already in the water stands on the
 * ground at the terrain's level, under any bridge; one not in it yet on the highest ground there, a
 * bridge's deck when it is within ON_BRIDGE of it, so a bridge keeps it dry.
 */
export const waterUnder = (
  x: number,
  y: number,
  inWater: boolean,
  q: number,
): WaterHere | undefined =>
  placeWater(placeAt(x, y)).under(
    x,
    y,
    () => (inWater ? atGrade(x, y) : (deckNear(x, y, ON_BRIDGE) ?? groundZ(x, y))),
    q,
  )

/**
 * Moves a person or animal of radius `r` at `at` by `step` at `q` m³/s per km²: one keeping out of
 * the water by choice (`careful`) and still dry takes no step into it, the water's edge where the
 * level stands now, past the shore walls too (a rising river, a stream's gravel bed); one already in
 * the water, or taking no care (fleeing), goes where it is going. Both keep to the walk walls, so
 * one that comes out on a river's bed walks off it.
 */
export const walkDry = (
  at: { readonly x: number; readonly y: number },
  step: { readonly x: number; readonly y: number },
  r: number,
  careful: boolean,
  wet: boolean,
  q: number,
) =>
  careful && !wet && waterUnder(at.x + step.x, at.y + step.y, false, q) !== undefined
    ? walkBy(at, { x: 0, y: 0 }, r)
    : walkBy(at, step, r)
