// Where two ways cross on two levels (an overpass, a road's tunnel under another, a path's or steps'
// bridge or tunnel): the way below keeps the rail bridge's clearance under the one above, its
// `maxheight` (UNDERPASS when untagged, PERSON under a path or steps) plus a DECK. The profiles fit
// the two one after the other, and the one fitted second takes the bound: it dips under the way
// above it, or, a bridge or a tunnel, rises over the way below. A bridge or a tunnel in an earlier
// pass than the other road (ROAD_PASSES) takes it too, from that road's natural level, as the rail
// does over a tagged underpass: a junction pinned under a slip road's bridge held a Cesena service
// road 1.6 m under it, and the Secante's tunnels ran 2.8 m under Cesena's streets; so does a road's
// tunnel under a path or steps at grade, which no pass fits. A road at grade never rises over a
// tunnel, and no road takes a bound from a path's or steps' bridge or tunnel: their pass
// (PATH_PASS) comes after every road's, and they take it. One chain crossing itself takes both
// bounds from one natural level. And two carriageways of one road that overlap in plan keep on one
// level there (`TWINS`).
import { isDrivable, ONE_LEVEL } from "../sim/map/kinds.ts"
import type { RoadF } from "./features.ts"
import { along, arcLengths, boxesMeet, crossings, lineBox, pointAt, type V } from "./geometry.ts"
import { type Bound, type Linear, lifted, ROAD_PASSES } from "./profiles.ts"

/** Clear height of an underpass whose way has no `maxheight` tag, m. */
export const UNDERPASS = 4
/**
 * Clear height under a path's or steps' bridge, or in its tunnel, where the way under it is a path
 * or steps with no `maxheight` tag, m: a pedestrian underpass's least headroom, over a person's
 * 1.8 m (`PERSON_HEIGHT`).
 */
const PERSON = 2.5
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
/**
 * How far apart in level two carriageways of one road keep where they overlap in plan, m: on one
 * level by the level rule (ONE_LEVEL), with the levels check's 0.5 m to spare for the profiles'
 * 0.1 m rounding and a rolled truck's wheels. Fitted each alone, the A15's carriageways north of the
 * Aulla junction overlap by up to 2.8 m while their decks stood 1.2–2.7 m apart.
 */
export const TWINS = ONE_LEVEL - 0.5

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

/**
 * The pass that fits `r`: its index in ROAD_PASSES, the path pass's after them for a path's or
 * steps' bridge or tunnel (PATH_PASS), and none (Infinity) for a path or steps at grade, which
 * follows the terrain.
 */
const passOf = (r: RoadF): number => {
  const i = ROAD_PASSES.findIndex((p) => (p.classes as ReadonlyArray<string>).includes(r.cls))
  return i >= 0 ? i : lifted(r) ? ROAD_PASSES.length : Infinity
}

/** Whether `r` is a path's or steps' bridge or tunnel: fitted after every road (PATH_PASS). */
const pathDeck = (r: RoadF): boolean => passOf(r) === ROAD_PASSES.length

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

/** The point of polyline `pts` (arc lengths `arc`) nearest (x, y): its distance and arc length. */
const nearest = (
  pts: ReadonlyArray<V>,
  arc: ReadonlyArray<number>,
  x: number,
  y: number,
): { readonly d: number; readonly s: number } => {
  let d = Infinity,
    s = 0
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!,
      ex = pts[k + 1]!.x - a.x,
      ey = pts[k + 1]!.y - a.y,
      l2 = ex * ex + ey * ey,
      t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2)) : 0,
      e = Math.hypot(a.x + ex * t - x, a.y + ey * t - y)
    if (e < d) [d, s] = [e, arc[k]! + (arc[k + 1]! - arc[k]!) * t]
  }
  return { d, s }
}

/**
 * Where two oneway carriageways of one road (one `ref`, a pass's) overlap in plan, sharing no node
 * and neither over the other: the points of each, SPREAD m apart along it, its carriageway's edge
 * past the other's, each with the arc length of the other's nearest point (`at`). Two streets of a
 * town stacked on two levels share no `ref`.
 */
