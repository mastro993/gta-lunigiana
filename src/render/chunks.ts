/**
 * The chunk grid the static world is cut into (128 m squares over the heightmap plus its apron)
 * and the streaming plan: which chunks to build and which to drop for a camera focus. Distances
 * are measured on the screen plane (the camera's right and up axes) against each chunk's box,
 * terrain relief included, so a valley far below a ridge still counts as near when the camera
 * shows it next to the focus.
 *
 * @module render/chunks
 */
import type { Vector3 } from "three"

import { MAP } from "../sim/map/index.ts"
import { terrainNodeY, yOf } from "./ground.ts"

const hm = MAP.heightmap
/** Cells per chunk side (32 × 4 m = 128 m). */
const CHUNK_CELLS = 32
/** Chunk side in metres. */
const CHUNK = CHUNK_CELLS * hm.cell
/**
 * Apron cells beyond each map edge (192 m): more than the camera shows past the bounds from any
 * road, mountain edges included (where the SP10 leaves the map the view reaches about 150 m out).
 */
export const APRON = 48
/** Heightmap cells along x and y. */
const CELLS = { x: hm.cols - 1, y: hm.rows - 1 } as const
/** South-west corner of chunk (0, 0), metres. */
const ORIGIN = { x: hm.x0 - APRON * hm.cell, y: hm.y0 - APRON * hm.cell } as const
/** Chunk counts along x and y, apron included. */
export const CHUNKS = {
  x: Math.ceil((CELLS.x + 2 * APRON) / CHUNK_CELLS),
  y: Math.ceil((CELLS.y + 2 * APRON) / CHUNK_CELLS),
} as const

/** Chunk key of a map point (any static piece goes in the chunk holding its anchor); clamps to the grid. */
export const chunkOf = (x: number, y: number): number => {
  const cx = Math.min(CHUNKS.x - 1, Math.max(0, Math.floor((x - ORIGIN.x) / CHUNK)))
  const cy = Math.min(CHUNKS.y - 1, Math.max(0, Math.floor((y - ORIGIN.y) / CHUNK)))
  return cy * CHUNKS.x + cx
}

/** Heightmap cells [i0, i1) × [j0, j1) of chunk `key`; apron cells lie outside the grid (negative or past the end). */
export const chunkCells = (
  key: number,
): { readonly i0: number; readonly j0: number; readonly i1: number; readonly j1: number } => {
  const i0 = -APRON + (key % CHUNKS.x) * CHUNK_CELLS,
    j0 = -APRON + Math.floor(key / CHUNKS.x) * CHUNK_CELLS
  return {
    i0,
    j0,
    i1: Math.min(i0 + CHUNK_CELLS, CELLS.x + APRON),
    j1: Math.min(j0 + CHUNK_CELLS, CELLS.y + APRON),
  }
}

/** The map square chunk `key` covers, metres: its cells' (`chunkCells`) outer edges. */
export const chunkRect = (
  key: number,
): {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
} => {
  const { i0, j0, i1, j1 } = chunkCells(key)
  return {
    minX: hm.x0 + i0 * hm.cell,
    minY: hm.y0 + j0 * hm.cell,
    maxX: hm.x0 + i1 * hm.cell,
    maxY: hm.y0 + j1 * hm.cell,
  }
}

/** Room above a chunk's highest terrain node for what stands on it (towers, roofs, trees), m. */
const HEADROOM = 50
/** Room below its lowest node (river beds), m. */
const FOOTROOM = 5

/**
 * Writes chunk `key`'s box into `out` at `6 * key`: (x0, x1, y0, y1, low, high), map metres and
 * three-space heights, its terrain from `bottom` to `top` (render y) plus room for what stands on it.
 */
const putBox = (out: Float32Array, key: number, bottom: number, top: number): void => {
  const { minX, minY, maxX, maxY } = chunkRect(key)
  out.set([minX, maxX, minY, maxY, bottom - FOOTROOM, top + HEADROOM], key * 6)
}

/** Writes chunk `key`'s box (see `putBox`) from its terrain nodes, which must be in memory; the slow part of a box. */
export const exactBox = (out: Float32Array, key: number): void => {
  const { i0, j0, i1, j1 } = chunkCells(key)
  let low = Number.MAX_VALUE,
    high = -Number.MAX_VALUE
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const h = terrainNodeY(i, j)
      low = Math.min(low, h)
      high = Math.max(high, h)
    }
  putBox(out, key, low, high)
}

/**
 * Writes chunk `key`'s box (see `putBox`) from the lowest and highest node (`zmin`, `zmax`,
 * decimetres) of the tiles its terrain lies in, read before they are in memory: it holds the exact
 * box, so the chunk counts as near no later than it is.
 */
