// The water lookups as main had them before the vectors left the global file (issue #63), lakes
// and river polygons included (#73): one broad phase over the whole map's rivers and water areas,
// verbatim but for the sea's rules since (#13: still water's cuts are no shore, the sea's pieces
// share their coast, every piece's here, less its closures across a river's or a lake's mouth,
// and no river stands under the sea), which
// ground.map-test.ts holds the tiled `waterAt` and `waterUnder` to, to the bit, over the map joined
// back from its tiles (`wholeMap`).
import { Ops } from "@typeonce/ritmo-math"

import { pointInRing, segDist2, staticGrid } from "../../collide.ts"
import { channelOf, reachOf, SEA_LEVEL, SPEED, STAGE } from "../../water/channel.ts"
import { type Area, isWaterArea, MAP, TILE, type Water } from "../index.ts"

/** One straight reach between two vertices of a water piece, with what its two ends carry. */
interface Reach {
  /** The piece's index in the water. */
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

/** A lake, a sea piece or a river polygon: its rings, and still water's level and banks or the reaches of its waterways. */
interface Pool {
  readonly rings: ReadonlyArray<ReadonlyArray<number>>
  /** The box of its outer ring: minX, minY, maxX, maxY. */
  readonly box: readonly [number, number, number, number]
  /** Still water's level, m a.s.l. */
  readonly level?: number
  /** Still water's banks, flat (ax, ay, ex, ey) each: its shore, every sea piece's coast for the sea, else all its edges. */
  readonly banks: ReadonlyArray<number>
  /** A river polygon's reaches (indices), when it has no `level`. */
  readonly reaches: ReadonlySet<number>
}

/** Speed grows with depth as Jarrett's Manning does (R^0.83): the shallows at the edge flow slower than the middle. */
const DEPTH_SPEED = 2 / 3 + 0.16
/** At most this many times the mean depth counts toward the speed (a pothole is no faster). */
const DEEPEST = 1.5
/** The first box a river polygon's nearest reach is looked for in, m round the point; doubled until it holds one. */
const LOOK = 32

/**
 * The water where a body stands: its depth there (m), the surface's height (m a.s.l.), the current (m/s, world frame), and the
 * way across to the nearer bank (a unit vector, square to the reach; toward the nearest shore in a lake).
 */
interface WaterHere {
  readonly depth: number
  readonly level: number
  readonly vx: number
  readonly vy: number
  readonly bankX: number
  readonly bankY: number
}

/** A water area's surface at a point whatever the flow: the bed, how far it rises per unit stage, and its flow (a unit vector downstream and the mean speed per unit), as a river's ribbon carries them. */
interface PoolSurface {
  readonly bed: number
  readonly stage: number
  readonly ux: number
  readonly uy: number
  readonly speed: number
}

/** Where along which reach a point's water comes from (-1: a lake's), and the water area it lies in. */
interface Hit {
  readonly i: number
  readonly t: number
  readonly pool: Pool | undefined
}

/** Whether (x, y) is inside `rings`, even-odd over them all (a hole's inside is outside), as the land cover fills them. */
const inRings = (rings: ReadonlyArray<ReadonlyArray<number>>, x: number, y: number): boolean => {
  let inside = false
  for (const ring of rings) if (pointInRing(x, y, ring)) inside = !inside
  return inside
}

/** Whether `v` lies within 0.05 m of a tile's side or of bound `low` or `high`. */
const onCut = (v: number, low: number, high: number): boolean =>
  Math.abs(v - Math.round(v / TILE) * TILE) < 0.05 ||
  Math.abs(v - low) < 0.05 ||
  Math.abs(v - high) < 0.05

/** The edges of `rings`, flat (ax, ay, ex, ey) each: all of them, and those no cut along a tile's side or the bounds. */
const edgesOf = (rings: ReadonlyArray<ReadonlyArray<number>>) => {
  const { minX, minY, maxX, maxY } = MAP.bounds,
    all: Array<number> = [],
    shore: Array<number> = []
  for (const ring of rings)
    for (let k = 0, n = ring.length; k < n; k += 2) {
      const ax = ring[k]!,
        ay = ring[k + 1]!,
        ex = ring[(k + 2) % n]! - ax,
        ey = ring[(k + 3) % n]! - ay
      all.push(ax, ay, ex, ey)
      const cut =
        (Math.abs(ex) < 0.05 && onCut(ax, minX, maxX)) ||
        (Math.abs(ey) < 0.05 && onCut(ay, minY, maxY))
      if (!cut) shore.push(ax, ay, ex, ey)
    }
  return { all, shore }
}

/**
 * The water of `water` (its rivers and streams) and of the water areas of `areas`, as lookups at a
 * point: the game's are over the map's (`waterAt`, `waterUnder`), a test's over its own.
 */
export const mainWater = (water: ReadonlyArray<Water>, areas: ReadonlyArray<Area>) => {
  const reaches: ReadonlyArray<Reach> = water.flatMap((w, piece) => {
    const ch = channelOf(w),
      { pts } = w,
      out: Array<Reach> = []
    for (let i = 0; i + 1 < pts.length / 2; i++) {
      const ax = pts[2 * i]!,
        ay = pts[2 * i + 1]!,
        bx = pts[2 * i + 2]!,
        by = pts[2 * i + 3]!,
        length = Ops.hypot(bx - ax, by - ay)
      if (length <= 0) continue
      out.push({
        piece,
        ax,
        ay,
        bx,
        by,
        ux: (bx - ax) / length,
        uy: (by - ay) / length,
        reach: reachOf(w),
        bedA: ch.bed[i]!,
        bedB: ch.bed[i + 1]!,
        stageA: ch.stage[i]!,
        stageB: ch.stage[i + 1]!,
        speedA: ch.speed[i]!,
        speedB: ch.speed[i + 1]!,
      })
    }
    return out
  })
  const near = staticGrid(
    reaches.length,
    (i) => {
      const r = reaches[i]!
      return [
        Math.min(r.ax, r.bx) - r.reach,
        Math.min(r.ay, r.by) - r.reach,
        Math.max(r.ax, r.bx) + r.reach,
        Math.max(r.ay, r.by) + r.reach,
      ]
    },
    32,
  )
  // The lakes first: where a stream runs through one, the water is the lake's.
  const inland = areas.filter((a) => a.kind === "river" || a.kind === "lake")
  // A sea edge with a river or a lake half a metre off its middle on its land side (its right)
  // closes that water across its mouth: no coast.
  const closes = (ax: number, ay: number, ex: number, ey: number) => {
    const length = Math.sqrt(ex * ex + ey * ey),
      x = ax + ex / 2 + (ey / length) * 0.5,
      y = ay + ey / 2 - (ex / length) * 0.5
    return inland.some((a) => inRings(a.rings, x, y))
  }
  const coast = areas.flatMap((a) => {
    if (a.kind !== "sea" || a.level === undefined) return []
    const { shore } = edgesOf(a.rings),
      out: Array<number> = []
    for (let k = 0; k < shore.length; k += 4) {
      const edge = shore.slice(k, k + 4) as [number, number, number, number]
      if (!closes(...edge)) out.push(...edge)
    }
    return out
  })
  const pools: ReadonlyArray<Pool> = areas
    .filter((a) => isWaterArea(a.kind) && (a.level !== undefined || a.waters !== undefined))
    .map((a): Pool => {
      const edges = edgesOf(a.rings),
        shore = a.kind === "sea" ? coast : edges.shore
      const ring = a.rings[0]!
      let minX = Number.MAX_VALUE,
        minY = Number.MAX_VALUE,
        maxX = -Number.MAX_VALUE,
        maxY = -Number.MAX_VALUE
      for (let k = 0; k < ring.length; k += 2) {
        minX = Math.min(minX, ring[k]!)
        maxX = Math.max(maxX, ring[k]!)
        minY = Math.min(minY, ring[k + 1]!)
        maxY = Math.max(maxY, ring[k + 1]!)
      }
      const own = new Set(a.waters ?? [])
      return {
        rings: a.rings,
        box: [minX, minY, maxX, maxY],
        ...(a.level === undefined ? {} : { level: a.level }),
        banks: a.level === undefined ? [] : shore.length > 0 ? shore : edges.all,
        reaches: new Set(
          a.level === undefined ? reaches.flatMap((r, i) => (own.has(r.piece) ? [i] : [])) : [],
        ),
      }
    })
    .sort((a, b) => (a.level === undefined ? 1 : 0) - (b.level === undefined ? 1 : 0))
  const poolNear = staticGrid(pools.length, (i) => pools[i]!.box, 64)

  /** The water area (x, y) lies in, a lake before a river polygon; undefined outside them all. */
  const poolAt = (x: number, y: number): Pool | undefined => {
    let found = -1
    poolNear(x, y, x, y, (i) => {
      if ((found < 0 || i < found) && inRings(pools[i]!.rings, x, y)) found = i
    })
    return found < 0 ? undefined : pools[found]
  }

  /** The nearest reach of a river polygon's own waterways, however far: the first found on a tie. */
  const nearestOf = (pool: Pool, x: number, y: number): Hit => {
    const own = pool.reaches
    let best = -1,
      bestD2 = Number.MAX_VALUE,
      bestT = 0
    // A box `look` m round the point holds every reach within `look` m of it.
    for (let look = LOOK; ; look *= 2) {
      near(x - look, y - look, x + look, y + look, (i) => {
        if (!own.has(i)) return
        const r = reaches[i]!,
          { d2, t } = segDist2(x, y, r.ax, r.ay, r.bx, r.by)
        if (d2 < bestD2 || (d2 === bestD2 && i < best)) [best, bestD2, bestT] = [i, d2, t]
      })
      if ((best >= 0 && look * look >= bestD2) || look > 1e6) break
    }
    return { i: best, t: bestT, pool }
  }

  /** The water a point takes: its lake's, its river polygon's, or the nearest reach holding water there. */
  const hitAt = (x: number, y: number): Hit | undefined => {
    const pool = poolAt(x, y)
    if (pool?.level !== undefined) return { i: -1, t: 0, pool }
    if (pool !== undefined && pool.reaches.size > 0) return nearestOf(pool, x, y)
    let nearest = -1,
      nearestD2 = Number.MAX_VALUE,
      nearestT = 0
    near(x, y, x, y, (i) => {
      const r = reaches[i]!,
        { d2, t } = segDist2(x, y, r.ax, r.ay, r.bx, r.by)
      if (d2 <= r.reach * r.reach && d2 < nearestD2) [nearest, nearestD2, nearestT] = [i, d2, t]
    })
    return nearest < 0 ? undefined : { i: nearest, t: nearestT, pool: undefined }
  }

  /** The unit vector from (x, y) toward the nearest of still water's banks (an island's too). */
  const shoreward = (pool: Pool, x: number, y: number): readonly [number, number] => {
    let bx = 1,
      by = 0,
      best = Number.MAX_VALUE
    const { banks } = pool
    for (let k = 0; k < banks.length; k += 4) {
      const ax = banks[k]!,
        ay = banks[k + 1]!,
        ex = banks[k + 2]!,
        ey = banks[k + 3]!
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
    const { pool } = hit
    if (hit.i < 0) {
      const level = pool!.level!,
        depth = level - floor
      if (depth <= 0) return undefined
      const [bankX, bankY] = shoreward(pool!, x, y)
      return { depth, level, vx: 0, vy: 0, bankX, bankY }
    }
    const r = reaches[hit.i]!,
      t = hit.t
    const mean = (r.stageA + (r.stageB - r.stageA) * t) * (q > 0 ? Ops.pow(q, STAGE) : 0),
      bed = r.bedA + (r.bedB - r.bedA) * t,
      flowing = bed + mean,
      // No river stands under the sea, which holds it up: the same flow, slower through the deeper water.
      level = Math.max(flowing, SEA_LEVEL),
      held = flowing < SEA_LEVEL ? level - bed : mean,
      depth = level - floor
    if (depth <= 0) return undefined
    const along =
      mean > 0
        ? (r.speedA + (r.speedB - r.speedA) * t) *
          Ops.pow(q, SPEED) *
          (mean / held) *
          Ops.pow(Math.min(DEEPEST, depth / held), DEPTH_SPEED)
        : 0
    // Square to the reach, toward the side the point is on (the left bank from the very middle),
    // in a river polygon too: an edge of its own may be another polygon's of the same river.
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

  return {
    /** The lakes and river polygons, lakes first. */
    pools,
    /**
     * The water at (x, y) over a floor at `floor` m a.s.l. (the ground a body stands on, or a car's
     * underbody) at `q` m³/s per km² of catchment (`specificDischarge`): a lake's, a river polygon's,
     * or the nearest reach's that holds water there (at a confluence, the one the point is on);
     * undefined where none does (dry ground, or a deck or bank above the surface).
     */
    at: (x: number, y: number, floor: number, q: number): WaterHere | undefined => {
      const hit = hitAt(x, y)
      return hit === undefined ? undefined : waterOf(x, y, hit, floor, q)
    },
    /** As `at`, with the floor read only where there is water: `floor()` reads the tiles. */
    under: (x: number, y: number, floor: () => number, q: number): WaterHere | undefined => {
      const hit = hitAt(x, y)
      return hit === undefined ? undefined : waterOf(x, y, hit, floor(), q)
    },
    /** `pool`'s surface at (x, y) whatever the flow: its level, or its nearest waterway's bed, stage and flow there. */
    surface: (pool: Pool, x: number, y: number): PoolSurface => {
      if (pool.level !== undefined) return { bed: pool.level, stage: 0, ux: 1, uy: 0, speed: 0 }
      const { i, t } = nearestOf(pool, x, y),
        r = reaches[i]!
      return {
        bed: r.bedA + (r.bedB - r.bedA) * t,
        stage: r.stageA + (r.stageB - r.stageA) * t,
        ux: r.ux,
        uy: r.uy,
        speed: r.speedA + (r.speedB - r.speedA) * t,
      }
    },
  }
}
