/**
 * What stands between a sound and the listener: the Maekawa path difference δ over the highest
 * obstacle on the straight path, from building walls (up to the eaves, `z0 + h`) and the terrain
 * profile (exact where its tiles are in memory, else the coarse grid's: `./ground.ts`). `diffraction`
 * (acoustics.ts) turns δ into a loss and a lowpass. Trees, water banks and the sim's collision walls
 * are not acoustic obstacles here.
 *
 * @module audio/occlusion
 */
import { pointInRing } from "../sim/collide.ts"
import { buildingBoxes, buildingsIn, MAP } from "../sim/map/index.ts"
import { terrainAt } from "./ground.ts"

/** A point in the world frame: x east, y north (m), z elevation a.s.l. (m). */
export interface Point3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** Terrain is sampled every `STEP` m, from `END` m after the start to `END` m before the end (the ground under an endpoint hides nothing). */
const STEP = 7,
  END = 3

/** Whether (x, y) is within building i's walls (not in a courtyard). */
const within = (i: number, x: number, y: number): boolean => {
  const [x0, y0, x1, y1] = buildingBoxes[i]!,
    { outer, holes } = MAP.buildings[i]!
  return (
    x >= x0 &&
    x <= x1 &&
    y >= y0 &&
    y <= y1 &&
    pointInRing(x, y, outer) &&
    !(holes ?? []).some((hole) => pointInRing(x, y, hole))
  )
}

/**
 * The largest Maekawa path difference δ = |ST| + |TR| − |SR| (m) over the edges T that rise above
 * the straight path from `from` to `to`: building walls crossed (exact ring-edge crossings) and
 * terrain samples every 7 m. 0 when the line of sight is clear. Endpoints carry their own height:
 * callers add `EAR_HEIGHT` or the source's height above the ground. A building an endpoint stands
 * in hides nothing from it: a bell at its tower's top rings out over its own walls.
 */
export const pathDifference = (from: Point3, to: Point3): number => {
  const { x: sx, y: sy, z: sz } = from,
    dx = to.x - sx,
    dy = to.y - sy,
    dz = to.z - sz
  const length = Math.hypot(dx, dy),
    direct = Math.hypot(length, dz)
  let worst = 0
  // An edge at height `top`, `t` of the way along: counts only if it rises above the path.
  const edge = (t: number, top: number) => {
    if (top <= sz + dz * t) return
    const a = t * length
    worst = Math.max(worst, Math.hypot(a, top - sz) + Math.hypot(length - a, top - to.z) - direct)
  }
  for (let s = END; s <= length - END; s += STEP)
    edge(s / length, terrainAt(sx + (dx * s) / length, sy + (dy * s) / length))
  if (length === 0) return worst

  const ring = (pts: ReadonlyArray<number>, top: number) => {
    for (let i = 0, n = pts.length, j = n - 2; i < n; j = i, i += 2) {
      const px = pts[j]! - sx,
        py = pts[j + 1]! - sy,
        ex = pts[i]! - pts[j]!,
        ey = pts[i + 1]! - pts[j + 1]!
      const den = dx * ey - dy * ex
      if (den === 0) continue
      const t = (px * ey - py * ex) / den,
        u = (px * dy - py * dx) / den
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) edge(t, top)
    }
  }
  // Liang-Barsky against a building's box: t0..t1 is the part of the path over it.
  let t0 = 0,
    t1 = 1
  const slab = (p: number, lo: number, hi: number): boolean => {
    if (p === 0) return lo <= 0 && hi >= 0
    t0 = Math.max(t0, Math.min(lo / p, hi / p))
    t1 = Math.min(t1, Math.max(lo / p, hi / p))
    return t0 <= t1
  }
  buildingsIn(
    Math.min(sx, to.x),
    Math.min(sy, to.y),
    Math.max(sx, to.x),
    Math.max(sy, to.y),
    (i) => {
      const [x0, y0, x1, y1] = buildingBoxes[i]!,
        { z0, h, outer, holes } = MAP.buildings[i]!,
        top = z0 + h
      t0 = 0
      t1 = 1
      if (!slab(dx, x0 - sx, x1 - sx) || !slab(dy, y0 - sy, y1 - sy)) return
      // The walls must rise above the path's lowest point over the box.
      if (top <= sz + dz * (dz > 0 ? t0 : t1) || within(i, sx, sy) || within(i, to.x, to.y)) return
      ring(outer, top)
      for (const hole of holes ?? []) ring(hole, top)
    },
  )
  return worst
}
