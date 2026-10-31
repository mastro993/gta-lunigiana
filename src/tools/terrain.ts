// Terrain for the map build: LiDAR DTM -> 4 m node grid, river carving, road flattening along
// smoothed, grade-clamped profiles.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { inflateSync } from "node:zlib"

import { latLonToGaussBoaga } from "./crs.ts"
import { arcLengths, BOUNDS, fromLocal, segDist2, type V } from "./geometry.ts"

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
  /** Elevations of the nodes `span` holds, row-major, row 0 = south. */
  readonly z: Float64Array
  /** The nodes `z` holds; the whole grid when absent. */
  readonly span?: Span
}

/** Lattice step, m, on which local -> Gauss-Boaga is computed exactly; bilinear in between is exact to well under 1 mm. */
const PROJ_STEP = 50

/**
 * The uncarved terrain: m a.s.l. at a local point (`at`), and a window of the grid's nodes, each
 * the mean of `at` over the box `makeGrid` averages (`grid`).
 */
export interface Dem {
  readonly at: (x: number, y: number) => number
  readonly grid: (span: Span) => Grid
}

/** Samples a geographic GeoTIFF at pixel centres, rejecting missing terrain rather than inventing heights. */
export const loadGeoDtm = async (file: string): Promise<Dem> => {
  const { fromArrayBuffer } = await import("geotiff")
  const bytes = readFileSync(file)
  const tiff = await fromArrayBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  )
  const image = await tiff.getImage()
  const keys = image.getGeoKeys()
  if (
    keys === null ||
    keys.GeographicTypeGeoKey !== 4326 ||
    keys.ProjectedCSTypeGeoKey !== undefined
  )
    throw new Error("DTM must use EPSG:4326")
  const [west, south, east, north] = image.getBoundingBox()
  const cols = image.getWidth(),
    rows = image.getHeight()
  if (cols < 2 || rows < 2 || image.getSamplesPerPixel() !== 1)
    throw new Error("Invalid DTM dimensions")
  for (const [x, y] of [
    [BOUNDS.minX - 4, BOUNDS.minY - 4],
    [BOUNDS.maxX + 4, BOUNDS.maxY + 4],
  ]) {
    const [lat, lon] = fromLocal(x!, y!)
    if (lon < west! || lon > east! || lat < south! || lat > north!)
      throw new Error("DTM does not cover the play area")
  }
  const samples = await image.readRasters({ interleave: true })
  const noData = image.getGDALNoData()
  if (Array.from(samples).some((z) => !Number.isFinite(z) || z === noData || z < -500 || z > 3000))
    throw new Error("DTM contains missing or invalid heights")
  const at = (x: number, y: number) => {
    const [lat, lon] = fromLocal(x, y)
    const fx = ((lon - west!) / (east! - west!)) * cols - 0.5,
      fy = ((north! - lat) / (north! - south!)) * rows - 0.5
    const col = Math.min(cols - 2, Math.max(0, Math.floor(fx))),
      row = Math.min(rows - 2, Math.max(0, Math.floor(fy)))
    const tx = Math.min(1, Math.max(0, fx - col)),
      ty = Math.min(1, Math.max(0, fy - row))
    const k = row * cols + col
    return (
      (samples[k]! * (1 - tx) + samples[k + 1]! * tx) * (1 - ty) +
      (samples[k + cols]! * (1 - tx) + samples[k + cols + 1]! * tx) * ty
    )
  }
  return { at, grid: (span) => makeGrid(at, span) }
}

/**
 * The LiDAR DTM as `fetch-rt.ts` writes it: heights, m, on `cols` × `rows` cells of `cell` m in
 * EPSG:3003 (Gauss-Boaga west), row-major from the cell centred on (`e0`, `n0`).
 */
export interface DtmData {
  readonly e0: number
  readonly n0: number
  readonly cols: number
  readonly rows: number
  readonly cell: number
  readonly z: Float32Array
}

/** Bilinear terrain at fractional cell (fx, fy) of a `cols` × `rows` raster `a` (component `c` of `stride`), clamped to its edge. */
const bilinear = (
  a: Float32Array | Float64Array,
  cols: number,
  rows: number,
  fx: number,
  fy: number,
  stride: number,
  c: number,
) => {
  const i = Math.min(cols - 2, Math.max(0, Math.floor(fx))),
    j = Math.min(rows - 2, Math.max(0, Math.floor(fy)))
  const tx = Math.min(1, Math.max(0, fx - i)),
    ty = Math.min(1, Math.max(0, fy - j))
  const v = (di: number, dj: number) => a[((j + dj) * cols + i + di) * stride + c]!
  return (v(0, 0) * (1 - tx) + v(1, 0) * tx) * (1 - ty) + (v(0, 1) * (1 - tx) + v(1, 1) * tx) * ty
}