const twinsOf = (roads: ReadonlyArray<RoadF>) => {
  const out: Array<{
    readonly on: RoadF
    readonly other: RoadF
    readonly x: number
    readonly y: number
    readonly at: number
  }> = []
  const byRef = new Map<string, Array<RoadF>>()
  for (const r of roads)
    if (r.oneway === true && r.ref !== undefined && passOf(r) < ROAD_PASSES.length)
      byRef.set(r.ref, [...(byRef.get(r.ref) ?? []), r])
  for (const list of byRef.values())
    for (const a of list)
      for (const b of list) {
        const reach = (a.w + b.w) / 2,
          [ax0, ay0, ax1, ay1] = lineBox(a.pts),
          [bx0, by0, bx1, by1] = lineBox(b.pts)
        if (a === b || ax0 > bx1 + reach || bx0 > ax1 + reach || ay0 > by1 + reach) continue
        if (by0 > ay1 + reach || passesOver(a, b) || passesOver(b, a)) continue
        if (a.pts.some((v) => v.id !== undefined && b.pts.some((u) => u.id === v.id))) continue
        const arcA = arcLengths(a.pts),
          arcB = arcLengths(b.pts)
        for (let s = 0; s <= arcA.at(-1)!; s += SPREAD) {
          const { x, y } = pointAt(a.pts, arcA, s),
            o = nearest(b.pts, arcB, x, y)
          if (o.d < reach) out.push({ on: a, other: b, x, y, at: o.s })
        }
      }
  return out
}

/** What the bounds are read from: the roads, the uncarved ground, whether a road's profile is already fitted, and a fitted road's z at arc length s. */
interface LevelsInput {
  readonly roads: ReadonlyArray<RoadF>
  readonly ground: (x: number, y: number) => number
  readonly fitted: (l: Linear) => boolean
  readonly zAt: (l: Linear, s: number) => number
}

/**
 * The crossings on two levels a fit keeps the clearance at (`over`: a way over a drivable road, or
 * over or under a path's or steps' bridge or tunnel; a path or steps at grade under a road's bridge
 * is left out, as no pass fits it and the bridge keeps its approaches' level), and the bounds they
 * put on a chain's profile: a way below a fitted one, or a tunnel below a later pass's road or a
 * path at grade (at its natural level), its clearance under it (`max`); a bridge, its clearance over
 * the way below, fitted or, in a later pass or at grade, at its natural level, and a tunnel over a
 * fitted way below it (`min`); and a carriageway, within TWINS of its twin's fitted level where they
 * overlap (`twinsOf`, both). And the level of the road deck a path's or steps' bridge ends on
 * (`deckUnder`).
 */
