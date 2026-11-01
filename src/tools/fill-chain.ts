// The terrain's fallback chain (issue #10): after the LiDAR mosaic, each filler in turn fills the
// 1 m cells still empty that it has data for and may fill, and is bent onto every source before it,
// so it meets them without a step. The bend is the residual (better − filler) on the better cells
// round what it filled (the rim, and those within NEAR m), carried over the filled cells in two
// layers:
// - a membrane on a lattice of GRID m: its nodes fit those residuals (least squares on their
//   bilinear) and are smooth elsewhere (the membrane's ∇² = 0 where no rim is), read bilinearly per
//   cell. It carries the residual's long waves: tens of metres across a large hole;
// - what the lattice leaves at the rim (the better source's relief below GRID m, which a 10 m DTM
//   lacks) carried BAND m in by a membrane on the 1 m cells themselves, nothing beyond.
// Both cost a bounded amount per cell: the lattice has a node per GRID² m² and is solved by
// conjugate gradients, and the band is swept at most MAX_SWEEPS times. Heights are decimetres, NaN
// where no source has given one yet.

/** A 1 m mosaic being filled: heights in decimetres, NaN where none yet, and each cell's source code, NONE where none. */
export interface Mosaic {
  readonly cols: number
  readonly rows: number
  /** Row-major from the south-west cell, k = row × cols + col. */
  readonly dm: Float32Array
  readonly src: Uint8Array
}

/** A filler of the chain. */
export interface Filler {
  /** The code its cells take in `src`. */
  readonly source: number
  /** Its height at cell (col, row), dm, NaN where it has no data. */
  readonly at: (col: number, row: number) => number
  /** Whether it may fill cell k (the DSM: open ground only); every cell when absent. */
  readonly where?: (k: number) => boolean
}

/** What one filler did: the cells it filled, its rim, the residuals there and what the lattice left of them, dm, and its work. */
interface FillReport {
  readonly source: number
  readonly cells: number
  readonly rim: number
  /** The better cells within NEAR m of its cells whose residuals the lattice fits, the rim among them. */
  readonly fit: number
  /** The rim's residuals (better − filler), dm; [0, 0] without a rim. */
  readonly residual: readonly [number, number]
  /** The largest residual the lattice leaves at a rim cell, dm, which the band carries in. */
  readonly leftover: number
  /** The band's cells and its sweeps over them, and the lattice's conjugate-gradient iterations. */
  readonly band: number
  readonly sweeps: number
  readonly iterations: number
}

/** `src` of a cell no source has filled. */
export const NONE = 255
/** The filler's own cells while it runs, and those of them in the band. */
const CURRENT = 254,
  BANDED = 253
/** The lattice's step, m: one node per 2 500 m². */
const GRID = 50
/** How near the filler's cells a better cell fits the lattice, m (a square round each). */
const NEAR = 2
/** How far the band carries the lattice's leftover into the filled cells, m. */
const BAND = 50
/** The membrane's weight against the rim's fit, per lattice edge; a node is fitted by tens of rim cells. */
const MU = 1
/** A pull of every node toward 0, so a lattice piece without a rim is solved (to no bend). */
const EPS = 1e-6
/** Over-relaxation of the band's sweeps, and when they stop: no cell moved by more than STILL dm. */
const OMEGA = 1.9,
  STILL = 0.01,
  MAX_SWEEPS = 8 * BAND

/** A growable list of numbers. */
class List<T extends Int32Array | Float64Array> {
  n = 0
  a: T
  constructor(a: T) {
    this.a = a
  }
  push(v: number): void {
    if (this.n === this.a.length) {
      const b = new (this.a.constructor as new (n: number) => T)(2 * this.a.length)
      b.set(this.a)
      this.a = b
    }
    this.a[this.n++] = v
  }
}

/** Whether `s` is a source before the running filler: a cell it must meet. */
const better = (s: number) => s < BANDED

/**
 * The 4 neighbours of cell k in a `cols` × `rows` grid, -1 past its edge; `out` is overwritten and
 * returned.
 */
