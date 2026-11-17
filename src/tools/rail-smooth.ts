// Smoothing of the rail where no CTR track guides it between two stretches it does (tunnels):
// OSM draws those curves with few vertices (a 16° bend at the Terma tunnel's north portal), so the
// displaced OSM line is replaced by a smoothing spline that keeps its ends and, through two anchor
// points beyond each end, the CTR track's heading there. Elsewhere OSM's own corners are rounded
// along a curve through its vertices, or, between straights too long to curve through within
// OSM's accuracy, by an arc inside the corner (`roundCorners`).
import { Ops } from "@typeonce/ritmo-math"

import type { P, V } from "./geometry.ts"
import { footOn, lineOf, pointOn, simplifyLine } from "./rail-match.ts"

/**
 * Resampling step (m), weight of the distance to OSM's line against the squared second
 * differences, and the anchors' spacing beyond each end (m). The weight sets the spline's reach,
 * step × weight^(−1/4) = 50 m: OSM's bends spread over about 100 m, a radius well over 300 m.
 */
const SMOOTH = { step: 5, fit: 1e-4, anchor: 5, radius: 320, rounds: 30 }

/** Solves the symmetric banded system `a` (rows of 5: columns i−2…i+2) · x = b by elimination (`a` positive definite). */
const solveBand = (a: Array<Float64Array>, b: Float64Array): Float64Array => {
  const n = b.length
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j <= Math.min(n - 1, i + 2); j++) {
      const f = a[j]![2 + i - j]! / a[i]![2]!
      for (let c = i; c <= Math.min(n - 1, i + 2); c++)
        a[j]![2 + c - j] = a[j]![2 + c - j]! - f * a[i]![2 + c - i]!
      b[j] = b[j]! - f * b[i]!
    }
  const x = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!
    for (let c = i + 1; c <= Math.min(n - 1, i + 2); c++) s -= a[i]![2 + c - i]! * x[c]!
    x[i] = s / a[i]![2]!
  }
  return x
}

/**
 * The polyline `pts` resampled every ~SMOOTH.step m and smoothed: its first and last points stay;
 * `before` and `after` (the points SMOOTH.anchor and 2 × SMOOTH.anchor m beyond that end, nearest
 * first; empty at a free end) hold the CTR track's heading there. The energy is the squared second
 * differences, each weighted, plus SMOOTH.fit × the squared distance to `pts`; where the curve
 * bends tighter than SMOOTH.radius, its weights grow and the fit is solved again (up to
 * SMOOTH.rounds times), spreading the bend.
 */
export const smoothRun = (
  pts: ReadonlyArray<P>,
  before: ReadonlyArray<P>,
  after: ReadonlyArray<P>,
): Array<P> => {
  const line = lineOf(pts),
    len = line.s.at(-1)!
  const n = Math.max(1, Math.round(len / SMOOTH.step))
  const target = Array.from({ length: n + 1 }, (_, k) => pointOn(line, (k * len) / n))
  if (n < 2) return target
  // The whole sequence: anchors before (farthest first), the run, anchors after.
  const seq: Array<[number, number]> = [...[...before].reverse(), ...target, ...after].map((p) => [
    p[0],
    p[1],
  ])
  const first = before.length,
    last = first + n
  const free = (k: number) => k > first && k < last
  const m = last - first - 1,
    col = (k: number) => k - first - 1
  const weight = new Float64Array(seq.length).fill(1)
  const h = len / n,
    bend = (h * h) / SMOOTH.radius
  for (let round = 0; round < SMOOTH.rounds; round++) {
    for (const axis of [0, 1] as const) {
      const a = Array.from({ length: m }, () => new Float64Array(5))
      const b = new Float64Array(m)
      for (let k = first + 1; k < last; k++) {
        a[col(k)]![2] = a[col(k)]![2]! + SMOOTH.fit
        b[col(k)] = b[col(k)]! + SMOOTH.fit * target[k - first]![axis]
      }
      // Each second difference z[j−1] − 2 z[j] + z[j+1] adds its weighted square to the energy.
      for (let j = 1; j + 1 < seq.length; j++) {
        const terms = [
          [j - 1, 1],
          [j, -2],
          [j + 1, 1],
        ] as const
        if (!terms.some(([k]) => free(k))) continue
        let fixed = 0
        for (const [k, c] of terms) if (!free(k)) fixed += c * seq[k]![axis]
        for (const [r, cr] of terms) {
          if (!free(r)) continue
          b[col(r)] = b[col(r)]! - weight[j]! * cr * fixed
          for (const [c, cc] of terms)
            if (free(c))
              a[col(r)]![2 + col(c) - col(r)] =
                a[col(r)]![2 + col(c) - col(r)]! + weight[j]! * cr * cc
        }
      }
      const x = solveBand(a, b)
      for (let k = first + 1; k < last; k++) seq[k]![axis] = x[col(k)]!
    }
    let tight = false
    for (let j = 1; j + 1 < seq.length; j++) {
      const d = Math.hypot(
        seq[j - 1]![0] - 2 * seq[j]![0] + seq[j + 1]![0],
        seq[j - 1]![1] - 2 * seq[j]![1] + seq[j + 1]![1],
      )
      if (d > bend) [weight[j], tight] = [weight[j]! * (d / bend) ** 2, true]
    }
    if (!tight) break
  }
  return seq.slice(first, last + 1)
}

