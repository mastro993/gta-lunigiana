// Matches a drawn track (OSM's rail) to the CTR's surveyed track centrelines: samples along it,
// the nearest point of each CTR track within reach, and a Viterbi pass that keeps one sample run
// on one CTR track through parallel stretches (station loops, sidings beside the line).
import { arcLengths, segDist2, type P, type V } from "./geometry.ts"

/** A polyline with its arc length at each vertex. */
export interface Line {
  readonly pts: ReadonlyArray<P>
  readonly s: ReadonlyArray<number>
}

/** A polyline as a `Line`. */
export const lineOf = (pts: ReadonlyArray<P>): Line => ({
  pts,
  s: arcLengths(pts.map(([x, y]) => ({ x, y }))),
})

/**
 * The point of a line nearest a query point: where it is, how far, its arc length and unit
 * tangent; `over` is how far past an end of the line the query point lies along it (0 beside it).
 */
export interface Foot {
  readonly x: number
  readonly y: number
  readonly d: number
  readonly s: number
  readonly tx: number
  readonly ty: number
  readonly over: number
}

/** The point of `line` nearest (x, y); on a tie, the earliest segment. */
export const footOn = (line: Line, x: number, y: number): Foot => {
  const { pts, s } = line
  let best = 0,
    bestT = 0,
    bestD2 = Number.MAX_VALUE
  for (let i = 0; i + 1 < pts.length; i++) {
    const { d2, t } = segDist2(x, y, pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1])
    if (d2 < bestD2) [best, bestT, bestD2] = [i, t, d2]
  }
  const a = pts[best]!,
    b = pts[best + 1]!,
    len = s[best + 1]! - s[best]! || 1
  const along = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / len
  const over =
    best === 0 && along < 0 ? -along : best + 2 === pts.length && along > len ? along - len : 0
  return {
    x: a[0] + (b[0] - a[0]) * bestT,
    y: a[1] + (b[1] - a[1]) * bestT,
    d: Math.sqrt(bestD2),
    s: s[best]! + len * bestT,
    tx: (b[0] - a[0]) / len,
    ty: (b[1] - a[1]) / len,
    over,
  }
}

/** The point of `line` at arc length `at` (clamped to the line). */
export const pointOn = (line: Line, at: number): P => {
  const { pts, s } = line
  let i = 1
  while (i < pts.length - 1 && s[i]! < at) i++
  const t = Math.max(0, Math.min(1, (at - s[i - 1]!) / (s[i]! - s[i - 1]! || 1)))
  return [
    pts[i - 1]![0] + (pts[i]![0] - pts[i - 1]![0]) * t,
    pts[i - 1]![1] + (pts[i]![1] - pts[i - 1]![1]) * t,
  ]
}

/** Douglas–Peucker on an open polyline: the vertices to keep so that it stays within `tol` m of every one dropped. */
export const simplifyLine = (pts: ReadonlyArray<P>, tol: number): Array<P> => {
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const rec = (a: number, b: number) => {
    let worst = tol * tol,
      at = -1
    for (let k = a + 1; k < b; k++) {
      const { d2 } = segDist2(
        pts[k]![0],
        pts[k]![1],
        pts[a]![0],
        pts[a]![1],
        pts[b]![0],
        pts[b]![1],
      )
      if (d2 > worst) [worst, at] = [d2, k]
    }
    if (at < 0) return
    keep[at] = 1
    rec(a, at)
    rec(at, b)
  }
  rec(0, pts.length - 1)
  return pts.filter((_, k) => keep[k] === 1)
}

/** Where segment a–b crosses polyline `pts`: the point, the polyline's segment index and the parameter along a–b. */
export const hitsOn = (
  pts: ReadonlyArray<V>,
  a: V,
  b: V,
): Array<{ readonly x: number; readonly y: number; readonly i: number; readonly u: number }> => {
  const out: Array<{ x: number; y: number; i: number; u: number }> = []
  const fx = b.x - a.x,
    fy = b.y - a.y
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!,
      ex = pts[i + 1]!.x - p.x,
      ey = pts[i + 1]!.y - p.y,
      den = ex * fy - ey * fx
    if (den === 0) continue
    const t = ((a.x - p.x) * fy - (a.y - p.y) * fx) / den,
      u = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push({ x: p.x + ex * t, y: p.y + ey * t, i, u })
  }
  return out
}