const neighbours = (k: number, cols: number, rows: number, out: Int32Array): Int32Array => {
  const c = k % cols
  out[0] = c > 0 ? k - 1 : -1
  out[1] = c < cols - 1 ? k + 1 : -1
  out[2] = k >= cols ? k - cols : -1
  out[3] = k < (rows - 1) * cols ? k + cols : -1
  return out
}

/** 1 on every cell within NEAR cells of one of the running filler's (a square), else 0: rows, then columns. */
const nearCurrent = (src: Uint8Array, cols: number, rows: number): Uint8Array => {
  const near = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    const o = r * cols
    for (let c = 0, last = -Infinity; c < cols; c++) {
      if (src[o + c] === CURRENT) last = c
      if (c - last <= NEAR) near[o + c] = 1
    }
    for (let c = cols - 1, next = Infinity; c >= 0; c--) {
      if (src[o + c] === CURRENT) next = c
      if (next - c <= NEAR) near[o + c] = 1
    }
  }
  const column = new Uint8Array(rows)
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) column[r] = near[r * cols + c]!
    for (let r = 0, last = -Infinity; r < rows; r++) {
      if (column[r] === 1) last = r
      if (r - last <= NEAR) near[r * cols + c] = 1
    }
    for (let r = rows - 1, next = Infinity; r >= 0; r--) {
      if (column[r] === 1) next = r
      if (next - r <= NEAR) near[r * cols + c] = 1
    }
  }
  return near
}

/**
 * The lattice fit: node values (`ni` × `nj`, GRID m apart from cell (0, 0)) minimising the squared
 * misfit of their bilinear to the residuals `fitR` at cells `fitK`, plus MU × the membrane over
 * the edges between the nodes of the `reach` lattice cells, by conjugate gradients with a Jacobi
 * preconditioner.
 */
const fitLattice = (
  cols: number,
  ni: number,
  nj: number,
  reach: Uint8Array,
  fitK: Int32Array,
  fitR: Float64Array,
  count: number,
): { x: Float64Array; iterations: number } => {
  const nodes = ni * nj
  // A node is solved for when a lattice cell beside it is in reach.
  const active: Array<number> = []
  const on = new Uint8Array(nodes)
  for (let j = 0; j < nj; j++)
    for (let i = 0; i < ni; i++) {
      const cell = (a: number, b: number) =>
        a >= 0 && b >= 0 && a < ni - 1 && b < nj - 1 && reach[b * (ni - 1) + a] === 1
      if (cell(i - 1, j - 1) || cell(i, j - 1) || cell(i - 1, j) || cell(i, j)) {
        on[j * ni + i] = 1
        active.push(j * ni + i)
      }
    }
  // The matrix as a 9-point stencil per node (dj, di in -1..1), and the right-hand side.
  const a = new Float64Array(nodes * 9),
    b = new Float64Array(nodes)
  // A cell's four nodes: their columns and rows past its south-west node.
  const oi = [0, 1, 0, 1],
    oj = [0, 0, 1, 1]
  const w = new Float64Array(4)
  for (let q = 0; q < count; q++) {
    const k = fitK[q]!,
      fx = (k % cols) / GRID,
      fy = Math.floor(k / cols) / GRID
    const i = Math.floor(fx),
      j = Math.floor(fy),
      tx = fx - i,
      ty = fy - j
    w[0] = (1 - tx) * (1 - ty)
    w[1] = tx * (1 - ty)
    w[2] = (1 - tx) * ty
    w[3] = tx * ty
    for (let p = 0; p < 4; p++) {
      const node = (j + oj[p]!) * ni + i + oi[p]!
      b[node]! += w[p]! * fitR[q]!
      for (let s = 0; s < 4; s++)
        a[node * 9 + (oj[s]! - oj[p]! + 1) * 3 + oi[s]! - oi[p]! + 1]! += w[p]! * w[s]!
    }
  }
  for (const p of active) {
    a[p * 9 + 4]! += EPS
    const i = p % ni
    // East and north edges, each once.
    if (i + 1 < ni && on[p + 1] === 1) {
      a[p * 9 + 4]! += MU
      a[(p + 1) * 9 + 4]! += MU
      a[p * 9 + 5]! -= MU
      a[(p + 1) * 9 + 3]! -= MU
    }
    if (p + ni < nodes && on[p + ni] === 1) {
      a[p * 9 + 4]! += MU
      a[(p + ni) * 9 + 4]! += MU
      a[p * 9 + 7]! -= MU
      a[(p + ni) * 9 + 1]! -= MU
    }
  }
  const apply = (v: Float64Array, out: Float64Array) => {
    for (const p of active) {
      let s = 0
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const c = a[p * 9 + (dj + 1) * 3 + di + 1]!
          if (c !== 0) s += c * v[p + dj * ni + di]!
        }
      out[p] = s
    }
  }
  const x = new Float64Array(nodes),
    r = Float64Array.from(b),
    z = new Float64Array(nodes),
    d = new Float64Array(nodes),
    ad = new Float64Array(nodes)
  const dot = (u: Float64Array, v: Float64Array) => {
    let s = 0
    for (const p of active) s += u[p]! * v[p]!
    return s
  }
  for (const p of active) d[p] = z[p] = r[p]! / a[p * 9 + 4]!
  let rz = dot(r, z)
  const stop = 1e-20 * Math.max(1, dot(b, b))
  let iterations = 0
  for (; iterations < 10 * active.length + 10 && dot(r, r) > stop; iterations++) {
    apply(d, ad)
    const alpha = rz / dot(d, ad)
    for (const p of active) {
      x[p]! += alpha * d[p]!
      r[p]! -= alpha * ad[p]!
      z[p] = r[p]! / a[p * 9 + 4]!
    }
    const rz1 = dot(r, z)
    for (const p of active) d[p] = z[p]! + (rz1 / rz) * d[p]!
    rz = rz1
  }
  return { x, iterations }
}