/**
 * Replaces the sorted `items` strictly between chain keys `lo` and `hi` by a smoothing spline from
 * the item at `lo` to the one at `hi`, simplified to `keep` m like the CTR's vertices; the items
 * with an id move onto it (and their `moves` with them).
 */
export const smoothGap = (
  items: Array<{ key: number; v: V }>,
  lo: number,
  hi: number,
  moves: Map<string, V>,
  keep: number,
): void => {
  const i0 = items.findIndex((it) => it.key >= lo - 1e-9)
  let i1 = items.length - 1
  while (i1 > 0 && items[i1]!.key > hi + 1e-9) i1--
  if (i1 - i0 < 1) return
  const run = items.slice(i0, i1 + 1).map((it): P => [it.v.x, it.v.y])
  const span = lineOf(run).s.at(-1)!
  if (span < 2 * SMOOTH.step) return
  /** Points SMOOTH.anchor and twice that beyond item `i`, walking away from the run (`dir` −1 back, 1 ahead). */
  const anchors = (i: number, dir: -1 | 1): Array<P> => {
    const side = (dir < 0 ? items.slice(0, i + 1).reverse() : items.slice(i)).map((it): P => [
      it.v.x,
      it.v.y,
    ])
    const l = lineOf(side)
    return l.s.at(-1)! < 2 * SMOOTH.anchor
      ? []
      : [pointOn(l, SMOOTH.anchor), pointOn(l, 2 * SMOOTH.anchor)]
  }
  const curve = simplifyLine(smoothRun(run, anchors(i0, -1), anchors(i1, 1)), keep)
  const shape = lineOf(curve),
    k0 = items[i0]!.key,
    k1 = items[i1]!.key
  const keyAt = (sAt: number) => k0 + ((k1 - k0) * sAt) / shape.s.at(-1)!
  const inner: Array<{ key: number; v: V }> = curve
    .slice(1, -1)
    .map(([x, y], j) => ({ key: keyAt(shape.s[j + 1]!), v: { x, y } }))
  for (const it of items.slice(i0 + 1, i1)) {
    if (it.v.id === undefined) continue
    const f = footOn(shape, it.v.x, it.v.y)
    const v = { x: f.x, y: f.y, id: it.v.id }
    moves.set(it.v.id, v)
    inner.push({ key: keyAt(f.s), v })
  }
  inner.sort((a, b) => a.key - b.key)
  items.splice(i0 + 1, i1 - i0 - 1, ...inner)
}

/**
 * A vertex of OSM's line where no survey guides it turning more than this is a corner to round, degrees: over the CTR's own
 * vertices' 2–5.5° (a 7° kink at the Via Castel dell'Aquila crossing apart, on a surveyed run), under OSM's coarse corners
 * (11.4° in the Lucca–Aulla line's tunnel 140772193, 8–10.2° on the Pontremolese's 842172341).
 */
