// The profile fit for the map build: a line resampled into a profile every few metres (`resample`),
// smoothed, fitted to a grade limit through hard pins and bounds (`fitProfile`), and thinned to the
// samples whose straight lines keep within a tolerance of it (`keepSamples`). terrain.ts writes the
// fitted profiles into the terrain grid.
import { arcLengths, type V } from "./geometry.ts"

/** A polyline resampled every ~`step` m: positions, arc lengths and the sample index of each original vertex. */
export interface Profile {
  readonly x: Array<number>
  readonly y: Array<number>
  readonly s: Array<number>
  readonly z: Float64Array
  readonly vertexSample: Array<number>
}

export const resample = (
  pts: ReadonlyArray<V>,
  step: number,
  zAt: (x: number, y: number) => number,
): Profile => {
  const s = arcLengths(pts)
  const x: Array<number> = [],
    y: Array<number> = [],
    ss: Array<number> = [],
    vertexSample: Array<number> = []
  for (let i = 0; i < pts.length; i++) {
    vertexSample.push(x.length)
    x.push(pts[i]!.x)
    y.push(pts[i]!.y)
    ss.push(s[i]!)
    if (i + 1 === pts.length) break
    const len = s[i + 1]! - s[i]!,
      n = Math.floor(len / step)
    for (let k = 1; k < n; k++) {
      const t = k / n
      x.push(pts[i]!.x + (pts[i + 1]!.x - pts[i]!.x) * t)
      y.push(pts[i]!.y + (pts[i + 1]!.y - pts[i]!.y) * t)
      ss.push(s[i]! + len * t)
    }
  }
  return { x, y, s: ss, z: Float64Array.from(x, (xi, k) => zAt(xi, y[k]!)), vertexSample }
}

/** Linear interpolation from a (t = 0) to b (t = 1). */
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Samples of `p` to keep between samples `from` and `to` so that straight lines between kept
 * samples stay within `tol` m of the profile: the `fixed` samples (OSM vertices) plus a
 * Douglas-Peucker pick in (s, z) between each pair of them.
 */
export const keepSamples = (
  p: Profile,
  fixed: ReadonlyArray<number>,
  tol = 0.25,
): Array<number> => {
  const keep = new Set(fixed)
  const rec = (a: number, b: number) => {
    let worst = tol,
      at = -1
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs(
        p.z[k]! - lerp(p.z[a]!, p.z[b]!, (p.s[k]! - p.s[a]!) / (p.s[b]! - p.s[a]! || 1)),
      )
      if (d > worst) [worst, at] = [d, k]
    }
    if (at < 0) return
    keep.add(at)
    rec(a, at)
    rec(at, b)
  }
  for (let i = 0; i + 1 < fixed.length; i++) rec(fixed[i]!, fixed[i + 1]!)
  return [...keep].sort((x, y) => x - y)
}

/** Moving average over +-`half` m of arc length (window shrinks at the ends). */
export const smooth = (p: Profile, half: number): void => {
  const out = new Float64Array(p.z.length)
  let lo = 0,
    hi = 0,
    sum = 0
  for (let k = 0; k < p.z.length; k++) {
    while (hi < p.z.length && p.s[hi]! <= p.s[k]! + half) sum += p.z[hi++]!
    while (p.s[lo]! < p.s[k]! - half) sum -= p.z[lo++]!
    out[k] = sum / (hi - lo)
  }
  p.z.set(out)
}

/** Hard elevation at sample `k`; `min`/`max` make it a bound that only binds when the fit crosses it. */
export interface Pin {
  readonly k: number
  readonly z: number
  readonly kind?: "min" | "max"
}

const FADE = 30 // m over which a pin pulls the profile before the grade fit
const CAP = 4 // m a fitted profile may stray from the smoothed ground before its grade limit is relaxed there
/** Largest factor a fit raises a grade limit by, unless its pass sets its own (tertiary 15%, rail 3.75%). */
export const RELAX = 1.5
const RELAX_REACH = 60 // m around a stray sample whose segments get relaxed