/** The lattice's bilinear at cell k. */
const latticeAt = (x: Float64Array, ni: number, cols: number, k: number): number => {
  const fx = (k % cols) / GRID,
    fy = Math.floor(k / cols) / GRID
  const i = Math.floor(fx),
    j = Math.floor(fy),
    tx = fx - i,
    ty = fy - j,
    p = j * ni + i
  return (
    (x[p]! * (1 - tx) + x[p + 1]! * tx) * (1 - ty) +
    (x[p + ni]! * (1 - tx) + x[p + ni + 1]! * tx) * ty
  )
}

/** Fills the cells of `m` still empty that `f` has data for and may fill, bent onto the cells round them. */
export const fillStep = (m: Mosaic, f: Filler): FillReport => {
  const { cols, rows, dm, src } = m,
    n = cols * rows
  let cells = 0
  for (let k = 0; k < n; k++) {
    if (!Number.isNaN(dm[k]!) || (f.where !== undefined && !f.where(k))) continue
    const v = f.at(k % cols, Math.floor(k / cols))
    if (Number.isNaN(v)) continue
    dm[k] = v
    src[k] = CURRENT
    cells++
  }
  // The residuals (better - filler) on the better cells near the filler's cells where it has data:
  // the rim, those beside a filled cell, by their place in that list, and those a few metres off,
  // so a pocket of the filler that misses a better source by a cell or two is bent onto it too, and
  // the later filler between them finds them agreeing. The lattice is solved over the lattice cells
  // holding any of these or of the filler's cells (its reach).
  const ni = Math.floor((cols - 1) / GRID) + 2,
    nj = Math.floor((rows - 1) / GRID) + 2,
    li = ni - 1
  const reach = new Uint8Array(li * (nj - 1))
  const inReach = (k: number) =>
    (reach[Math.floor(Math.floor(k / cols) / GRID) * li + Math.floor((k % cols) / GRID)] = 1)
  const near = nearCurrent(src, cols, rows)
  const nb = new Int32Array(4)
  const fitK = new List(new Int32Array(1024)),
    fitR = new List(new Float64Array(1024)),
    rim = new List(new Int32Array(1024))
  let lo = Infinity,
    hi = -Infinity
  for (let k = 0; k < n; k++) {
    if (src[k] === CURRENT) inReach(k)
    if (near[k] === 0 || !better(src[k]!)) continue
    const v = f.at(k % cols, Math.floor(k / cols))
    if (Number.isNaN(v)) continue
    const r = dm[k]! - v
    if (neighbours(k, cols, rows, nb).some((q) => q >= 0 && src[q] === CURRENT)) {
      rim.push(fitK.n)
      lo = Math.min(lo, r)
      hi = Math.max(hi, r)
    }
    fitK.push(k)
    fitR.push(r)
    inReach(k)
  }
  const { x, iterations } = fitLattice(cols, ni, nj, reach, fitK.a, fitR.a, fitK.n)
  for (let k = 0; k < n; k++) if (src[k] === CURRENT) dm[k]! += latticeAt(x, ni, cols, k)
  // What the lattice leaves at each rim cell: the band's fixed edge.
  const leftover = new Map<number, number>()
  let most = 0
  for (let q = 0; q < rim.n; q++) {
    const k = fitK.a[rim.a[q]!]!,
      l = fitR.a[rim.a[q]!]! - latticeAt(x, ni, cols, k)
    leftover.set(k, l)
    most = Math.max(most, Math.abs(l))
  }
  const band = carryIn(m, leftover, nb)
  for (let k = 0; k < n; k++) if (src[k] === CURRENT || src[k] === BANDED) src[k] = f.source
  return {
    source: f.source,
    cells,
    rim: rim.n,
    fit: fitK.n,
    residual: rim.n === 0 ? [0, 0] : [lo, hi],
    leftover: most,
    band: band.cells,
    sweeps: band.sweeps,
    iterations,
  }
}

