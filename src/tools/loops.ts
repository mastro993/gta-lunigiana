// Outlines of blocked cells on a grid: marching squares into closed loops, and Douglas–Peucker on
// a loop. The walls trace the steep ground and the water's edge with them, the footprints cut by a
// road corridor and the platforms clipped off the track their outlines; the walls under the decks
// trace a field's contour (`traceContours`).
import type { Grid } from "./terrain.ts"

/**
 * Marching squares over the blocked cells (centres = samples, outside = free): closed loops of
 * crossing points midway between blocked and free centres, blocked side on the left. At saddles
 * the diagonal blocked corners join, so one-cell diagonal strips (streams) stay one loop. Yields
 * loops of [x, y] in metres (first point repeated last), each from its lowest crossing id, one at a
 * time so only the loop at hand is held.
 */
export function* traceLoops(
  g: Pick<Grid, "cell" | "cols" | "rows" | "x0" | "y0">,
  blocked: Uint8Array,
): Generator<Array<readonly [number, number]>> {
  const cw = g.cols - 1,
    ch = g.rows - 1,
    c = g.cell
  const b = (i: number, j: number) =>
    i < 0 || j < 0 || i >= cw || j >= ch ? 0 : blocked[j * cw + i]!
  // Crossing ids: edge between centres (i,j)-(i+1,j) -> h, (i,j)-(i,j+1) -> v.
  const hId = (i: number, j: number) => ((j + 1) * (cw + 2) + i + 1) * 2,
    vId = (i: number, j: number) => hId(i, j) + 1
  const xy = (id: number): readonly [number, number] => {
    const cell = Math.floor(id / 2),
      i = (cell % (cw + 2)) - 1,
      j = Math.floor(cell / (cw + 2)) - 1
    return id % 2 === 0
      ? [g.x0 + (i + 1) * c, g.y0 + (j + 0.5) * c]
      : [g.x0 + (i + 0.5) * c, g.y0 + (j + 1) * c]
  }
  const next = new Map<number, number>()
  for (let j = -1; j < ch; j++)
    for (let i = -1; i < cw; i++) {
      // Square corners counter-clockwise: SW, SE, NE, NW; edge k runs corner k -> k+1.
      const v = [b(i, j), b(i + 1, j), b(i + 1, j + 1), b(i, j + 1)]
      if (v[0] === v[1] && v[1] === v[2] && v[2] === v[3]) continue
      const edge = [hId(i, j), vId(i + 1, j), hId(i, j + 1), vId(i, j)]
      for (let k = 0; k < 4; k++) {
        if (!(v[k] === 1 && v[(k + 1) % 4] === 0)) continue // leaves the blocked region along edge k
        let e = (k + 1) % 4
        while (!(v[e] === 0 && v[(e + 1) % 4] === 1)) e = (e + 1) % 4 // next entering edge counter-clockwise
        next.set(edge[k]!, edge[e]!)
      }
    }
  for (const start of [...next.keys()].sort((a, d) => a - d)) {
    if (!next.has(start)) continue
    const loop = [xy(start)]
    let cur = start
    do {
      const to = next.get(cur)!
      next.delete(cur)
      loop.push(xy(to))
      cur = to
    } while (cur !== start)
    yield loop
  }
}

/** Marks in `keep` the points of `pts` between a and z (kept) that Douglas–Peucker keeps within `tol`. */
const peucker = (
  pts: ReadonlyArray<readonly [number, number]>,
  tol: number,
  keep: Uint8Array,
  a: number,
  z: number,
): void => {
  const [ax, ay] = pts[a]!,
    [zx, zy] = pts[z]!,
    len = Math.hypot(zx - ax, zy - ay) || 1
  let worst = tol,
    at = -1
  for (let k = a + 1; k < z; k++) {
    const d = Math.abs((pts[k]![0] - ax) * (zy - ay) - (pts[k]![1] - ay) * (zx - ax)) / len
    if (d > worst) [worst, at] = [d, k]
  }
  if (at < 0) return
  keep[at] = 1
  peucker(pts, tol, keep, a, at)
  peucker(pts, tol, keep, at, z)
}