/**
 * The LiDAR DTM that `fetch-rt.ts` writes to `dir` (dtm.json + dtm.bin, EPSG:3003, 2 m cells),
 * sampled in local metres (`dtmDem`).
 */
export const loadDtm = (dir: string): Dem => {
  const meta = JSON.parse(readFileSync(join(dir, "dtm.json"), "utf8")) as Omit<DtmData, "z">
  const raw = inflateSync(readFileSync(join(dir, "dtm.bin")))
  const z = new Float32Array(meta.cols * meta.rows)
  for (let k = 0, acc = 0; k < z.length; k++) {
    acc = (k % meta.cols === 0 ? 0 : acc) + raw.readInt16LE(2 * k)
    z[k] = acc / 10
  }
  return dtmDem({ ...meta, z })
}

/**
 * Bilinear sampler in local metres of `dtm`, through a lattice of exact projections every
 * PROJ_STEP m over the built terrain and 100 m round it; outside the crop it holds the edge value.
 * Its grid windows give the nodes `makeGrid` gives on the sampler, bit for bit, but read each
 * sample's projection from terms worked out once per lattice row: the same operations on the
 * same doubles, about twice as fast (the grid's tile pass took 3.5 s of Lunigiana's 12 s).
 */
export const dtmDem = (dtm: DtmData): Dem => {
  const margin = 2 * PROJ_STEP
  const lx0 = BOUNDS.minX - margin,
    ly0 = BOUNDS.minY - margin
  const lcols = Math.ceil((BOUNDS.maxX - BOUNDS.minX + 2 * margin) / PROJ_STEP) + 1,
    lrows = Math.ceil((BOUNDS.maxY - BOUNDS.minY + 2 * margin) / PROJ_STEP) + 1
  const lattice = new Float64Array(lcols * lrows * 2)
  for (let j = 0; j < lrows; j++)
    for (let i = 0; i < lcols; i++)
      lattice.set(
        latLonToGaussBoaga(...fromLocal(lx0 + i * PROJ_STEP, ly0 + j * PROJ_STEP)),
        2 * (j * lcols + i),
      )
  const { e0, n0, cell: dc, cols: dcols, rows: drows, z } = dtm
  const at = (x: number, y: number) => {
    const fx = (x - lx0) / PROJ_STEP,
      fy = (y - ly0) / PROJ_STEP
    const e = bilinear(lattice, lcols, lrows, fx, fy, 2, 0),
      n = bilinear(lattice, lcols, lrows, fx, fy, 2, 1)
    return bilinear(z, dcols, drows, (e - e0) / dc, (n - n0) / dc, 1, 0)
  }
  const grid = (span: Span): Grid => {
    const g = gridLattice(),
      side = 2 * BOX + 1
    const { i0, j0, cols: w, rows: h } = span
    // Each sample column (a node's column, then its box's dx): its lattice column and weights.
    const m = w * side,
      li = new Int32Array(m),
      tx = new Float64Array(m),
      ux = new Float64Array(m)
    for (let c = 0; c < w; c++)
      for (let dx = -BOX; dx <= BOX; dx++) {
        const q = c * side + dx + BOX,
          fx = (g.x0 + (i0 + c) * g.cell + dx - lx0) / PROJ_STEP
        const i = Math.min(lcols - 2, Math.max(0, Math.floor(fx))),
          t = Math.min(1, Math.max(0, fx - i))
        li[q] = i
        tx[q] = t
        ux[q] = 1 - t
      }
    // A sample column's easting and northing along the lattice rows below (a) and above (b) it:
    // the first halves of `bilinear`'s sum, the same for every sample of the column in that row.
    const ea = new Float64Array(m),
      eb = new Float64Array(m),
      na = new Float64Array(m),
      nb = new Float64Array(m)
    let row = -1
    const sums = new Float64Array(w),
      out = new Float64Array(w * h)
    for (let j = j0; j < j0 + h; j++) {
      sums.fill(0)
      for (let dy = -BOX; dy <= BOX; dy++) {
        const fy = (g.y0 + j * g.cell + dy - ly0) / PROJ_STEP
        const lj = Math.min(lrows - 2, Math.max(0, Math.floor(fy)))
        const ty = Math.min(1, Math.max(0, fy - lj)),
          uy = 1 - ty
        if (lj !== row) {
          row = lj
          for (let q = 0; q < m; q++) {
            const s = 2 * (lj * lcols + li[q]!),
              t = s + 2 * lcols
            ea[q] = lattice[s]! * ux[q]! + lattice[s + 2]! * tx[q]!
            eb[q] = lattice[t]! * ux[q]! + lattice[t + 2]! * tx[q]!
            na[q] = lattice[s + 1]! * ux[q]! + lattice[s + 3]! * tx[q]!
            nb[q] = lattice[t + 1]! * ux[q]! + lattice[t + 3]! * tx[q]!
          }
        }
        // Each node's box summed as makeGrid sums it: dy by dy, dx by dx within.
        for (let c = 0, q = 0; c < w; c++) {
          let sum = sums[c]!
          for (let k = 0; k < side; k++, q++) {
            const e = ea[q]! * uy + eb[q]! * ty,
              n = na[q]! * uy + nb[q]! * ty
            sum += bilinear(z, dcols, drows, (e - e0) / dc, (n - n0) / dc, 1, 0)
          }
          sums[c] = sum
        }
      }
      for (let c = 0; c < w; c++) out[(j - j0) * w + c] = sums[c]! / side ** 2
    }
    return { ...g, z: out, span }
  }
  return { at, grid }
}

