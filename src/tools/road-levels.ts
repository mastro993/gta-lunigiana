// Where two roads cross on two levels (an overpass, a road's tunnel under another): the road below
// keeps the rail bridge's clearance under the one above, its `maxheight` (UNDERPASS when untagged)
// plus a DECK. The profiles fit the two one after the other, and the one fitted second takes the
// bound: it dips under the road above it, or, a bridge, rises over the road below. A bridge or a
// tunnel in an earlier pass than the other road (ROAD_PASSES) takes it too, from that road's natural
// level, as the rail does over a tagged underpass: a junction pinned under a slip road's bridge held
// a Cesena service road 1.6 m under it, and the Secante's tunnels ran 2.8 m under Cesena's streets.
// A road at grade never rises over a tunnel.
import { isDrivable } from "../sim/map/kinds.ts"
import type { RoadF } from "./features.ts"
import { along, arcLengths, boxesMeet, crossings, lineBox, pointAt } from "./geometry.ts"
import { type Bound, type Linear, ROAD_PASSES } from "./profiles.ts"

/** Clear height of an underpass whose way has no `maxheight` tag, m. */
export const UNDERPASS = 4
/** A bridge's structure above the clear height under it, m. */
export const DECK = 1.5
/** Half the spacing of the profile samples, m (`resample` in profiles.ts: at most 4 m apart). */
const SPREAD = 2
/**
 * How far past the clearance a bound from the other road's natural level reaches, m (TUNED): a
 * junction pinned under a bridge can hold the road below over its natural level (by 0.18 m under
 * a Cesena slip road's bridge, which then kept 5.32 m).
 */
const SLACK = 0.3

/** Mean of `ground` along `l` within 35 m (arc length) of `s`: a line's natural level before it is profiled. */
export const naturalAt = (
  ground: (x: number, y: number) => number,
  l: Linear,
  s: number,
): number => {
  const ss = arcLengths(l.pts),
    xs = l.pts.map((v) => v.x),
    ys = l.pts.map((v) => v.y)
  let sum = 0,
    n = 0
  for (let d = Math.max(0, s - 35); d <= Math.min(ss.at(-1)!, s + 35); d += 2, n++)
    sum += ground(along(ss, xs, d), along(ss, ys, d))
  return sum / Math.max(1, n)
}

/** The index of the pass in ROAD_PASSES that fits `cls`. */
const passOf = (cls: string): number =>
  ROAD_PASSES.findIndex((p) => (p.classes as ReadonlyArray<string>).includes(cls))

/** A way's OSM level: its `layer`, else 1 on a bridge, −1 in a tunnel, 0 at grade. */
const levelOf = (r: {
  readonly bridge?: boolean
  readonly tunnel?: boolean
  readonly layer?: number
}): number => r.layer ?? (r.bridge === true ? 1 : r.tunnel === true ? -1 : 0)

/**
 * Whether road `a` passes over road `b` where they cross with no shared node: it is a bridge or `b`
 * a tunnel, and its OSM level is higher. Ways on one level that cross without a shared node say
 * nothing of which is on top.
 */
export const passesOver = (
  a: { readonly bridge?: boolean; readonly tunnel?: boolean; readonly layer?: number },
  b: { readonly bridge?: boolean; readonly tunnel?: boolean; readonly layer?: number },
): boolean => (a.bridge === true || b.tunnel === true) && levelOf(a) > levelOf(b)

/** What the bounds are read from: the roads, the uncarved ground, whether a road's profile is already fitted, and a fitted road's z at arc length s. */
interface LevelsInput {
  readonly roads: ReadonlyArray<RoadF>
  readonly ground: (x: number, y: number) => number
  readonly fitted: (l: Linear) => boolean
  readonly zAt: (l: Linear, s: number) => number
}

/**
 * The road-over-road crossings (a profiled road over a drivable one; paths and steps follow the
 * terrain) and the bounds they put on a chain's profile: a road below a fitted one, or a tunnel below
 * a later pass's road (at its natural level), its clearance under it (`max`); a bridge, its
 * clearance over the road below, fitted or, in a later pass, at its natural level (`min`).
 */
export const roadLevels = ({ roads, ground, fitted, zAt }: LevelsInput) => {
  const profiled = (r: RoadF) => r.cls !== "path" && r.cls !== "steps"
  const box = roads.map((r) => lineBox(r.pts))
  const shared = (a: RoadF, b: RoadF, x: number, y: number) =>
    a.pts.some(
      (v) =>
        v.id !== undefined &&
        Math.hypot(v.x - x, v.y - y) < 0.1 &&
        b.pts.some((u) => u.id === v.id),
    )
  const over = roads.flatMap((up, i) =>
    profiled(up)
      ? roads.flatMap((down, j) =>
          i !== j && isDrivable(down.cls) && passesOver(up, down) && boxesMeet(box[i]!, box[j]!)
            ? crossings(up.pts, down.pts)
                .filter((c) => !shared(up, down, c.x, c.y))
                .map((c) => ({ up, down, c, clear: (down.maxheight ?? UNDERPASS) + DECK }))
            : [],
        )
      : [],
  )
  /**
   * `z` bounding `l` at arc length `s` and SPREAD m either side of it: a bound holds at the profile
   * sample nearest its point, and the samples (at most 4 m apart) nearest these bracket `s`, so the
   * profile between them keeps the bound where the roads cross too.
   */
  const around = (l: Linear, s: number, z: number, kind: "min" | "max"): Array<Bound> => {
    const arc = arcLengths(l.pts)
    return [s - SPREAD, s, s + SPREAD].map((at) => {
      const { x, y } = pointAt(l.pts, arc, Math.min(arc.at(-1)!, Math.max(0, at)))
      return { x, y, z, kind, tilt: true }
    })
  }
  /** Whether `a`'s pass comes after `b`'s (ROAD_PASSES): `a` is fitted after `b` for sure. */
  const later = (a: RoadF, b: RoadF) => passOf(a.cls) > passOf(b.cls)
  /** The bounds on `chain` from the crossings it has one road of. */
  const bounds = (chain: ReadonlyArray<{ readonly item: Linear }>): Array<Bound> => {
    const has = (l: Linear) => chain.some((m) => m.item === l)
    return over.flatMap(({ up, down, c, clear }): Array<Bound> => {
      if (has(up) === has(down)) return []
      if (has(down)) {
        // Any road dips under a fitted one above it; a tunnel also under a later pass's road's
        // natural level (a bridge in a later pass rises over the road instead).
        const above = fitted(up)
          ? zAt(up, c.sa)
          : down.tunnel === true && later(up, down)
            ? naturalAt(ground, up, c.sa) - SLACK
            : undefined
        return above === undefined ? [] : around(down, c.sb, above - clear, "max")
      }
      // Only a bridge rises: a road at grade over a tunnel keeps its level (a car park's ramp under
      // a square in Cesena lifted the square 5.6 m).
      if (up.bridge !== true) return []
      const below = fitted(down)
        ? zAt(down, c.sb)
        : later(down, up)
          ? naturalAt(ground, down, c.sb) + SLACK
          : undefined
      return below === undefined ? [] : around(up, c.sa, below + clear, "min")
    })
  }
  return { over, bounds }
}
