/**
 * Whether a road tunnel's portal stands clear of the roads and the track round its mouth: no
 * carriageway (no track's bed) reaches under its face wall, its cornice or its throat between their
 * foot and their top, but that of a road carrying on out of the mouth, which may fill the arch. The
 * build stands the road portals by it (`bakeMouths` in render/portals), so none stands on a road at
 * a junction, nor its throat across a road or the track over a shallow tunnel.
 *
 * @module render/portal-clear
 */
import { segDist2 } from "../sim/collide.ts"
import { ROAD_LIFT, roadZ } from "../sim/map/ground.ts"
import { MAP, type Road, roadClassOf } from "../sim/map/index.ts"

/** A track's bed, m either side of its centreline: its shoulders' foot (`BED` in render/rail). */
const BED_HALF = 2.1
/** A road or the track near a mouth is probed every this many metres along its centreline. */
const PROBE = 0.25

/**
 * A point of a road's or the track's centreline near a mouth: map x, y, its surface (m a.s.l.),
 * half its width, and whether it is on a road carrying on out of the mouth.
 */
interface Near {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly half: number
  readonly out: boolean
}

/** A surface's height (m a.s.l.) from its profile at a point and the point. */
type Surface = (z: number, x: number, y: number) => number

/**
 * The points every PROBE m along the roads of `roads` but those `own` (indices: the mouth's tunnel)
 * and along the track out of tunnels, on their segments within `reach` m of the mouth (x, y) heading
 * out of the hill (ux, uy). A segment from (x, y) out of the hill carries on out of the mouth.
 */
export const nearMouth = (
  roads: ReadonlyArray<Road>,
  own: ReadonlyArray<number>,
  x: number,
  y: number,
  ux: number,
  uy: number,
  reach: number,
): Array<Near> => {
  const near: Array<Near> = []
  const add = (pts: ReadonlyArray<number>, z: ReadonlyArray<number>, half: number, at: Surface) => {
    for (let k = 0; k + 1 < z.length; k++) {
      const ax = pts[2 * k]!,
        ay = pts[2 * k + 1]!,
        bx = pts[2 * k + 2]!,
        by = pts[2 * k + 3]!
      if (segDist2(x, y, ax, ay, bx, by).d2 > reach * reach) continue
      const out =
        (ax === x && ay === y && (bx - x) * ux + (by - y) * uy > 0) ||
        (bx === x && by === y && (ax - x) * ux + (ay - y) * uy > 0)
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / PROBE))
      for (let j = 0; j <= n; j++) {
        const px = ax + ((bx - ax) * j) / n,
          py = ay + ((by - ay) * j) / n
        near.push({ x: px, y: py, z: at(z[k]! + ((z[k + 1]! - z[k]!) * j) / n, px, py), half, out })
      }
    }
  }
  roads.forEach((road, i) => {
    if (own.includes(i)) return
    const lift = ROAD_LIFT[roadClassOf(road)],
      lifted = road.bridge === true || road.tunnel === true
    add(road.pts, road.z, road.w / 2, (z, px, py) => roadZ(z, px, py, lift, lifted))
  })
  for (const rail of MAP.rail) if (rail.tunnel !== true) add(rail.pts, rail.z, BED_HALF, (z) => z)
  return near
}

/**
 * A portal's footprint in its mouth's frame, m: into the hill from the mouth and either side of its
 * axis, its tops over the road's surface, and the half width of its arch.
 */
export interface Footprint {
  /** The face wall under its cornice: from `from` to `to` m in, `half` m either side, up to `top`. */
  readonly face: {
    readonly from: number
    readonly to: number
    readonly half: number
    readonly top: number
  }
  /** The throat: from `from` m in on, `half` m either side, up to `top`. */
  readonly throat: { readonly from: number; readonly half: number; readonly top: number }
  readonly arch: number
}

/**
 * How deep (m past its start) the throat of the portal `print`, its mouth at (x, y) heading out
 * (ux, uy) on the road's surface `z` and its foot at `foot` (m a.s.l.), may run before it stands on
 * a road or the track of `near` (Infinity when none is in its way), or undefined when its face wall
 * or cornice already does: a point of `near` whose carriageway reaches under it, between its foot
 * and its top, but where a road carrying on out of the mouth fills the arch.
 */
export const clearance = (
  near: ReadonlyArray<Near>,
  x: number,
  y: number,
  z: number,
  ux: number,
  uy: number,
  foot: number,
  { face, throat, arch }: Footprint,
): number | undefined => {
  // How far across a point stands from the side of what stands `wide` m either side of the axis, 0 under it.
  const across = (b: number, wide: number, out: boolean) =>
    b > wide ? b - wide : out && b < arch ? arch - b : 0
  let deepest = Number.POSITIVE_INFINITY
  for (const p of near) {
    if (p.z <= foot) continue
    const d = (x - p.x) * ux + (y - p.y) * uy,
      b = Math.abs((y - p.y) * ux - (x - p.x) * uy)
    const wall = across(b, face.half, p.out),
      depth = Math.max(face.from - d, d - face.to, 0)
    if (p.z < z + face.top && wall * wall + depth * depth < p.half * p.half) return undefined
    const side = across(b, throat.half, p.out)
    if (p.z < z + throat.top && side < p.half) {
      const reach = Math.sqrt(p.half * p.half - side * side)
      if (d + reach > throat.from) deepest = Math.min(deepest, d - reach - throat.from)
    }
  }
  return deepest
}
