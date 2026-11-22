// Terrain for the map build: the 4 m node grid (its nodes averaged from the DTM, dtm.ts), river
// carving along the water's surface profiles (water.ts), and road flattening along the profiles
// profile-fit.ts smooths and fits to their grade.
import { Ops } from "@typeonce/ritmo-math"

import { segDist2 } from "./geometry.ts"
import { lerp, type Profile } from "./profile-fit.ts"
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