/** Half-width of the box each node averages, m: a 5 m square of 1 m samples, about one cell. */
const BOX = 2

/** The terrain grid's cell, m. */
export const GRID_CELL = 4

/** The whole grid over BOUNDS (its last row/col reaches maxX/maxY), with no nodes: the lattice every window of it shares. */
export const gridLattice = (): Omit<Grid, "z" | "span"> => ({
  cell: GRID_CELL,
  cols: Math.ceil((BOUNDS.maxX - BOUNDS.minX) / GRID_CELL) + 1,
  rows: Math.ceil((BOUNDS.maxY - BOUNDS.minY) / GRID_CELL) + 1,
  x0: BOUNDS.minX,
  y0: BOUNDS.minY,
})

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
export const slotOf = (g: Grid, i: number, j: number): number =>
  g.span === undefined ? j * g.cols + i : (j - g.span.j0) * g.span.cols + i - g.span.i0

/** Bilinear terrain at (x, y), clamped to the whole grid; `g` must hold the four nodes of the cell read. */
export const sampleGrid = (g: Grid, x: number, y: number): number => {
  const fx = (x - g.x0) / g.cell,
    fy = (y - g.y0) / g.cell
  const i = Math.min(g.cols - 2, Math.max(0, Math.floor(fx))),
    j = Math.min(g.rows - 2, Math.max(0, Math.floor(fy)))
  const tx = Math.min(1, Math.max(0, fx - i)),
    ty = Math.min(1, Math.max(0, fy - j))
  const k = slotOf(g, i, j),
    up = g.span?.cols ?? g.cols
  const s = g.z[k]! + (g.z[k + 1]! - g.z[k]!) * tx,
    n = g.z[k + up]! + (g.z[k + up + 1]! - g.z[k + up]!) * tx
  return s + (n - s) * ty
}