/**
 * Puts `v` (a point on the polyline) into it and returns its index: a vertex already there (within
 * 1 µm) takes its place, so no segment has zero length; else it goes after the vertex that starts
 * the segment nearest it. Throws when the vertex already there carries another id.
 */
export const insertOn = (pts: Array<V>, v: V): number => {
  const same = pts.findIndex((u) => Math.hypot(u.x - v.x, u.y - v.y) < 1e-6)
  if (same >= 0) {
    const was = pts[same]!.id
    if (was !== undefined && was !== v.id) throw new Error(`vertex ${v.id} falls on vertex ${was}`)
    pts[same] = v
    return same
  }
  let best = 0,
    bestD2 = Number.MAX_VALUE
  for (let i = 0; i + 1 < pts.length; i++) {
    const { d2 } = segDist2(v.x, v.y, pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y)
    if (d2 < bestD2) [best, bestD2] = [i, d2]
  }
  pts.splice(best + 1, 0, v)
  return best + 1
}

/** Shortest segment a track keeps between two vertices of which one has no id, m. */
export const MIN_SEG = 2

/** A dropped vertex may lie this far (m) from the polyline left without it, else it stays. */
const PRUNE_TOL = 0.25

/**
 * The polyline without the vertices it does not `need` that lie closer than `min` m to a kept
 * neighbour, as long as each lies within PRUNE_TOL of what is left; its ends stay. On the map's
 * 0.1 m grid a short segment's heading is noise (±2.9° at 2 m, ±11° at 0.5 m), so a track keeps
 * no short segment it does not need.
 */
export const pruneShort = (
  pts: ReadonlyArray<V>,
  min: number,
  need: (v: V) => boolean = (v) => v.id !== undefined,
): Array<V> => {
  const fixed = pts.map((v, i) => need(v) || i === 0 || i === pts.length - 1)
  const keep = [...fixed]
  const far = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y) >= min
  for (let i = 1, last = 0; i < pts.length - 1; i++)
    if (keep[i] || far(pts[i]!, pts[last]!)) [keep[i], last] = [true, i]
  for (let i = pts.length - 2, next = pts.length - 1; i > 0; i--) {
    if (!keep[i]) continue
    if (!fixed[i] && !far(pts[i]!, pts[next]!)) keep[i] = false
    else next = i
  }
  const kept = keep.flatMap((k, i) => (k ? [i] : []))
  for (let j = 0; j + 1 < kept.length; j++) {
    const a = pts[kept[j]!]!,
      b = pts[kept[j + 1]!]!
    for (let i = kept[j]! + 1; i < kept[j + 1]!; i++)
      if (segDist2(pts[i]!.x, pts[i]!.y, a.x, a.y, b.x, b.y).d2 > PRUNE_TOL ** 2) keep[i] = true
  }
  return pts.filter((_, i) => keep[i])
}

/** A point along the drawn track: position, unit tangent and whether it may match (tunnels may not). */
export interface Sample {
  readonly x: number
  readonly y: number
  readonly tx: number
  readonly ty: number
  readonly free: boolean
}

/**
 * Matching rules: a CTR track is a candidate for a sample within `reach` m whose heading agrees
 * within `angle` degrees (either way along it), beside it and not more than `past` m beyond one of
 * its ends (where the survey stops, before tunnel portals and where the sheets stop mapping, the
 * drawn track runs on alone); the cost of a match is its distance, a sample with no match costs
 * `miss`, and moving from one CTR track to another (gaps between them included) costs `change`. OSM
 * lies up to 5.3 m off the surveyed track; turnouts diverge at about 5°, so only the cost keeps a
 * sample run off a parallel track.
 */
