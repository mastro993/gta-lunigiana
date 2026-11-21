// Terrain for the map build: the 4 m node grid (its nodes averaged from the DTM, dtm.ts), river
// carving, road flattening along smoothed, grade-clamped profiles.
import { Ops } from "@typeonce/ritmo-math"

import { arcLengths, segDist2, type V } from "./geometry.ts"
import { REGION, type Region } from "./region.ts"

/** A block of the grid's nodes by whole-grid index: columns i0 … i0 + cols − 1, rows j0 … j0 + rows − 1. */
export interface Span {
  readonly i0: number
  readonly j0: number
  readonly cols: number
  readonly rows: number
}

/**
 * The terrain grid, or a window of it: `cell`, `cols`, `rows`, `x0` and `y0` are always the whole
 * grid's, so every position and clamp is worked out as on the whole grid, bit for bit.
 */
export interface Grid {
  readonly cell: number
  readonly cols: number
  readonly rows: number
  readonly x0: number
  readonly y0: number
  /**
   * The region's anchor (region.ts), a node of the whole grid's lattice: a point's cell and its
   * fraction of it are measured from there, so they keep their bits however far the grid reaches.
   */
  readonly ax: number
  readonly ay: number
  /** Elevations of the nodes `span` holds, row-major, row 0 = south. */
  readonly z: Float64Array
  /** The nodes `z` holds; the whole grid when absent. */
  readonly span?: Span
}

/**
 * The finished terrain grid, whole, each node in the whole decimetres the file ships (`decimetre`),
 * which the phases after the terrain read as `dm / 10` m: the metres the tile pass rounded it to
 * (`Math.round(z * 10) / 10`), bit for bit, in a quarter of the bytes (Lunigiana's 45 million nodes
 * as 362 MB of `Float64Array` held the world phase 0.27 GB higher).
 */
export interface DmGrid extends Omit<Grid, "z" | "span"> {
  readonly dm: Int16Array
}

/** Height `z` m of whole-grid node (i, j) in whole decimetres, checked to fit int16 (a NaN or a height past ±3276.7 m throws). */
export const decimetre = (z: number, i: number, j: number): number => {
  const v = Math.round(z * 10)
  if (!(v >= -32768 && v <= 32767))
    throw new Error(`heightmap: ${v} at node (${i}, ${j}) does not fit int16`)
  return v
}

/**
 * The cell (0 … n − 2) of a lattice of `n` nodes that holds the point `f` cells past its node `o`,
 * clamped to the lattice. `o` goes on the whole cells alone, so the point's fraction of its cell
 * (`fractionOf`) keeps its bits however far the lattice reaches past `o`.
 */
export const cellOf = (f: number, o: number, n: number): number =>
  Math.min(n - 2, Math.max(0, Math.floor(f) + o))

/** The fraction, clamped to 0 … 1, of cell `i` (`cellOf`) at the point `f` cells past node `o`. */
export const fractionOf = (f: number, o: number, i: number): number =>
  Math.min(1, Math.max(0, f - (i - o)))

/** Half-width of the box each node averages, m: a 5 m square of 1 m samples, about one cell. */
export const BOX = 2

/** The terrain grid's cell, m. */
export const GRID_CELL = 4

/** The built terrain's box and the anchor its arithmetic is measured from: a region's (`REGION`). */
export type Ground = Pick<Region, "bounds" | "anchor">

/** The whole grid over `ground`'s box (its last row/col reaches maxX/maxY), with no nodes: the lattice every window of it shares. */
export const gridLattice = ({ bounds, anchor }: Ground = REGION): Omit<Grid, "z" | "span"> => {
  const { minX: x0, minY: y0 } = bounds
  if (
    !Number.isInteger((anchor.x - x0) / GRID_CELL) ||
    !Number.isInteger((anchor.y - y0) / GRID_CELL)
  )
    throw new Error(
      `the anchor (${anchor.x}, ${anchor.y}) is off the ${GRID_CELL} m grid from (${x0}, ${y0})`,
    )
  return {
    cell: GRID_CELL,
    cols: Math.ceil((bounds.maxX - x0) / GRID_CELL) + 1,
    rows: Math.ceil((bounds.maxY - y0) / GRID_CELL) + 1,
    x0,
    y0,
    ax: anchor.x,
    ay: anchor.y,
  }
}

/** The whole-grid column and row of `g`'s anchor (a node, maybe off the grid): the `o` of `cellOf`. */
export const anchorNode = (g: Omit<Grid, "z" | "span">): readonly [number, number] => [
  (g.ax - g.x0) / g.cell,
  (g.ay - g.y0) / g.cell,
]

