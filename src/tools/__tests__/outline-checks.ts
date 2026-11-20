// The play area's checks the test regions' map tests share (l-region.map-test.ts and
// coast-shore.map-test.ts), on a region whose outline's edges all run along the axes: its walls,
// walk and drive, run end to end along every edge and the game's lookup finds them there
// (`assertOutlineWalls`), and a walker's flood from the start, stopped by the walk walls, never
// leaves the play area (`walkFlood`). They take the game's lookups as arguments, so this module
// reads no map: a test hands them over once its map is loaded.
import assert from "node:assert/strict"

import type { Wall, WallKind } from "../../sim/map/walls.ts"

/** A point lies on an edge within this (m): the edges are whole metres, and walls round to 0.1 m. */
const ON = 1e-6

/** An edge of the outline, from (ax, ay) to (bx, by), along an axis. */
interface Edge {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
}

/** The edges of the flat ring `ring`, vertex k to the next, in its order. */
export const edgesOf = (ring: ReadonlyArray<number>): Array<Edge> => {
  const n = ring.length / 2
  return Array.from({ length: n }, (_, k) => {
    const m = (k + 1) % n
    return { ax: ring[2 * k]!, ay: ring[2 * k + 1]!, bx: ring[2 * m]!, by: ring[2 * m + 1]! }
  })
}

/** Where along edge `e` (0 at a, its length at b) point (x, y) lies, or undefined off its line. */
export const along = (e: Edge, x: number, y: number): number | undefined => {
  if (e.ax === e.bx)
    return Math.abs(x - e.ax) <= ON ? (y - e.ay) * Math.sign(e.by - e.ay) : undefined
  return Math.abs(y - e.ay) <= ON ? (x - e.ax) * Math.sign(e.bx - e.ax) : undefined
}

/** Edge `e`'s length, m. */
const lengthOf = (e: Edge): number => Math.abs(e.bx - e.ax) + Math.abs(e.by - e.ay)

/** Whether segments a–b and c–d cross or touch. */
export const crosses = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean => {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px))
  const d1 = side(cx, cy, dx, dy, ax, ay),
    d2 = side(cx, cy, dx, dy, bx, by),
    d3 = side(ax, ay, bx, by, cx, cy),
    d4 = side(ax, ay, bx, by, dx, dy)
  return d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 === 0 && d2 === 0)
}

/** The game's wall lookup (`wallsNear` in src/sim/map/walls.ts). */
type WallsNear = (
  kind: WallKind,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) => ReadonlyArray<Wall>

/**
 * Asserts that the walk and the drive walls (`flat`: each kind's (ax, ay, bx, by) walls, the whole
 * map's) cover every one of `edges` end to end, and that every 4 m along each a lookup there
 * (`wallsNear`) answers a wall on it.
 */
export const assertOutlineWalls = (
  flat: Readonly<Record<"walk" | "drive", ArrayLike<number>>>,
  edges: ReadonlyArray<Edge>,
  wallsNear: WallsNear,
): void => {
  for (const kind of ["walk", "drive"] as const) {
    const walls = flat[kind]
    edges.forEach((e, k) => {
      // the stretches of the edge its walls cover, merged
      const spans: Array<[number, number]> = []
      for (let w = 0; w < walls.length; w += 4) {
        const s = along(e, walls[w]!, walls[w + 1]!),
          t = along(e, walls[w + 2]!, walls[w + 3]!)
        // on the edge, not on its line past an end
        if (
          s !== undefined &&
          t !== undefined &&
          Math.max(s, t) > 0 &&
          Math.min(s, t) < lengthOf(e)
        )
          spans.push([Math.min(s, t), Math.max(s, t)])
      }
      spans.sort((a, b) => a[0] - b[0])
      let reach = 0
      for (const [s, t] of spans) {
        assert.ok(s <= reach + ON, `${kind} edge ${k}: a gap from ${reach} to ${s} m`)
        reach = Math.max(reach, t)
      }
      assert.ok(reach >= lengthOf(e) - ON, `${kind} edge ${k}: walls stop at ${reach} m`)
      // every 4 m along it, a lookup there answers a wall on it
      for (let d = 2; d < lengthOf(e); d += 4) {
        const x = e.ax + Math.sign(e.bx - e.ax) * d,
          y = e.ay + Math.sign(e.by - e.ay) * d
        assert.ok(
          wallsNear(kind, x - 0.5, y - 0.5, x + 0.5, y + 0.5).some((w) => {
            const s = along(e, w.ax, w.ay),
              t = along(e, w.bx, w.by)
            return s !== undefined && t !== undefined && Math.min(s, t) <= d && d <= Math.max(s, t)
          }),
          `${kind} edge ${k}: no wall found at ${x}, ${y}`,
        )
      }
    })
  }
}

