// The collision walls' pieces: lines and traced outlines cut into flat (ax, ay, bx, by) segments of
// at most RUN m (walls.ts, house-walls.ts, parapets.ts, deck-walls.ts).
import type { Rings } from "../sim/map/outline.ts"
import { r1 } from "./geometry.ts"
import { simplifyLoop, traceLoops } from "./loops.ts"
import type { DmGrid } from "./terrain.ts"

/** The longest wall piece, m. */
const RUN = 16

/** Pushes a-b as pieces no longer than `run`. */
export const pushSplit = (
  out: Array<number>,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  run = RUN,
): void => {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / run))
  for (let k = 0; k < n; k++)
    out.push(
      r1(ax + ((bx - ax) * k) / n),
      r1(ay + ((by - ay) * k) / n),
      r1(ax + ((bx - ax) * (k + 1)) / n),
      r1(ay + ((by - ay) * (k + 1)) / n),
    )
}

/**
 * The play area's outline into every list in `outs`: each ring's edges in ring order, as pieces of
 * at most 64 m (so `walls.reach`, how far a wall sticks out of its midpoint, is 33 m). A rectangle
 * runs S, E, N, W from its south-west corner.
 */
export const pushOutline = (outs: ReadonlyArray<Array<number>>, rings: Rings): void => {
  for (const out of outs)
    for (const ring of rings)
      for (let i = 0, n = ring.length / 2; i < n; i++) {
        const j = (i + 1) % n
        pushSplit(out, ring[2 * i]!, ring[2 * i + 1]!, ring[2 * j]!, ring[2 * j + 1]!, 64)
      }
}

/** `pts`'s edges (and the closing one when `closed`) into `out`, as pieces of at most `run` m. */
export const pushPolyline = (
  out: Array<number>,
  pts: ReadonlyArray<number>,
  closed: boolean,
  run = RUN,
): void => {
  const n = pts.length / 2
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n
    pushSplit(out, pts[2 * i]!, pts[2 * i + 1]!, pts[2 * j]!, pts[2 * j + 1]!, run)
  }
}

/** Appends `walls` to `out` one by one: spread into `push`, a list past about 120,000 numbers overflows the call stack. */
export const append = (out: Array<number>, walls: ReadonlyArray<number>): void => {
  for (const v of walls) out.push(v)
}

/** Walls around the blocked cells: traced loops, simplified within `tol` m, split into <= RUN m segments, into every list in `outs`. */
export const boundary = (
  g: Pick<DmGrid, "cell" | "cols" | "rows" | "x0" | "y0">,
  blocked: Uint8Array,
  outs: ReadonlyArray<Array<number>>,
  tol: number,
): void => {
  for (const loop of traceLoops(g, blocked)) {
    const pts = simplifyLoop(loop, tol)
    for (let i = 0; i + 1 < pts.length; i++)
      for (const out of outs) pushSplit(out, pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1])
  }
}