const ROUND_TURN = 6
/**
 * How far a rounded segment may bow off OSM's, m: within OSM's own accuracy (it lies 0.68 m from the CTR at the median, 3.11 m
 * at p90). Farther, OSM's vertices lie too far apart to say where the track bends, and it takes an arc inside the corner,
 * which passes it within ROUND_OFF (`roundThrough`).
 */
const ROUND_OFF = 1.5
/**
 * A vertex nearer a sharper corner beside it than this, m, sets the curve no heading: OSM's nodes lie 0.68 m off the track at
 * the median, so a chord this short gives its heading to about ±5.5° (√2 × 0.68 m over 10 m), under ROUND_TURN. It slides
 * onto the curve through the others instead: held there, the Pontremolese's bridge 842172344, 4.3 m on from an 11.4° corner
 * and in line with the straight after it, took the whole turn in its 4.3 m, a bend of 107.4 m over 20 m chords.
 */
const ROUND_NEAR = 10
/** The spline is sampled every this many m or less before it is simplified. */
const ROUND_SAMPLE = 1

/** The point at t of the centripetal Catmull–Rom spline through p0…p3 at knots t0…t3 (Barry and Goldman's pyramid). */
const catmullRom = (
  p: readonly [V, V, V, V],
  [t0, t1, t2, t3]: readonly [number, number, number, number],
  t: number,
) => {
  const mix = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    ta: number,
    tb: number,
  ) => ({
    x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta),
    y: ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta),
  })
  const a1 = mix(p[0], p[1], t0, t1),
    a2 = mix(p[1], p[2], t1, t2),
    a3 = mix(p[2], p[3], t2, t3)
  return mix(mix(a1, a2, t0, t2), mix(a2, a3, t1, t3), t1, t2)
}

/** How far the line turns at `v` between `a` and `b`, degrees. */
const turnOf = (a: V, v: V, b: V) => {
  const h0 = Ops.atan2(v.y - a.y, v.x - a.x),
    h1 = Ops.atan2(b.y - v.y, b.x - v.x)
  return Math.abs(Ops.atan2(Ops.sin(h1 - h0), Ops.cos(h1 - h0))) * (180 / Math.PI)
}

/**
 * `pts` with each segment one of whose ends `rounds` allows (OSM's own vertices no survey guides) and turns more than
 * ROUND_TURN followed along the centripetal Catmull–Rom spline through its vertices, simplified to `keep` m like the CTR's
 * vertices, where it bows no more than ROUND_OFF m off it, else along an arc inside the corner (`roundThrough`), and the track
 * keeps no corner. Every vertex stays where it is, ids and all, but such a corner, and one `rounds` allows lying within
 * ROUND_NEAR of a sharper corner beside it: each goes to its foot on the curve, within ROUND_OFF of where it was (else the
 * near one stays a vertex of the curve). OSM draws curves no survey maps with few vertices: Aulla's tunnel 140772193 turned
 * 11.4° between 41 and 52 m segments, a bend of 100.9 m over 20 m chords.
 */
export const roundCorners = (
  pts: ReadonlyArray<V>,
  rounds: (i: number) => boolean,
  keep: number,
): Array<V> => {
  const n = pts.length
  const turn = (i: number) => (i <= 0 || i >= n - 1 ? 0 : turnOf(pts[i - 1]!, pts[i]!, pts[i + 1]!))
  const slides = new Set<number>()
  for (let i = 1; i + 1 < n; i++)
    for (const j of [i - 1, i + 1])
      if (
        rounds(i) &&
        rounds(j) &&
        turn(j) > ROUND_TURN &&
        turn(j) > turn(i) &&
        Math.hypot(pts[j]!.x - pts[i]!.x, pts[j]!.y - pts[i]!.y) < ROUND_NEAR
      )
        slides.add(i)
  for (;;) {
    const { line, slid } = roundThrough(pts, rounds, keep, slides)
    const far = [...slid].filter(
      ([i, at]) => slides.has(i) && Math.hypot(at.x - pts[i]!.x, at.y - pts[i]!.y) > ROUND_OFF,
    )
    if (far.length === 0) return line
    for (const [i] of far) slides.delete(i)
  }
}