/** How far past the bounds the flood may go, m: a leak through the outline would reach it. */
const BEYOND = 40
/** Side of the cells whose walls are looked up once, m. */
const BLOCK = 16

/** What a walker's flood (`walkFlood`) reads: the game's lookups and the map's bounds and start. */
interface Flood {
  readonly bounds: {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
  }
  readonly start: { readonly x: number; readonly y: number }
  readonly edges: ReadonlyArray<Edge>
  readonly wallsNear: WallsNear
  readonly inPlay: (x: number, y: number) => boolean
  /** The flood's cell side, m: every outline edge lies between two cells' centres. */
  readonly step: number
}

/**
 * On foot from the start, a flood over cells of `step` m stopped by the walk walls (and the trunks)
 * between their centres: it asserts that no cell it reaches lies outside the play area, and gives
 * how many cells it reached and the edges it came within a cell of.
 */
export const walkFlood = ({ bounds, start, edges, wallsNear, inPlay, step }: Flood) => {
  const { minX, minY, maxX, maxY } = bounds
  const x0 = minX - BEYOND,
    y0 = minY - BEYOND,
    cols = Math.round((maxX - minX + 2 * BEYOND) / step),
    rows = Math.round((maxY - minY + 2 * BEYOND) / step)
  const per = BLOCK / step,
    bcols = Math.ceil(cols / per)
  /** Each block's walk walls (and trunks), flat, looked up once. */
  const blocks = new Map<number, Float64Array>()
  const wallsOf = (b: number): Float64Array => {
    let flat = blocks.get(b)
    if (flat === undefined) {
      const bx = x0 + (b % bcols) * BLOCK,
        by = y0 + Math.floor(b / bcols) * BLOCK
      const found = wallsNear("walk", bx, by, bx + BLOCK, by + BLOCK)
      flat = new Float64Array(found.length * 4)
      found.forEach((w, k) => flat!.set([w.ax, w.ay, w.bx, w.by], 4 * k))
      blocks.set(b, flat)
    }
    return flat
  }
  const blockOf = (c: number, r: number) => Math.floor(r / per) * bcols + Math.floor(c / per)
  const centre = (c: number) => x0 + (c + 0.5) * step
  const middle = (r: number) => y0 + (r + 0.5) * step
  const open = (c: number, r: number, d: number, e: number) => {
    const ax = centre(c),
      ay = middle(r),
      bx = centre(d),
      by = middle(e)
    for (const b of new Set([blockOf(c, r), blockOf(d, e)])) {
      const w = wallsOf(b)
      for (let k = 0; k < w.length; k += 4)
        if (crosses(w[k]!, w[k + 1]!, w[k + 2]!, w[k + 3]!, ax, ay, bx, by)) return false
    }
    return true
  }
  /** Whether (x, y) lies within a cell of axis-aligned edge `e`, beside it. */
  const edgeNear = (e: Edge, x: number, y: number) =>
    e.ax === e.bx
      ? Math.abs(x - e.ax) < step && y >= Math.min(e.ay, e.by) && y <= Math.max(e.ay, e.by)
      : Math.abs(y - e.ay) < step && x >= Math.min(e.ax, e.bx) && x <= Math.max(e.ax, e.bx)
  const seen = new Uint8Array(cols * rows)
  const first = Math.floor((start.y - y0) / step) * cols + Math.floor((start.x - x0) / step)
  const stack = [first]
  seen[first] = 1
  let reached = 0
  const near = new Set<number>()
  while (stack.length > 0) {
    const k = stack.pop()!,
      c = k % cols,
      r = Math.floor(k / cols)
    reached++
    const cx = centre(c),
      cy = middle(r)
    assert.ok(inPlay(cx, cy), `the flood got out at ${cx}, ${cy}`)
    edges.forEach((e, n) => {
      if (edgeNear(e, cx, cy)) near.add(n)
    })
    for (const [d, e] of [
      [c + 1, r],
      [c - 1, r],
      [c, r + 1],
      [c, r - 1],
    ] as const) {
      if (d < 0 || e < 0 || d >= cols || e >= rows || seen[e * cols + d] === 1) continue
      if (!open(c, r, d, e)) continue
      seen[e * cols + d] = 1
      stack.push(e * cols + d)
    }
  }
  return { reached, near: [...near].sort((a, b) => a - b) }
}