/** Slope in degrees of cell (i, j) (between nodes (i, j) and (i+1, j+1)) of the whole grid `g`, over a 3-cell (12 m) baseline: shorter steps (terrace walls, road cuts) are not slopes the player is stopped by. */
export const cellSlope = (g: Grid, i: number, j: number): number => {
  const z = (a: number, b: number) =>
    g.z[Math.min(g.rows - 1, Math.max(0, b)) * g.cols + Math.min(g.cols - 1, Math.max(0, a))]!
  const dx = (z(i + 2, j) + z(i + 2, j + 1) - z(i - 1, j) - z(i - 1, j + 1)) / (6 * g.cell)
  const dy = (z(i, j + 2) + z(i + 1, j + 2) - z(i, j - 1) - z(i + 1, j - 1)) / (6 * g.cell)
  return (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI
}

/** Visits the nodes `g` holds within `r` of segment a-b, by their index in `g.z`, with their distance and projection parameter. */
const forNodesNear = (
  g: Grid,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
  visit: (k: number, d: number, t: number) => void,
) => {
  const {
    i0: si,
    j0: sj,
    cols: w,
    rows: h,
  } = g.span ?? { i0: 0, j0: 0, cols: g.cols, rows: g.rows }
  const i0 = Math.max(si, Math.floor((Math.min(ax, bx) - r - g.x0) / g.cell)),
    i1 = Math.min(si + w - 1, Math.ceil((Math.max(ax, bx) + r - g.x0) / g.cell))
  const j0 = Math.max(sj, Math.floor((Math.min(ay, by) - r - g.y0) / g.cell)),
    j1 = Math.min(sj + h - 1, Math.ceil((Math.max(ay, by) + r - g.y0) / g.cell))
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const { d2, t } = segDist2(g.x0 + i * g.cell, g.y0 + j * g.cell, ax, ay, bx, by)
      if (d2 <= r * r) visit((j - sj) * w + i - si, Math.sqrt(d2), t)
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
const RELAX = 1.5 // largest factor on a grade limit (tertiary 15%, rail 3.75%)
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
 * Grade-limited fit of the (smoothed) profile through `pins`. Violated bounds become pins and the
 * fit is redone; where it strays more than CAP m from the smoothed ground, the grade limit of the
 * surrounding RELAX_REACH m is raised step by step, up to RELAX times `grade`.
 */
export const fitProfile = (p: Profile, grade: number, pins: ReadonlyArray<Pin>): void => {
  const natural = Float64Array.from(p.z),
    n = p.z.length
  const g = new Float64Array(Math.max(0, n - 1)).fill(grade)
  const hard = new Map<number, number>()
  for (const pn of pins) if (pn.kind === undefined && !hard.has(pn.k)) hard.set(pn.k, pn.z)
  const bounds = pins.filter((pn) => pn.kind !== undefined)
  for (let round = 0; round < 12; round++) {
    const t = new Float64Array(n)
    for (let k = 1; k < n; k++) t[k] = t[k - 1]! + g[k - 1]! * (p.s[k]! - p.s[k - 1]!)
    fitOnce(
      p,
      natural,
      t,
      [...hard].map(([k, z]) => ({ k, z })),
    )
    const broken = bounds.filter(
      (b) => !hard.has(b.k) && (b.kind === "min" ? p.z[b.k]! < b.z - 1e-6 : p.z[b.k]! > b.z + 1e-6),
    )
    for (const b of broken) hard.set(b.k, b.z)
    let relaxed = false
    for (let k = 0; k < n; k++) {
      if (Math.abs(p.z[k]! - natural[k]!) <= CAP) continue
      for (let j = 0; j + 1 < n; j++)
        if (Math.abs(p.s[j]! - p.s[k]!) <= RELAX_REACH && g[j]! < grade * RELAX)
          [g[j], relaxed] = [Math.min(grade * RELAX, g[j]! * 1.1), true]
    }
    if (broken.length === 0 && !relaxed) return
  }
}

/**
 * Lowers the terrain along a water-surface profile: the bed `depth`/2 below the surface inside w/2,
 * a gravel slope to `bed`, then a one-cell bank back to the terrain. Uses min(), so order never
 * matters; nodes with `keep(n)` (road cores) are left alone.
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
 * Writes a road profile into the grid: nodes within `core` take the road elevation, the next
 * `blend` m fade back to the terrain. `owner` holds the rank of the road that wrote each core
 * node (255 = none): ranks <= `rank` win, so earlier (higher) classes keep junctions.
 * `protect` marks river nodes no road may touch; segments from sample k with `skip(k)` (bridges, tunnels) write nothing.
 */
export const flatten = (
  g: Grid,
  p: Profile,
  core: number,
  blend: number,
  rank: number,
  owner: Uint8Array,
  protect: Uint8Array,
  skip: (k: number) => boolean,
): void => {
  const best = new Map<number, { d: number; z: number }>()
  for (let k = 0; k + 1 < p.z.length; k++)
    if (!skip(k))
      forNodesNear(g, p.x[k]!, p.y[k]!, p.x[k + 1]!, p.y[k + 1]!, core + blend, (n, d, t) => {
        const cur = best.get(n)
        if (cur === undefined || d < cur.d) best.set(n, { d, z: lerp(p.z[k]!, p.z[k + 1]!, t) })
      })
  for (const [n, { d, z }] of [...best].sort((a, b) => a[0] - b[0])) {
    if (protect[n] === 1 || owner[n]! <= rank) continue
    if (d <= core) {
      g.z[n] = z
      owner[n] = rank
    } else if (owner[n] === 255) g.z[n] = lerp(z, g.z[n]!, (d - core) / blend)
  }
}
