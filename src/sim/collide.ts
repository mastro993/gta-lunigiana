/**
 * Collision helpers on top of ritmo-math's `Collide2`, which sweeps and pushes one circle against
 * the map's wall segments: a rigid group of circles moved as one (a car is a row of circles along
 * its axis), push-out repeated for concave corners, a static broad phase, and polygon geometry.
 *
 * @module collide
 */
import { Collide2, Vec2 } from "@typeonce/ritmo-math"

import type { Segment } from "./map/index.ts"

/** Squared distance from (px,py) to segment a-b and the projection parameter t in [0,1]. */
export const segDist2 = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { d2: number; t: number } => {
  const ex = bx - ax,
    ey = by - ay,
    l2 = ex * ex + ey * ey
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2)) : 0
  const dx = ax + ex * t - px,
    dy = ay + ey * t - py
  return { d2: dx * dx + dy * dy, t }
}

/** A block of a raster's pixels: columns c0 … c0 + cols − 1, rows r0 … r0 + rows − 1. */
export interface PixelBlock {
  readonly c0: number
  readonly r0: number
  readonly cols: number
  readonly rows: number
}

/**
 * Even-odd scanline fill of one polygon (flat rings) on a `cols` × `rows` raster with pixel centres
 * at x0 + (c + 0.5) * res; calls `set` per pixel index. With `block`, only the pixels of that block
 * of the raster (inside it), indexed within the block: the same pixels a fill of the whole raster
 * sets there.
 */
export const fillPolygon = (
  rings: ReadonlyArray<ReadonlyArray<number>>,
  x0: number,
  y0: number,
  res: number,
  cols: number,
  rows: number,
  set: (k: number) => void,
  block?: PixelBlock,
): void => {
  const { c0, r0, cols: bc, rows: br } = block ?? { c0: 0, r0: 0, cols, rows }
  let lo = Number.MAX_VALUE,
    hi = -Number.MAX_VALUE
  for (const r of rings)
    for (let i = 1; i < r.length; i += 2) [lo, hi] = [Math.min(lo, r[i]!), Math.max(hi, r[i]!)]
  const xs: Array<number> = []
  for (
    let row = Math.max(r0, Math.floor((lo - y0) / res));
    row <= Math.min(r0 + br - 1, Math.ceil((hi - y0) / res));
    row++
  ) {
    const yc = y0 + (row + 0.5) * res
    xs.length = 0
    for (const r of rings) {
      const n = r.length / 2
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = r[2 * i]!,
          yi = r[2 * i + 1]!,
          xj = r[2 * j]!,
          yj = r[2 * j + 1]!
        if (yi > yc !== yj > yc) xs.push(xi + ((yc - yi) * (xj - xi)) / (yj - yi))
      }
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (
        let c = Math.max(c0, Math.ceil((xs[k]! - x0) / res - 0.5));
        c <= Math.min(c0 + bc - 1, Math.floor((xs[k + 1]! - x0) / res - 0.5));
        c++
      )
        set((row - r0) * bc + c - c0)
  }
}

/** Distance from (x, y) to segment `s`, m. */
export const segmentDistance = (s: Segment, x: number, y: number): number => {
  const ex = s.bx - s.ax,
    ey = s.by - s.ay
  const len2 = ex * ex + ey * ey
  const u = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - s.ax) * ex + (y - s.ay) * ey) / len2)) : 0
  return Math.sqrt((x - s.ax - ex * u) ** 2 + (y - s.ay - ey * u) ** 2)
}

/**
 * Pushes a circle out of every segment it overlaps, leaving `skin`. Repeats
 * (up to PUSH_PASSES) because leaving one wall can push it into another, as
 * in a concave corner.
 */
export const pushOutSegments = (
  c: Vec2.Vec2,
  r: number,
  segs: ReadonlyArray<Segment>,
  skin = Collide2.defaultSkin,
): Vec2.Vec2 => {
  let at = c
  for (let pass = 0; pass < PUSH_PASSES; pass++) {
    const out = Collide2.pushOut(at, r, { segments: segs }, skin)
    if (out.x === at.x && out.y === at.y) break
    at = out
  }
  return at
}

// ponytail: a fixed number of push-out passes; a body squeezed between walls closer than its diameter can still overlap one. Upgrade: solve the contacts together.
const PUSH_PASSES = 4

/**
 * Moves a rigid group of circles (a pedestrian = one offset at 0,0; a car = a
 * row of offsets along its axis) by one shared `delta`, stopping at the earliest
 * contact of any circle and sliding along it.
 */