/** Douglas-Peucker on a closed loop (first point repeated last), split at the point farthest from the start. */
export const simplifyLoop = (
  pts: ReadonlyArray<readonly [number, number]>,
  tol: number,
): Array<readonly [number, number]> => {
  const n = pts.length - 1
  if (n <= 4) return [...pts]
  const keep = new Uint8Array(n + 1)
  let far = 1
  for (let k = 1; k < n; k++)
    if (
      Math.hypot(pts[k]![0] - pts[0]![0], pts[k]![1] - pts[0]![1]) >
      Math.hypot(pts[far]![0] - pts[0]![0], pts[far]![1] - pts[0]![1])
    )
      far = k
  keep[0] = keep[far] = keep[n] = 1
  peucker(pts, tol, keep, 0, far)
  peucker(pts, tol, keep, far, n)
  return pts.filter((_, k) => keep[k] === 1)
}

/** Lattice columns and rows a crossing's id spans either side of 0: past any map's reach at 0.25 m. */
const SPAN = 1 << 21

/**
 * Marching squares over a field read at the nodes (i, j) of a lattice `step` m apart, node (i, j) at
 * (i·step, j·step): closed loops of the points where it crosses 0 between a node under 0 and its
 * neighbour at or over 0 (linearly between them; a node `f` leaves undefined counts as `step` over),
 * the side under 0 on the left. At saddles the diagonal corners under 0 join, as in `traceLoops`.
 * `under` lists every node under 0. Yields loops of [x, y] (first point repeated last), each from its
 * lowest crossing id, in the same order for the same field.
 */
export function* traceContours(
  f: (i: number, j: number) => number | undefined,
  under: Iterable<readonly [number, number]>,
  step: number,
): Generator<Array<readonly [number, number]>> {
  const below = (i: number, j: number) => (f(i, j) ?? step) < 0
  // Crossing ids: edge (i,j)-(i+1,j) -> h, (i,j)-(i,j+1) -> v.
  const hId = (i: number, j: number) => ((j + SPAN) * 2 * SPAN + i + SPAN) * 2,
    vId = (i: number, j: number) => hId(i, j) + 1
  const point = (id: number): readonly [number, number] => {
    const node = Math.floor(id / 2),
      i = (node % (2 * SPAN)) - SPAN,
      j = Math.floor(node / (2 * SPAN)) - SPAN,
      [bi, bj] = id % 2 === 0 ? [i + 1, j] : [i, j + 1]
    const [li, lj, hi, hj] = below(i, j) ? [i, j, bi, bj] : [bi, bj, i, j]
    const fl = f(li, lj)!,
      t = fl / (fl - (f(hi, hj) ?? step))
    return [(li + (hi - li) * t) * step, (lj + (hj - lj) * t) * step]
  }
  const cells = new Set<number>(),
    next = new Map<number, number>()
  for (const [ni, nj] of under)
    for (const [i, j] of [
      [ni - 1, nj - 1],
      [ni, nj - 1],
      [ni - 1, nj],
      [ni, nj],
    ] as const) {
      const key = hId(i, j)
      if (cells.has(key)) continue
      cells.add(key)
      // Square corners counter-clockwise: SW, SE, NE, NW; edge k runs corner k -> k+1.
      const v = [below(i, j), below(i + 1, j), below(i + 1, j + 1), below(i, j + 1)]
      const edge = [hId(i, j), vId(i + 1, j), hId(i, j + 1), vId(i, j)]
      for (let k = 0; k < 4; k++) {
        if (!(v[k] && !v[(k + 1) % 4])) continue // leaves the region under 0 along edge k
        let e = (k + 1) % 4
        while (!(!v[e] && v[(e + 1) % 4])) e = (e + 1) % 4 // next entering edge counter-clockwise
        next.set(edge[k]!, edge[e]!)
      }
    }
  for (const start of [...next.keys()].sort((a, d) => a - d)) {
    if (!next.has(start)) continue
    const loop = [point(start)]
    let cur = start
    do {
      const to = next.get(cur)!
      next.delete(cur)
      loop.push(point(to))
      cur = to
    } while (cur !== start)
    yield loop
  }
}