/** The window of the whole grid's nodes `span` holds, each the mean of `dem` over a (2 BOX + 1) m square. */
export const makeGrid = (dem: (x: number, y: number) => number, span: Span): Grid => {
  const lattice = gridLattice(),
    { cell, x0, y0 } = lattice
  const { i0, j0, cols: w, rows: h } = span
  const z = new Float64Array(w * h)
  for (let j = j0; j < j0 + h; j++)
    for (let i = i0; i < i0 + w; i++) {
      let s = 0
      for (let dy = -BOX; dy <= BOX; dy++)
        for (let dx = -BOX; dx <= BOX; dx++) s += dem(x0 + i * cell + dx, y0 + j * cell + dy)
      z[(j - j0) * w + i - i0] = s / (2 * BOX + 1) ** 2
    }
  return { ...lattice, z, span }
}

/** Index in `g.z` of whole-grid node (i, j), which `g` must hold. */
export const slotOf = (
  g: { readonly cols: number; readonly span?: Span },
  i: number,
  j: number,
): number => (g.span === undefined ? j * g.cols + i : (j - g.span.j0) * g.span.cols + i - g.span.i0)

/**
 * Bilinear terrain at (x, y), clamped to the whole grid, measured from its anchor (the same bits on
 * any grid round it); `g` must hold the four nodes of the cell read.
 */
export const sampleGrid = (g: Grid | DmGrid, x: number, y: number): number => {
  const fx = (x - g.ax) / g.cell,
    fy = (y - g.ay) / g.cell,
    oi = (g.ax - g.x0) / g.cell,
    oj = (g.ay - g.y0) / g.cell
  const i = cellOf(fx, oi, g.cols),
    j = cellOf(fy, oj, g.rows)
  const tx = fractionOf(fx, oi, i),
    ty = fractionOf(fy, oj, j)
  const k = slotOf(g, i, j),
    up = "dm" in g ? g.cols : (g.span?.cols ?? g.cols)
  // A decimetre grid's nodes in metres; a window's as they are (`z / 1` is `z`, bit for bit).
  const nodes = "dm" in g ? g.dm : g.z,
    per = "dm" in g ? 10 : 1
  const sw = nodes[k]! / per,
    se = nodes[k + 1]! / per,
    nw = nodes[k + up]! / per,
    ne = nodes[k + up + 1]! / per
  const s = sw + (se - sw) * tx,
    n = nw + (ne - nw) * tx
  return s + (n - s) * ty
}

/** Slope in degrees of cell (i, j) (between nodes (i, j) and (i+1, j+1)) of the whole grid `g`, over a 3-cell (12 m) baseline: shorter steps (terrace walls, road cuts) are not slopes the player is stopped by. */
export const cellSlope = (g: DmGrid, i: number, j: number): number => {
  const z = (a: number, b: number) =>
    g.dm[Math.min(g.rows - 1, Math.max(0, b)) * g.cols + Math.min(g.cols - 1, Math.max(0, a))]! / 10
  const dx = (z(i + 2, j) + z(i + 2, j + 1) - z(i - 1, j) - z(i - 1, j + 1)) / (6 * g.cell)
  const dy = (z(i, j + 2) + z(i + 1, j + 2) - z(i, j - 1) - z(i + 1, j - 1)) / (6 * g.cell)
  return (Ops.atan(Math.hypot(dx, dy)) * 180) / Math.PI
}

/** Visits the nodes `g` holds within `r` of segment a-b, by their index in `g.z`, with their distance, projection parameter and place. */
const forNodesNear = (
  g: Grid,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
  visit: (k: number, d: number, t: number, x: number, y: number) => void,
) => {
  const {
    i0: si,
    j0: sj,
    cols: w,
    rows: h,
  } = g.span ?? { i0: 0, j0: 0, cols: g.cols, rows: g.rows }
  const [oi, oj] = anchorNode(g)
  const i0 = Math.max(si, Math.floor((Math.min(ax, bx) - r - g.ax) / g.cell) + oi),
    i1 = Math.min(si + w - 1, Math.ceil((Math.max(ax, bx) + r - g.ax) / g.cell) + oi)
  const j0 = Math.max(sj, Math.floor((Math.min(ay, by) - r - g.ay) / g.cell) + oj),
    j1 = Math.min(sj + h - 1, Math.ceil((Math.max(ay, by) + r - g.ay) / g.cell) + oj)
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const x = g.x0 + i * g.cell,
        y = g.y0 + j * g.cell
      const { d2, t } = segDist2(x, y, ax, ay, bx, by)
      if (d2 <= r * r) visit((j - sj) * w + i - si, Math.sqrt(d2), t, x, y)
    }
}

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
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

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