export const roadLevels = ({ roads, ground, fitted, zAt }: LevelsInput) => {
  const box = roads.map((r) => lineBox(r.pts))
  const shared = (a: RoadF, b: RoadF, x: number, y: number) =>
    a.pts.some(
      (v) =>
        v.id !== undefined &&
        Math.hypot(v.x - x, v.y - y) < 0.1 &&
        b.pts.some((u) => u.id === v.id),
    )
  // Every pair one of which passes over the other, by the way above, then the way below: a bridge
  // over any way, and any way but a bridge over a tunnel.
  const pairs: Array<readonly [number, number]> = []
  roads.forEach((r, i) => {
    if (r.bridge !== true && r.tunnel !== true) return
    roads.forEach((o, j) => {
      if (i === j || !boxesMeet(box[i]!, box[j]!)) return
      if (r.bridge === true && passesOver(r, o)) pairs.push([i, j])
      if (r.tunnel === true && o.bridge !== true && passesOver(o, r)) pairs.push([j, i])
    })
  })
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const over = pairs.flatMap(([i, j]) => {
    const up = roads[i]!,
      down = roads[j]!
    if (!isDrivable(down.cls) && !pathDeck(up) && !pathDeck(down)) return []
    const clear = (down.maxheight ?? (isDrivable(down.cls) ? UNDERPASS : PERSON)) + DECK
    return crossings(up.pts, down.pts)
      .filter((c) => !shared(up, down, c.x, c.y))
      .map((c) => ({ up, down, c, clear }))
  })
  /**
   * `z` bounding `l` at arc length `s` and SPREAD m either side of it: a bound holds at the profile
   * sample nearest its point, and the samples (at most 4 m apart) nearest these bracket `s`, so the
   * profile between them keeps the bound where the roads cross too.
   */
  const around = (l: Linear, s: number, z: number, kind: "min" | "max"): Array<Bound> => {
    const arc = arcLengths(l.pts)
    return [s - SPREAD, s, s + SPREAD].map((at) => {
      const { x, y } = pointAt(l.pts, arc, Math.min(arc.at(-1)!, Math.max(0, at)))
      return { x, y, z, kind, tilt: true, on: l }
    })
  }
  /** Whether `a` is fitted after `b` for sure: in a later pass, or never (a path or steps at grade). */
  const later = (a: RoadF, b: RoadF) => passOf(a) > passOf(b)
  const twins = twinsOf(roads)
  /** The bounds on `chain` from the crossings it has a road of, and from its carriageways' twins. */
  const bounds = (chain: ReadonlyArray<{ readonly item: Linear }>): Array<Bound> => {
    const has = (l: Linear) => chain.some((m) => m.item === l)
    // Where a carriageway overlaps its twin, fitted before it: on its level, inside a deck along the
    // deck's slope.
    const level = twins.flatMap(({ on, other, x, y, at }): Array<Bound> => {
      if (!has(on) || has(other) || !fitted(other)) return []
      const z = zAt(other, at)
      return [
        { x, y, z: z - TWINS, kind: "min", tilt: true, on },
        { x, y, z: z + TWINS, kind: "max", tilt: true, on },
      ]
    })
    const crossed = over.flatMap(({ up, down, c, clear }): Array<Bound> => {
      if (has(up) && has(down)) {
        // A chain over itself (the SR445's loop at Gassano runs under its own bridge, 13.6 m from
        // where it leaves it): one fit sets both, so both are bound from one natural level, the
        // road below's under a bridge (it stays SLACK over it at most), the road above's over a
        // tunnel (the road above stays SLACK under it at least, as no road at grade rises over one).
        const below =
          up.bridge === true
            ? naturalAt(ground, down, c.sb) + SLACK
            : naturalAt(ground, up, c.sa) - SLACK - clear
        return [...around(down, c.sb, below, "max"), ...around(up, c.sa, below + clear, "min")]
      }
      if (!has(up) && !has(down)) return []
      if (has(down)) {
        // Any way dips under a fitted one above it; a tunnel also under the natural level of a later
        // pass's road or of a path at grade (a bridge in a later pass rises over the way instead):
        // the aisles of Aulla's covered car park (maxheight 2.1 m) ran 0.4–2.1 m under its footways.
        const above = fitted(up)
          ? zAt(up, c.sa)
          : down.tunnel === true && later(up, down) && !pathDeck(up)
            ? naturalAt(ground, up, c.sa) - SLACK
            : undefined
        return above === undefined ? [] : around(down, c.sb, above - clear, "max")
      }
      // Only a bridge rises, or a tunnel over a fitted way under it (a path's underpass over a
      // road's, or two bores of one pass, the lower fitted first): a road at grade over a tunnel
      // keeps its level (a car park's ramp under a square in Cesena lifted the square 5.6 m).
      if (up.bridge !== true && !(up.tunnel === true && fitted(down))) return []
      const below = fitted(down)
        ? zAt(down, c.sb)
        : later(down, up) && !pathDeck(down)
          ? naturalAt(ground, down, c.sb) + SLACK
          : undefined
      return below === undefined ? [] : around(up, c.sa, below + clear, "min")
    })
    return [...crossed, ...level]
  }
  /**
   * The level of a fitted road's bridge of `piece`'s OSM level that `v`, an end of `piece` (a path's
   * or steps' bridge), stands on: abeam of its deck, their carriageways overlapping; undefined where
   * none. A sidewalk drawn as its own bridge beside its road's ends on the road's deck.
   */
  const deckUnder = (v: V, piece: RoadF): number | undefined => {
    let level: number | undefined,
      least = Infinity
    roads.forEach((r, i) => {
      if (r === piece || r.bridge !== true || !fitted(r) || levelOf(r) !== levelOf(piece)) return
      const reach = (r.w + piece.w) / 2,
        [x0, y0, x1, y1] = box[i]!
      if (v.x < x0 - reach || v.x > x1 + reach || v.y < y0 - reach || v.y > y1 + reach) return
      const arc = arcLengths(r.pts),
        { d, s } = nearest(r.pts, arc, v.x, v.y)
      if (d < reach && d < least && s > 0 && s < arc.at(-1)!) [level, least] = [zAt(r, s), d]
    })
    return level
  }
  return { over, bounds, deckUnder }
}