/**
 * `roundCorners`'s line through the vertices of `pts` but those `slides` holds, and where each of those lands on it (`slid`,
 * by its index in `pts`). A corner whose curve through its neighbours would bow more than ROUND_OFF off a segment of it is
 * no point on the track OSM traced but where two of its straights meet, too long to say where the track bends between them:
 * the track follows an arc inside it from one straight to the other, the widest that passes the corner within ROUND_OFF and
 * takes at most half of either straight, and the corner goes to its foot on it (`slid` too). The Pontremolese's tunnels north
 * of Aulla turn 9° at 946219202 and 3810624666 between straights of 143–257 m, which no curve through their far vertices
 * rounds within ROUND_OFF: left at a point, the turn was a bend of 127.6 m over 20 m chords.
 */
const roundThrough = (
  pts: ReadonlyArray<V>,
  rounds: (i: number) => boolean,
  keep: number,
  slides: ReadonlySet<number>,
) => {
  const base = pts.flatMap((v, at) => (slides.has(at) ? [] : [{ v, at }]))
  const nb = base.length
  const free = (j: number) => rounds(base[j]!.at)
  const corner = (j: number) =>
    j > 0 &&
    j < nb - 1 &&
    free(j) &&
    turnOf(base[j - 1]!.v, base[j]!.v, base[j + 1]!.v) > ROUND_TURN
  /** The arc inside corner j: its two ends on the straights either side, and its points between them. */
  const arcOf = (j: number) => {
    const a = base[j - 1]!.v,
      v = base[j]!.v,
      b = base[j + 1]!.v
    const l0 = Math.hypot(v.x - a.x, v.y - a.y),
      l1 = Math.hypot(b.x - v.x, b.y - v.y)
    const u0 = { x: (v.x - a.x) / l0, y: (v.y - a.y) / l0 },
      u1 = { x: (b.x - v.x) / l1, y: (b.y - v.y) / l1 }
    const turn = Ops.atan2(u0.x * u1.y - u0.y * u1.x, u0.x * u1.x + u0.y * u1.y)
    const half = Math.abs(turn) / 2
    // The arc's tangent length: its middle ROUND_OFF from the corner, or half the shorter straight.
    const t = Math.min((ROUND_OFF / (1 / Ops.cos(half) - 1)) * Ops.tan(half), l0 / 2, l1 / 2)
    const r = t / Ops.tan(half),
      side = Math.sign(turn)
    const from = { x: v.x - u0.x * t, y: v.y - u0.y * t },
      to = { x: v.x + u1.x * t, y: v.y + u1.y * t }
    const centre = { x: from.x - u0.y * r * side, y: from.y + u0.x * r * side }
    const steps = Math.max(2, Math.ceil((r * Math.abs(turn)) / ROUND_SAMPLE))
    const along = Array.from({ length: steps + 1 }, (_, k): P => {
      const phi = (turn * k) / steps,
        dx = from.x - centre.x,
        dy = from.y - centre.y
      return [
        centre.x + dx * Ops.cos(phi) - dy * Ops.sin(phi),
        centre.y + dx * Ops.sin(phi) + dy * Ops.cos(phi),
      ]
    })
    return { from, to, pts: simplifyLine(along, keep) }
  }
  /** The corners the track rounds by an arc inside them, by their place in `base`. */
  const arcs = new Map<number, ReturnType<typeof arcOf>>()
  for (;;) {
    // The control points: OSM's vertices (`at`, their index in `pts`), each corner with an arc in place of its ends (`arc`).
    const c = base.flatMap((q, j): Array<{ v: V; at: number; of: number; arc: boolean }> => {
      const arc = arcs.get(j)
      return arc === undefined
        ? [{ v: q.v, at: q.at, of: j, arc: false }]
        : [
            { v: arc.from, at: -1, of: j, arc: true },
            { v: arc.to, at: -1, of: j, arc: true },
          ]
    })
    const m = c.length
    const rounded = (k: number) => !c[k]!.arc && corner(c[k]!.of)
    const segs: Array<ReadonlyArray<P>> = []
    let more = false
    for (let k = 0; k + 1 < m; k++) {
      const q1 = c[k]!,
        q2 = c[k + 1]!,
        p1 = q1.v,
        p2 = q2.v,
        len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      const steps = Math.ceil(len / ROUND_SAMPLE)
      if (q1.arc && q2.arc && q1.of === q2.of) {
        segs.push(arcs.get(q1.of)!.pts)
        continue
      }
      const straight: Array<P> = [
        [p1.x, p1.y],
        [p2.x, p2.y],
      ]
      const open = (q: (typeof c)[number]) => q.arc || free(q.of)
      if (!(open(q1) && open(q2) && (rounded(k) || rounded(k + 1)) && steps > 1)) {
        segs.push(straight)
        continue
      }
      // Past either end of the line, or into an arc, its control point mirrors the next one: the spline leaves straight.
      const p0 = (q1.arc ? undefined : c[k - 1]?.v) ?? { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y },
        p3 = (q2.arc ? undefined : c[k + 2]?.v) ?? { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y }
      const knot = (a: V, b: V) => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)) || 1e-9
      const t1 = knot(p0, p1),
        t2 = t1 + knot(p1, p2),
        t3 = t2 + knot(p2, p3)
      const curve = Array.from({ length: steps - 1 }, (_, j) =>
        catmullRom([p0, p1, p2, p3], [0, t1, t2, t3], t1 + ((t2 - t1) * (j + 1)) / steps),
      )
      const off = (q: { x: number; y: number }) =>
        Math.abs((p2.x - p1.x) * (q.y - p1.y) - (p2.y - p1.y) * (q.x - p1.x)) / len
      if (curve.every((q) => off(q) <= ROUND_OFF)) {
        segs.push(
          simplifyLine([[p1.x, p1.y], ...curve.map((q): P => [q.x, q.y]), [p2.x, p2.y]], keep),
        )
        continue
      }
      // An arc inside each corner of it whose straights either side OSM draws (`rounds`), and the curves through again.
      for (const q of [q1, q2])
        if (!q.arc && corner(q.of) && free(q.of - 1) && free(q.of + 1)) {
          arcs.set(q.of, arcOf(q.of))
          more = true
        }
      segs.push(straight)
    }
    if (more) continue
    // The curve, and where each control point lies on it.
    const curve: Array<V> = [c[0]!.v],
      on = [0]
    segs.forEach((seg, k) => {
      curve.push(...seg.slice(1, -1).map(([x, y]) => ({ x, y })), c[k + 1]!.v)
      on.push(curve.length - 1)
    })
    // Between two of OSM's vertices that stay, the curve, and each vertex sliding onto it at its foot.
    const kept = c.flatMap((q, k) => (q.arc ? [] : [{ at: q.at, on: on[k]! }]))
    const line: Array<V> = [curve[0]!]
    const slid = new Map<number, V>()
    for (let g = 0; g + 1 < kept.length; g++) {
      const run = curve.slice(kept[g]!.on, kept[g + 1]!.on + 1)
      const shape = lineOf(run.map((v): P => [v.x, v.y]))
      const inner = run.slice(1, -1).map((v, j) => ({ s: shape.s[j + 1]!, v }))
      for (let i = kept[g]!.at + 1; i < kept[g + 1]!.at; i++) {
        const f = footOn(shape, pts[i]!.x, pts[i]!.y),
          v = { ...pts[i]!, x: f.x, y: f.y }
        slid.set(i, v)
        inner.push({ s: f.s, v })
      }
      inner.sort((a, b) => a.s - b.s)
      line.push(...inner.map((it) => it.v), run.at(-1)!)
    }
    return { line, slid }
  }
}