/**
 * Lowers the terrain along a water-surface profile: the bed `depth`/2 below the surface inside w/2,
 * a gravel slope to `bed`, then a one-cell bank back to the terrain. Uses min(), so a node only goes
 * down, but the bank leads back to the node's height as it stands, so carving again (the tile pass
 * carves every line twice, `build-grid.ts`) or after another line lowers a bank node again; nodes
 * with `keep(n)` (road cores) are left alone.
 */
export const carve = (
  g: Grid,
  p: Profile,
  w: number,
  bed: number,
  depth: number,
  keep: (n: number) => boolean = () => false,
): void => {
  const reach = bed + g.cell
  for (let k = 0; k + 1 < p.z.length; k++)
    forNodesNear(g, p.x[k]!, p.y[k]!, p.x[k + 1]!, p.y[k + 1]!, reach, (n, d, t) => {
      const surface = lerp(p.z[k]!, p.z[k + 1]!, t),
        floor = surface - depth / 2,
        gravel = surface + depth / 4
      const z =
        d <= w / 2
          ? floor
          : d <= bed
            ? lerp(floor, gravel, (d - w / 2) / Math.max(1e-6, bed - w / 2))
            : lerp(gravel, g.z[n]!, (d - bed) / g.cell)
      if (z < g.z[n]! && !keep(n)) g.z[n] = z
    })
}

/**
 * Writes a road profile into the grid: nodes within the core of their nearest segment (`core[k]`
 * for the segment from sample k, its own piece's) take the road elevation, the next `blend` m fade
 * back to the terrain. `owner` holds the rank of the road that wrote each core
 * node (255 = none): ranks <= `rank` win, so earlier (higher) classes keep junctions.
 * `protect` marks river nodes no road may touch; segments from sample k with `skip(k)` (bridges, tunnels) write nothing,
 * and nodes where `at` is false neither. A node whose nearest point lies past a sample where
 * `deckEnd` holds (its core's round end reaching on under the bridge's deck) is under the deck, no
 * approach's: the core takes it only where no other core holds it (or only another such end, at a
 * lower rank), and any other core takes it back, whatever their ranks; `capped` marks those nodes.
 * Behind the deck's end the approach keeps its core: its surface, floating over lower ground, would
 * lift a walker there onto the deck. At its rank the A15's approach (0, its core 7.3 m) held the
 * ground under its deck's first span at Aulla 5–7 m over the tracks and the SP20 passing there.
 */
export const flatten = (
  g: Grid,
  p: Profile,
  core: ArrayLike<number>,
  blend: number,
  rank: number,
  owner: Uint8Array,
  protect: Uint8Array,
  skip: (k: number) => boolean,
  at: (x: number, y: number) => boolean = () => true,
  deckEnd: (k: number) => boolean = () => false,
  capped: Uint8Array = new Uint8Array(owner.length),
): void => {
  const best = new Map<number, { d: number; z: number; c: number; past: boolean }>()
  for (let k = 0; k + 1 < p.z.length; k++)
    if (!skip(k))
      forNodesNear(
        g,
        p.x[k]!,
        p.y[k]!,
        p.x[k + 1]!,
        p.y[k + 1]!,
        core[k]! + blend,
        (n, d, t, x, y) => {
          if (!at(x, y)) return
          const cur = best.get(n)
          if (cur === undefined || d < cur.d)
            best.set(n, {
              d,
              z: lerp(p.z[k]!, p.z[k + 1]!, t),
              c: core[k]!,
              past: (t === 1 && deckEnd(k + 1)) || (t === 0 && deckEnd(k)),
            })
        },
      )
  for (const [n, { d, z, c, past }] of [...best].sort((a, b) => a[0] - b[0])) {
    if (protect[n] === 1) continue
    if (d <= c) {
      const takes = past
        ? owner[n] === 255 || (capped[n] === 1 && owner[n]! > rank)
        : owner[n]! > rank || capped[n] === 1
      if (!takes) continue
      g.z[n] = z
      owner[n] = rank
      capped[n] = past ? 1 : 0
    } else if (owner[n] === 255) g.z[n] = lerp(z, g.z[n]!, (d - c) / blend)
  }
}
