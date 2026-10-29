// Smoothing of the rail where no CTR track guides it between two stretches it does (tunnels):
// OSM draws those curves with few vertices (a 16° bend at the Terma tunnel's north portal), so the
// displaced OSM line is replaced by a smoothing spline that keeps its ends and, through two anchor
// points beyond each end, the CTR track's heading there.
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