/** Envelope of z within the grade budget `t` (cumulative grade x arc length): `dir` = 1 the highest profile at or below z, -1 the lowest at or above. */
const envelope = (t: Float64Array, z: Float64Array, dir: 1 | -1): Float64Array => {
  const e = Float64Array.from(z)
  for (let k = 1; k < e.length; k++)
    e[k] = dir * Math.min(dir * e[k]!, dir * e[k - 1]! + t[k]! - t[k - 1]!)
  for (let k = e.length - 2; k >= 0; k--)
    e[k] = dir * Math.min(dir * e[k]!, dir * e[k + 1]! + t[k + 1]! - t[k]!)
  return e
}

/** One fit through hard pins: pins pulled in over FADE m, midpoint of the two grade envelopes (cut and fill split evenly), then each stretch clamped into its two pins' cones. */
const fitOnce = (
  p: Profile,
  natural: Float64Array,
  t: Float64Array,
  pins: ReadonlyArray<Pin>,
): void => {
  const z = Float64Array.from(natural)
  for (let k = 0; k < z.length; k++) {
    let wsum = 0,
      dsum = 0
    for (const pn of pins) {
      const w = Math.max(0, 1 - Math.abs(p.s[k]! - p.s[pn.k]!) / FADE)
      wsum += w
      dsum += w * (pn.z - natural[pn.k]!)
    }
    z[k] = z[k]! + dsum / Math.max(1, wsum)
  }
  const lo = envelope(t, z, 1),
    hi = envelope(t, z, -1)
  for (let k = 0; k < z.length; k++) z[k] = (lo[k]! + hi[k]!) / 2
  const sorted = [...pins].sort((a, b) => a.k - b.k)
  for (let k = 0, i = -1; k < z.length; k++) {
    while (i + 1 < sorted.length && sorted[i + 1]!.k <= k) i++
    const a = sorted[i],
      b = sorted[i + 1]
    const da = a ? t[k]! - t[a.k]! : 0,
      db = b ? t[b.k]! - t[k]! : 0
    const up = Math.min(a ? a.z + da : Number.MAX_VALUE, b ? b.z + db : Number.MAX_VALUE)
    const down = Math.max(a ? a.z - da : -Number.MAX_VALUE, b ? b.z - db : -Number.MAX_VALUE)
    if (down <= up + 1e-9) z[k] = Math.min(up, Math.max(down, z[k]!))
    else if (a && b) z[k] = lerp(a.z, b.z, (p.s[k]! - p.s[a.k]!) / (p.s[b.k]! - p.s[a.k]!)) // conflicting pins: a straight line
  }
  p.z.set(z)
}

/**
 * How far every pin and bound of a fit, each at its own level, lets the profile stand within the
 * grade budget `t`, by sample: `lo` the lowest level the pins and the minimums leave it, `hi` the
 * highest the pins and the maximums do.
 */
const reachOf = (
  pins: ReadonlyArray<Pin>,
  t: Float64Array,
): { readonly lo: Float64Array; readonly hi: Float64Array } => {
  const lo = new Float64Array(t.length).fill(-Infinity),
    hi = new Float64Array(t.length).fill(Infinity)
  for (const { k, z, kind } of pins) {
    if (kind !== "max") lo[k] = Math.max(lo[k]!, z)
    if (kind !== "min") hi[k] = Math.min(hi[k]!, z)
  }
  return { lo: envelope(t, lo, -1), hi: envelope(t, hi, 1) }
}