/**
 * The band: the filler's cells within BAND m of a rim cell (4-connected steps), solved as a
 * membrane on the 1 m cells by over-relaxed sweeps, each fixed at the rim's `leftover`, at 0 past
 * the band, and free beside any other cell. Adds it to `m.dm` and marks the band's cells BANDED.
 */
const carryIn = (
  m: Mosaic,
  leftover: ReadonlyMap<number, number>,
  nb: Int32Array,
): { cells: number; sweeps: number } => {
  const { cols, rows, dm, src } = m
  // Breadth first from the cells beside the rim, to BAND steps.
  const queue = new List(new Int32Array(1024)),
    depth = new List(new Int32Array(1024))
  for (const k of leftover.keys())
    for (const q of neighbours(k, cols, rows, nb))
      if (q >= 0 && src[q] === CURRENT) {
        src[q] = BANDED
        queue.push(q)
        depth.push(1)
      }
  for (let h = 0; h < queue.n; h++) {
    if (depth.a[h]! >= BAND) continue
    for (const q of neighbours(queue.a[h]!, cols, rows, nb))
      if (q >= 0 && src[q] === CURRENT) {
        src[q] = BANDED
        queue.push(q)
        depth.push(depth.a[h]! + 1)
      }
  }
  const count = queue.n
  const index = new Map<number, number>()
  for (let i = 0; i < count; i++) index.set(queue.a[i]!, i)
  // Each band cell: its band neighbours (-1 none), the sum of its fixed neighbours and how many
  // neighbours it averages.
  const links = new Int32Array(4 * count).fill(-1),
    fixed = new Float64Array(count),
    weight = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    neighbours(queue.a[i]!, cols, rows, nb)
    for (let s = 0; s < 4; s++) {
      const q = nb[s]!
      if (q < 0) continue
      if (src[q] === BANDED) links[4 * i + s] = index.get(q)!
      else if (src[q] === CURRENT) {
        // Past the band: fixed at 0.
      } else {
        const l = leftover.get(q)
        if (l === undefined) continue
        fixed[i]! += l
      }
      weight[i]!++
    }
  }
  const d = new Float64Array(count)
  let sweeps = 0
  for (let moved = Infinity; moved > STILL && sweeps < MAX_SWEEPS; sweeps++) {
    moved = 0
    for (let i = 0; i < count; i++) {
      if (weight[i] === 0) continue
      let s = fixed[i]!
      for (let t = 4 * i; t < 4 * i + 4; t++) if (links[t]! >= 0) s += d[links[t]!]!
      const step = OMEGA * (s / weight[i]! - d[i]!)
      d[i]! += step
      moved = Math.max(moved, Math.abs(step))
    }
  }
  for (let i = 0; i < count; i++) dm[queue.a[i]!]! += d[i]!
  return { cells: count, sweeps }
}