export const boundBox = (
  out: Float32Array,
  key: number,
  tiles: ReadonlyArray<{ readonly zmin: number; readonly zmax: number }>,
): void => {
  let low = Number.MAX_VALUE,
    high = -Number.MAX_VALUE
  for (const { zmin, zmax } of tiles) {
    low = Math.min(low, zmin / 10)
    high = Math.max(high, zmax / 10)
  }
  putBox(out, key, yOf(low), yOf(high))
}

/** Writes the screen-plane rectangle of box `key` of `boxes` (`putBox`'s layout) into `out` at `at`: (right0, right1, up0, up1). */
const rectOf = (
  boxes: Float32Array,
  key: number,
  right: Vector3,
  up: Vector3,
  out: Float32Array,
  at: number,
): void => {
  let r0 = Number.MAX_VALUE,
    r1 = -Number.MAX_VALUE,
    u0 = Number.MAX_VALUE,
    u1 = -Number.MAX_VALUE
  for (let corner = 0; corner < 8; corner++) {
    const x = boxes[key * 6 + (corner & 1)]!,
      y = boxes[key * 6 + 2 + ((corner >> 1) & 1)]!,
      h = boxes[key * 6 + 4 + (corner >> 2)]!
    // three space: (x, h, -y)
    const r = x * right.x + h * right.y - y * right.z,
      u = x * up.x + h * up.y - y * up.z
    r0 = Math.min(r0, r)
    r1 = Math.max(r1, r)
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
  }
  out[at] = r0
  out[at + 1] = r1
  out[at + 2] = u0
  out[at + 3] = u1
}

/**
 * The screen-plane rectangle of every box of `boxes` (`putBox`'s layout) for a camera with axes
 * `right` and `up` (three space), written into `out`: flat (right0, right1, up0, up1) per key.
 */
export const screenRects = (
  boxes: Float32Array,
  right: Vector3,
  up: Vector3,
  out: Float32Array,
): Float32Array => {
  for (let key = 0; key < out.length / 4; key++) rectOf(boxes, key, right, up, out, key * 4)
  return out
}

/** Screen distance (m) from the point (r, u) to rectangle `key` of `rects`. */
const distanceTo = (rects: Float32Array, key: number, r: number, u: number): number =>
  Math.hypot(
    Math.max(rects[key * 4]! - r, 0, r - rects[key * 4 + 1]!),
    Math.max(rects[key * 4 + 2]! - u, 0, u - rects[key * 4 + 3]!),
  )

/** Screen distance (m) from the point (r, u) to each rectangle of `rects`, written into `out`. */
export const screenDistances = (
  rects: Float32Array,
  r: number,
  u: number,
  out: Float32Array,
): Float32Array => {
  for (let key = 0; key < out.length; key++) out[key] = distanceTo(rects, key, r, u)
  return out
}

const scratch = new Float32Array(4)
/** Screen distance (m) from the point (r, u) to box `key` of `boxes` for a camera with axes `right` and `up`: one box of `screenRects` and `screenDistances`. */
export const screenDistance = (
  boxes: Float32Array,
  key: number,
  right: Vector3,
  up: Vector3,
  r: number,
  u: number,
): number => {
  rectOf(boxes, key, right, up, scratch, 0)
  return distanceTo(scratch, 0, r, u)
}

/** Load and unload radii, screen metres; `unload` > `load` keeps a chunk at the rim from flickering in and out. */
interface Radii {
  readonly load: number
  readonly unload: number
}

/** Screen metres kept loaded beyond what the view shows: a chunk is built well before it comes into sight. */
const MARGIN = 64

/**
 * Radii for a view that shows `reach` screen metres from its centre: load within the margin,
 * drop one chunk side further out.
 */
export const radiiFor = (reach: number): Radii => ({
  load: reach + MARGIN,
  unload: reach + MARGIN + CHUNK,
})

/**
 * The streaming plan for the chunks of `distances` (screen distance by key; every loaded chunk
 * among them): chunks to build (not loaded, within `load`), nearest first, and loaded chunks to
 * drop (beyond `unload`). Chunks between the two radii stay as they are; equally near ones build
 * in key order.
 */
export const plan = (
  distances: ReadonlyMap<number, number>,
  loaded: { has: (key: number) => boolean },
  radii: Radii,
) => {
  const build: Array<number> = [],
    drop: Array<number> = []
  for (const [key, d] of distances) {
    if (loaded.has(key)) {
      if (d > radii.unload) drop.push(key)
    } else if (d <= radii.load) build.push(key)
  }
  build.sort((a, b) => distances.get(a)! - distances.get(b)! || a - b)
  return { build, drop }
}