/**
 * The pins a fit holds, in `hard`'s order: each at its level, but a broken bound (`kinds`, by sample)
 * past it where the broken bounds beside it, with no other pin between, reach within the grade budget
 * `t`: a minimum raised to the reach down from them and a maximum lowered to the reach up, so that two
 * bounds the fit broke side by side are met within the grade rather than in a step between them.
 * Pinned each at its own level, the A12's Livorno carriageway kept its Vara bridge's end at 29.56 m,
 * 5.5 m over the road under it, and the sample 4.2 m on at its twin's level less 1.5 m, 28.06 m: the
 * straight line between the two fell 36%. None is moved past what every other pin and bound at its
 * own level allows within the grade (`reach`, `reachOf`): a minimum is raised no higher than the
 * reach of the maximums and the pins (a junction's, a chain's end's), the maximum at its own sample
 * among them, and a maximum lowered no lower than the minimums' and the pins'. Raised past a
 * junction's reach, a bound of the SS330's ramp 1388645825 at Albiano took up the climb from that
 * junction to the one 17.6 m away, and left the 5.6 m 1250443404 before it climbing 87%; raised past
 * the maximum at its own sample, which a pinned sample no longer checks, a track's minimum beside
 * its twin left the rail 206182844 falling 36.6% at (−19005, −3660), its twins 3.63 m apart.
 * Nor is a bound raised from a junction's pin: its level is set.
 */
const heldPins = (
  hard: ReadonlyMap<number, number>,
  kinds: ReadonlyMap<number, "min" | "max">,
  t: Float64Array,
  reach: { readonly lo: Float64Array; readonly hi: Float64Array },
): Array<Pin> => {
  const at = new Map(hard)
  const ks = [...hard.keys()].sort((a, b) => a - b)
  for (const order of [ks, [...ks].reverse()]) {
    let last: number | undefined
    for (const k of order) {
      const kind = kinds.get(k)
      if (kind !== undefined && last !== undefined) {
        const by = Math.abs(t[k]! - t[last]!),
          from = at.get(last)!,
          own = hard.get(k)!
        at.set(
          k,
          kind === "min"
            ? Math.max(own, Math.min(Math.max(at.get(k)!, from - by), reach.hi[k]!))
            : Math.min(own, Math.max(Math.min(at.get(k)!, from + by), reach.lo[k]!)),
        )
      }
      last = kind === undefined ? undefined : k
    }
  }
  return [...hard.keys()].map((k) => ({ k, z: at.get(k)! }))
}

/**
 * Grade-limited fit of the (smoothed) profile through `pins`. Violated bounds become pins, held
 * within the grade of the pins beside them (`heldPins`), and the fit is redone; where it strays more
 * than CAP m from the smoothed ground, the grade limit of the surrounding RELAX_REACH m is raised
 * step by step, up to `relax` times `grade`.
 */
export const fitProfile = (
  p: Profile,
  grade: number,
  pins: ReadonlyArray<Pin>,
  relax = RELAX,
): void => {
  const natural = Float64Array.from(p.z),
    n = p.z.length
  const g = new Float64Array(Math.max(0, n - 1)).fill(grade)
  const hard = new Map<number, number>()
  for (const pn of pins) if (pn.kind === undefined && !hard.has(pn.k)) hard.set(pn.k, pn.z)
  const bounds = pins.filter((pn) => pn.kind !== undefined)
  /** The kind of each bound broken and pinned, by its sample. */
  const kinds = new Map<number, "min" | "max">()
  for (let round = 0; round < 12; round++) {
    const t = new Float64Array(n)
    for (let k = 1; k < n; k++) t[k] = t[k - 1]! + g[k - 1]! * (p.s[k]! - p.s[k - 1]!)
    fitOnce(p, natural, t, heldPins(hard, kinds, t, reachOf(pins, t)))
    const broken = bounds.filter(
      (b) => !hard.has(b.k) && (b.kind === "min" ? p.z[b.k]! < b.z - 1e-6 : p.z[b.k]! > b.z + 1e-6),
    )
    for (const b of broken) {
      hard.set(b.k, b.z)
      kinds.set(b.k, b.kind!)
    }
    let relaxed = false
    for (let k = 0; k < n; k++) {
      if (Math.abs(p.z[k]! - natural[k]!) <= CAP) continue
      for (let j = 0; j + 1 < n; j++)
        if (Math.abs(p.s[j]! - p.s[k]!) <= RELAX_REACH && g[j]! < grade * relax)
          [g[j], relaxed] = [Math.min(grade * relax, g[j]! * 1.1), true]
    }
    if (broken.length === 0 && !relaxed) return
  }
}
