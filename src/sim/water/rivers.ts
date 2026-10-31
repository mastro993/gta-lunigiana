/**
 * The water at a point: which reach of which river or stream is there, how high its surface
 * stands at the discharge the catchment gives, and how fast and which way it flows. A reach holds
 * water out to its gravel bed's half-width (`Water.bed`; a narrow stream's 3 m), where the map build
 * carves its bank; across that the surface is level, downstream it runs from the depth and speed of `channelOf`
 * between its two vertices. The current runs down the reach, slower where the water is shallower
 * (Manning's speed with depth, `DEPTH_SPEED`); it is zero where the water meets the bank. The
 * rivers come from the tile holding the point (`placeAt`), which holds every one whose bed reaches it.
 *
 * @module water/rivers
 */
import { Ops } from "@typeonce/ritmo-math"

import { walkBy } from "../body.ts"
import { segDist2 } from "../collide.ts"
import { addToBuckets, bucketItems, type Buckets, emptyBuckets } from "../map/buckets.ts"
import { atGrade, deckNear, groundZ } from "../map/ground.ts"
import { derived, type Place, placeAt } from "../map/tiles.ts"
import { channelOf, reachOf, SPEED, STAGE } from "./channel.ts"

/** One straight reach between two vertices of a water piece, with what its two ends carry. */
interface Reach {
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

/** Speed grows with depth as Jarrett's Manning does (R^0.83): the shallows at the edge flow slower than the middle. */
const DEPTH_SPEED = 2 / 3 + 0.16
/** At most this many times the mean depth counts toward the speed (a pothole is no faster). */
const DEEPEST = 1.5

/** Bucket side of the reaches' broad phase, m. */
const CELL = 32

/**
 * A place's reaches in 32 m buckets by their beds' boxes: every water piece the tile holds (whole,
 * so its channel is the whole piece's), by piece then vertex, as the whole map's broad phase visited
 * a point's candidates; a zero-length reach holds none. Built on a place's first use.
 */
const reachesOf = derived((place: Place): Buckets<Reach> => {
  const out = emptyBuckets<Reach>(CELL)
  for (const water of place.vectors.water.items) {
    const ch = channelOf(water),
      { pts } = water,
      reach = reachOf(water)
    for (let i = 0; i + 1 < pts.length / 2; i++) {
      const ax = pts[2 * i]!,
        ay = pts[2 * i + 1]!,
        bx = pts[2 * i + 2]!,
        by = pts[2 * i + 3]!,
        length = Ops.hypot(bx - ax, by - ay)
      if (length <= 0) continue
      addToBuckets(
        out,
        {
          ax,
          ay,
          bx,
          by,
          ux: (bx - ax) / length,
          uy: (by - ay) / length,
          reach,
          bedA: ch.bed[i]!,
          bedB: ch.bed[i + 1]!,
          stageA: ch.stage[i]!,
          stageB: ch.stage[i + 1]!,
          speedA: ch.speed[i]!,
          speedB: ch.speed[i + 1]!,
        },
        Math.min(ax, bx) - reach,
        Math.min(ay, by) - reach,
        Math.max(ax, bx) + reach,
        Math.max(ay, by) + reach,
      )
    }
  }
  return out
})

/**
 * The water where a body stands: its depth there (m), the surface's height (m a.s.l.), the current (m/s, world frame), and the
 * way across to the nearer bank (a unit vector, square to the reach).
 */
export interface WaterHere {
  readonly depth: number
  readonly level: number
  readonly vx: number
  readonly vy: number
  readonly bankX: number
  readonly bankY: number
}

/** A reach and a point's place along it (0…1). */
interface Hit {
  readonly reach: Reach
  readonly t: number
}

/**
 * The nearest reach holding water at (x, y), within its bed, and where along it (0…1); undefined where none does. Of equally near
 * ones, the first in the whole map's order (by piece, then vertex).
 */
const reachAt = (x: number, y: number): Hit | undefined => {
  const near = reachesOf(placeAt(x, y))
  let nearest: Reach | undefined,
    nearestD2 = Number.MAX_VALUE,
    nearestT = 0
  for (const r of bucketItems(near, Math.floor(x / CELL), Math.floor(y / CELL))) {
    const { d2, t } = segDist2(x, y, r.ax, r.ay, r.bx, r.by)
    if (d2 <= r.reach * r.reach && d2 < nearestD2) [nearest, nearestD2, nearestT] = [r, d2, t]
  }
  return nearest === undefined ? undefined : { reach: nearest, t: nearestT }
}

/** The water of reach `hit` at (x, y) over a floor at `floor` m a.s.l. at `q` m³/s per km²; undefined where the floor is above it. */
const waterOf = (
  x: number,
  y: number,
  hit: Hit,
  floor: number,
  q: number,
): WaterHere | undefined => {
  const r = hit.reach,
    t = hit.t
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
  // Square to the reach, toward the side the point is on (the left bank from the very middle).
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
 * The water at (x, y) over a floor at `floor` m a.s.l. (the ground a body stands on, or a car's
 * underbody) at `q` m³/s per km² of catchment (`specificDischarge`), from the nearest reach that
 * holds water there (at a confluence, the one the point is on); undefined where none does (dry
 * ground, or a deck or bank above the surface).
 */
export const waterAt = (x: number, y: number, floor: number, q: number): WaterHere | undefined => {
  const hit = reachAt(x, y)
  return hit === undefined ? undefined : waterOf(x, y, hit, floor, q)
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
): WaterHere | undefined => {
  const hit = reachAt(x, y)
  if (hit === undefined) return undefined
  const floor = inWater ? atGrade(x, y) : (deckNear(x, y, ON_BRIDGE) ?? groundZ(x, y))
  return waterOf(x, y, hit, floor, q)
}

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