const MATCH = { reach: 8, angle: 20, past: 0.5, miss: 6, change: 30 }

/** A sample's match: the CTR track (index into the tracks) and the foot on it, or none (track −1). */
interface Match {
  readonly track: number
  readonly foot?: Foot
}

/**
 * The cheapest sequence of matches for `samples` over `tracks` (Viterbi), with `allowed(track)`
 * saying which tracks may match at all. The state is the track matched, or no match plus the
 * last track matched before it, so a gap does not dodge the change cost. Ties go to the lower
 * track index (the tracks come in sheet, record and part order) and to staying on a track. Only
 * reachable states are kept and only tracks whose box is within reach are measured, so the cost
 * grows with the tracks near the samples, not with every track of the map.
 */
export const matchSamples = (
  samples: ReadonlyArray<Sample>,
  tracks: ReadonlyArray<Line>,
  allowed: (track: number) => boolean = () => true,
  rules = MATCH,
): Array<Match> => {
  const n = tracks.length,
    cosMax = Math.cos((rules.angle * Math.PI) / 180)
  // State k < n: matched on track k; state n + 1 + k: no match, last matched track k; state n: no match yet.
  const lastOf = (st: number) => (st < n ? st : st === n ? -1 : st - n - 1)
  const boxes = tracks.map(({ pts }) => {
    const xs = pts.map((p) => p[0]),
      ys = pts.map((p) => p[1])
    return [
      Math.min(...xs) - rules.reach,
      Math.min(...ys) - rules.reach,
      Math.max(...xs) + rules.reach,
      Math.max(...ys) + rules.reach,
    ] as const
  })
  /** Per sample, the candidate tracks (ascending) and their feet. */
  const feet: Array<Map<number, Foot>> = samples.map((p) => {
    const out = new Map<number, Foot>()
    if (p.free) return out
    tracks.forEach((line, k) => {
      const [x0, y0, x1, y1] = boxes[k]!
      if (!allowed(k) || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) return
      const f = footOn(line, p.x, p.y)
      if (
        f.d <= rules.reach &&
        f.over <= rules.past &&
        Math.abs(f.tx * p.tx + f.ty * p.ty) >= cosMax
      )
        out.set(k, f)
    })
    return out
  })
  /** Each reachable state's cost, and per sample the state each came from. */
  let cost = new Map<number, number>([[n, rules.miss]])
  for (const [k, f] of feet[0]!) cost.set(k, f.d)
  const back: Array<Map<number, number>> = [new Map([...cost.keys()].map((st) => [st, -1]))]
  for (let i = 1; i < samples.length; i++) {
    const prev = [...cost].sort((a, b) => a[0] - b[0])
    const next = new Map<number, number>(),
      from = new Map<number, number>()
    /** Keeps the cheaper way into `st`; on a tie, staying in it (predecessors come in ascending order). */
    const offer = (st: number, pr: number, c: number) => {
      const was = next.get(st)
      if (was === undefined || c < was || (c === was && pr === st)) {
        next.set(st, c)
        from.set(st, pr)
      }
    }
    for (const [st, f] of feet[i]!)
      for (const [pr, c] of prev) {
        const was = lastOf(pr)
        offer(st, pr, c + (was === -1 || was === st ? 0 : rules.change) + f.d)
      }
    for (const [pr, c] of prev) {
      // "No match yet" only continues itself; no match keeps the last track matched.
      if (pr === n) offer(n, pr, c + rules.miss)
      else offer(n + 1 + lastOf(pr), pr, c + rules.miss)
    }
    cost = next
    back.push(from)
  }
  let st = -1
  for (const [k, c] of cost)
    if (st < 0 || c < cost.get(st)! || (c === cost.get(st)! && k < st)) st = k
  const out: Array<Match> = []
  for (let i = samples.length - 1; i >= 0; i--) {
    out.push(st < n ? { track: st, foot: feet[i]!.get(st)! } : { track: -1 })
    st = back[i]!.get(st)!
  }
  return out.reverse()
}
