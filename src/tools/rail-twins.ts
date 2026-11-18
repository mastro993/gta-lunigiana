// Two tracks side by side stand on one formation: the rail's twin rule. The rail is profiled one
// chain at a time, and a switch ends a chain, so each track of a double line was fitted apart from
// the other: north of Aulla the Pontremolese's two tracks, 3.9–5.6 m apart, stood 1.5–2.8 m apart in
// level at the portals of their twin tunnels and on the viaduct between them. A track fitted after
// its twin keeps to the twin's level where they run side by side, and parts from it no faster than
// an embankment's slope where they part.
import { Ops } from "@typeonce/ritmo-math"

import type { RailF } from "./features.ts"
import { arcLengths, boxesMeet, lineBox, pointAt, type V } from "./geometry.ts"
import type { Bound } from "./profiles.ts"

/** Tracks this close (m, centreline to centreline) run side by side; a double line's lie 3.9–5.6 m apart. */
export const SIDE = 6
/** How far (m) a track keeps to its twin's level while they run side by side. */
export const TWIN = 0.1
/** Past SIDE, the far track may stand this much higher or lower (m) per metre farther apart: a 2:3 bank between their formations. */
const PART = 2 / 3
/** Tracks farther apart than this (m) bind each other no more. */
export const REACH = 12
/** The points of a track its twin binds lie this far (m) apart along it. */
const SPREAD = 2
/** Two tracks run side by side only where their headings differ by less than this (15°): a crossing is none. */
const PARALLEL = Ops.cos(Math.PI / 12)

/** The point of `pts` nearest (x, y): its distance, its interpolation t on segment k and the segment's unit heading. */
const nearestOn = (pts: ReadonlyArray<V>, x: number, y: number) => {
  let best = { d: Infinity, k: 0, t: 0, hx: 1, hy: 0 }
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!,
      ex = pts[k + 1]!.x - a.x,
      ey = pts[k + 1]!.y - a.y,
      l2 = ex * ex + ey * ey,
      t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2)) : 0,
      d = Math.hypot(a.x + ex * t - x, a.y + ey * t - y)
    if (d < best.d) {
      const l = Math.sqrt(l2) || 1
      best = { d, k, t, hx: ex / l, hy: ey / l }
    }
  }
  return best
}

/** How far (m) a track `d` m from its twin may stand off the twin's level. */
export const twinSlack = (d: number): number => TWIN + PART * Math.max(0, d - SIDE)

/**
 * Where a track runs beside another of its kind (both on a bridge, both in a tunnel or both at
 * grade), REACH m apart or less and near parallel: its points SPREAD m apart along it, each with its
 * distance to the other.
 */
export const railTwins = (rail: ReadonlyArray<RailF>) => {
  const out: Array<{
    readonly on: RailF
    readonly other: RailF
    readonly x: number
    readonly y: number
    readonly d: number
  }> = []
  const kind = (r: RailF) => (r.bridge === true ? 1 : r.tunnel === true ? 2 : 0)
  const box = rail.map((r) => {
    const [x0, y0, x1, y1] = lineBox(r.pts)
    return [x0 - REACH, y0 - REACH, x1 + REACH, y1 + REACH] as const
  })
  rail.forEach((a, i) => {
    const arc = arcLengths(a.pts)
    rail.forEach((b, j) => {
      if (i === j || kind(a) !== kind(b) || !boxesMeet(box[i]!, box[j]!)) return
      for (let s = 0; s <= arc.at(-1)!; s += SPREAD) {
        const { x, y } = pointAt(a.pts, arc, s),
          own = nearestOn(a.pts, x, y),
          o = nearestOn(b.pts, x, y)
        if (o.d <= REACH && Math.abs(own.hx * o.hx + own.hy * o.hy) >= PARALLEL)
          out.push({ on: a, other: b, x, y, d: o.d })
      }
    })
  })
  return out
}

/** A fitted track's level at the point of its profile (`pts` and `z`, as shipped) nearest (x, y). */
const levelNear = (
  dense: { readonly pts: ReadonlyArray<V>; readonly z: ReadonlyArray<number> },
  x: number,
  y: number,
) => {
  const { k, t } = nearestOn(dense.pts, x, y)
  return dense.z[k]! + (dense.z[Math.min(k + 1, dense.z.length - 1)]! - dense.z[k]!) * t
}

/**
 * The bounds the twins (`railTwins`) put on `chain`: each of its tracks within `twinSlack` of the
 * level of a twin fitted before it (`fitted`, its profile as shipped), none from a track of its own.
 * Each holds at its own sample (`here`): on a bridge or in a tunnel the twin's deck is straight, so
 * its level all along it holds this one's straight too, ends and all, and at a deck's end a bound
 * from the track at grade before it holds there alone, not along the deck.
 */
export const twinBounds = (
  twins: ReturnType<typeof railTwins>,
  chain: ReadonlyArray<{ readonly item: RailF }>,
  fitted: (
    l: RailF,
  ) => { readonly pts: ReadonlyArray<V>; readonly z: ReadonlyArray<number> } | undefined,
): Array<Bound> => {
  const has = (l: RailF) => chain.some((m) => m.item === l)
  return twins.flatMap(({ on, other, x, y, d }): Array<Bound> => {
    const dense = has(on) && !has(other) ? fitted(other) : undefined
    if (dense === undefined) return []
    const z = levelNear(dense, x, y),
      slack = twinSlack(d)
    return [
      { x, y, z: z - slack, kind: "min", on, here: true },
      { x, y, z: z + slack, kind: "max", on, here: true },
    ]
  })
}
