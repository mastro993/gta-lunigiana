// Outlines of blocked cells on a grid: marching squares into closed loops, and Douglas–Peucker on
// a loop. The walls trace the steep ground and the water's edge with them, the footprints cut by a
// road corridor and the platforms clipped off the track their outlines.
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

/** Douglas-Peucker on a closed loop (first point repeated last), split at the point farthest from the start. */
export const simplifyLoop = (
  pts: ReadonlyArray<readonly [number, number]>,
  tol: number,
): Array<readonly [number, number]> => {
  const n = pts.length - 1
  if (n <= 4) return [...pts]
  const keep = new Uint8Array(n + 1)
  const rec = (a: number, z: number) => {
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
    rec(a, at)
    rec(at, z)
  }
  let far = 1
  for (let k = 1; k < n; k++)
    if (
      Math.hypot(pts[k]![0] - pts[0]![0], pts[k]![1] - pts[0]![1]) >
      Math.hypot(pts[far]![0] - pts[0]![0], pts[far]![1] - pts[0]![1])
    )
      far = k
  keep[0] = keep[far] = keep[n] = 1
  rec(0, far)
  rec(far, n)
  return pts.filter((_, k) => keep[k] === 1)
}