export const moveCircles = (
  center: Vec2.Vec2,
  offsets: ReadonlyArray<Vec2.Vec2>,
  delta: Vec2.Vec2,
  r: number,
  segs: ReadonlyArray<Segment>,
  skin = Collide2.defaultSkin,
): Collide2.MoveResult => {
  // Push-out per circle, repeated: freeing one circle of a car can push another into a wall.
  let position = center
  for (let pass = 0; pass < PUSH_PASSES; pass++) {
    const before = position
    for (const off of offsets) {
      const part = Vec2.add(position, off)
      position = Vec2.add(position, Vec2.subtract(pushOutSegments(part, r, segs, skin), part))
    }
    if (position.x === before.x && position.y === before.y) break
  }
  let rx = delta.x
  let ry = delta.y
  let blocked = false
  for (let i = 0; i < 4; i++) {
    if (rx * rx + ry * ry < 1e-12) break
    let hit: Collide2.Hit | undefined
    for (const off of offsets) {
      const origin = Vec2.add(position, off)
      for (const s of segs) {
        const h = Collide2.sweepCircleSegment(origin, { x: rx, y: ry }, r, s)
        if (h !== undefined && (hit === undefined || h.time < hit.time)) hit = h
      }
    }
    if (hit === undefined) {
      position = { x: position.x + rx, y: position.y + ry }
      break
    }
    blocked = true
    position = {
      x: position.x + rx * hit.time + hit.nx * skin,
      y: position.y + ry * hit.time + hit.ny * skin,
    }
    const remaining = 1 - hit.time
    rx *= remaining
    ry *= remaining
    const into = rx * hit.nx + ry * hit.ny
    if (into < 0) {
      rx -= into * hit.nx
      ry -= into * hit.ny
    }
  }
  return { position, blocked }
}

/** An axis-aligned box: minX, minY, maxX, maxY. */
type Box = readonly [number, number, number, number]

/**
 * Static broad phase for things that never move (walls, trees, road edges): a uniform grid over
 * `count` boxes, built once, with every cell's item indices packed into one Int32Array (SpatialGrid
 * is made to be rebuilt every step and keeps an array per cell: ~6x the memory for the map walls).
 * The query calls `visit` once for every item whose cells overlap the box (a superset: run the
 * exact test), in a fixed order: cells south to north, west to east, items by index.
 */
export const staticGrid = (count: number, boxOf: (item: number) => Box, cellSize: number) => {
  if (!(cellSize > 0)) throw new Error(`cell size must be > 0, got ${cellSize}`)
  // Each box asked for once, not again per cell pass: minX, minY, maxX, maxY at 4i (≈ 32 MB, freed once built, for the million trees).
  const boxes = new Float64Array(count * 4)
  let x0 = 0,
    y0 = 0,
    x1 = 0,
    y1 = 0
  for (let i = 0; i < count; i++) {
    // Indexed, not destructured: destructuring measured twice as slow over the million trees.
    const box = boxOf(i),
      ax = box[0],
      ay = box[1],
      bx = box[2],
      by = box[3]
    boxes[4 * i] = ax
    boxes[4 * i + 1] = ay
    boxes[4 * i + 2] = bx
    boxes[4 * i + 3] = by
    x0 = i === 0 ? ax : Math.min(x0, ax)
    y0 = i === 0 ? ay : Math.min(y0, ay)
    x1 = i === 0 ? bx : Math.max(x1, bx)
    y1 = i === 0 ? by : Math.max(y1, by)
  }
  const cols = Math.floor((x1 - x0) / cellSize) + 1,
    rows = Math.floor((y1 - y0) / cellSize) + 1
  const col = (x: number) => Math.floor((x - x0) / cellSize),
    row = (y: number) => Math.floor((y - y0) / cellSize)
  // `boxes` is passed, not captured: the query below shares this scope, and would keep it alive.
  const cells = (box: Float64Array, item: number, each: (cell: number) => void) => {
    const k = 4 * item
    for (let r = row(box[k + 1]!), r1 = row(box[k + 3]!); r <= r1; r++)
      for (let c = col(box[k]!), c1 = col(box[k + 2]!); c <= c1; c++) each(r * cols + c)
  }
  // Cell k's items are items[starts[k] .. starts[k + 1]): count them, sum, then fill.
  const starts = new Int32Array(cols * rows + 1)
  for (let i = 0; i < count; i++) cells(boxes, i, (k) => starts[k + 1]!++)
  for (let k = 0; k < cols * rows; k++) starts[k + 1]! += starts[k]!
  const items = new Int32Array(starts[cols * rows]!)
  const next = starts.slice(0, -1)
  for (let i = 0; i < count; i++) cells(boxes, i, (k) => (items[next[k]!++] = i))
  // seen[item] === query marks an item already visited by this query (items spanning several cells).
  const seen = new Int32Array(count)
  let query = 0
  return (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    visit: (item: number) => void,
  ): void => {
    if (query === 0x7fffffff) {
      seen.fill(0)
      query = 0
    }
    query++
    const c0 = Math.max(0, col(minX)),
      c1 = Math.min(cols - 1, col(maxX))
    for (let r = Math.max(0, row(minY)), r1 = Math.min(rows - 1, row(maxY)); r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        for (let j = starts[r * cols + c]!, end = starts[r * cols + c + 1]!; j < end; j++) {
          const item = items[j]!
          if (seen[item] === query) continue
          seen[item] = query
          visit(item)
        }
      }
  }
}

/** Whether (x, y) is inside a flat ring [x0, y0, x1, y1, ...] (even-odd). */
export const pointInRing = (x: number, y: number, ring: ReadonlyArray<number>): boolean => {
  let inside = false
  const n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i]!,
      yi = ring[2 * i + 1]!,
      xj = ring[2 * j]!,
      yj = ring[2 * j + 1]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
