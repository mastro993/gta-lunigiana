/**
 * Broad phases cut by tile that answer as one: each tile's items (walls, trees) are gridded on the
 * whole map's lattice for their kind (`MAP.walls.lattice`: 16 m cells from the lowest corner of any
 * item of the kind), and a query walks the lattice's cells south to north, west to east, each cell's
 * items in the whole map's order (merged across the tiles that hold some), each item once. That is
 * the order the single whole-map broad phase (`staticGrid`) gave before the map was cut into tiles,
 * so every collision resolves exactly as it did (the physics pushes out of walls one by one and keeps
 * the first of equal-time hits), whichever tiles are in memory.
 *
 * @module map/lattice
 */

/** Cell side of the wall and tree broad phases, m (car and person queries span one to four cells). */
export const CELL = 16

/** A lattice's south-west corner, m. */
export type Corner = readonly [x: number, y: number]

/** One tile's items of one kind on the lattice: per cell (the tile's own window of it) its items, ascending. */
export interface CellGrid {
  /** The window's first column and row on the lattice, and its size in cells. */
  readonly c0: number
  readonly r0: number
  readonly cols: number
  readonly rows: number
  /** Cell k's items are `items[starts[k]] … items[starts[k + 1] − 1]`. */
  readonly starts: Int32Array
  readonly items: Int32Array
  /** Each item's index in the whole map's list of its kind, ascending with the item. */
  readonly ids: ArrayLike<number>
  /** `seen[item] === stamp` once the current query has visited the item. */
  readonly seen: Int32Array
  /** The grid's query count, which marks what the current query has seen. */
  stamp: number
}

/** The cell index of coordinate `v` on a lattice from `origin`, as `staticGrid` computes it. */
const cellOf = (v: number, origin: number) => Math.floor((v - origin) / CELL)

/**
 * The box's cells on the lattice from `at`, as a box: a query answers every item in them (a superset
 * of the box), so it reads every tile those cells reach.
 */
export const cellBox = (
  at: Corner,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): readonly [number, number, number, number] => [
  at[0] + CELL * cellOf(minX, at[0]),
  at[1] + CELL * cellOf(minY, at[1]),
  at[0] + CELL * (cellOf(maxX, at[0]) + 1),
  at[1] + CELL * (cellOf(maxY, at[1]) + 1),
]

/** `count` items with boxes `boxOf` (minX, minY, maxX, maxY) and whole-map indices `ids`, gridded on the lattice from `at`. */
export const cellGrid = (
  count: number,
  boxOf: (item: number) => readonly [number, number, number, number],
  ids: ArrayLike<number>,
  at: Corner,
): CellGrid => {
  const boxes = new Float64Array(4 * count)
  let c0 = Infinity,
    c1 = -Infinity,
    r0 = Infinity,
    r1 = -Infinity
  for (let i = 0; i < count; i++) {
    const box = boxOf(i)
    boxes.set(box, 4 * i)
    c0 = Math.min(c0, cellOf(box[0], at[0]))
    r0 = Math.min(r0, cellOf(box[1], at[1]))
    c1 = Math.max(c1, cellOf(box[2], at[0]))
    r1 = Math.max(r1, cellOf(box[3], at[1]))
  }
  if (count === 0) [c0, c1, r0, r1] = [0, -1, 0, -1]
  const cols = c1 - c0 + 1,
    rows = r1 - r0 + 1
  const each = (item: number, visit: (cell: number) => void) => {
    const k = 4 * item
    for (let r = cellOf(boxes[k + 1]!, at[1]), e = cellOf(boxes[k + 3]!, at[1]); r <= e; r++)
      for (let c = cellOf(boxes[k]!, at[0]), f = cellOf(boxes[k + 2]!, at[0]); c <= f; c++)
        visit((r - r0) * cols + c - c0)
  }
  const starts = new Int32Array(cols * rows + 1)
  for (let i = 0; i < count; i++) each(i, (k) => starts[k + 1]!++)
  for (let k = 0; k < cols * rows; k++) starts[k + 1]! += starts[k]!
  const items = new Int32Array(starts[cols * rows]!)
  const next = starts.slice(0, -1)
  for (let i = 0; i < count; i++) each(i, (k) => (items[next[k]!++] = i))
  return { c0, r0, cols, rows, starts, items, ids, seen: new Int32Array(count), stamp: 0 }
}

/** Scratch for a cell's lists across tiles: their grid, next item and end. */
const heads: Array<number> = [],
  ends: Array<number> = [],
  which: Array<number> = []

/**
 * Calls `visit(grid, item)` with every item of `grids` (one per tile, any order) in a cell the box
 * overlaps on the lattice from `at`: cells south to north, west to east, each cell's items in the
 * whole map's order, each item once. `visit` must not query again.
 */
export const queryCells = (
  grids: ReadonlyArray<CellGrid>,
  at: Corner,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  visit: (grid: number, item: number) => void,
): void => {
  if (grids.length === 0) return
  for (const g of grids) {
    if (g.stamp === 0x7fffffff) {
      g.seen.fill(0)
      g.stamp = 0
    }
    g.stamp++
  }
  // Only the cells some grid has: a huge box walks no empty lattice.
  let lo = Infinity,
    hi = -Infinity,
    bottom = Infinity,
    top = -Infinity
  for (const g of grids) {
    lo = Math.min(lo, g.c0)
    hi = Math.max(hi, g.c0 + g.cols - 1)
    bottom = Math.min(bottom, g.r0)
    top = Math.max(top, g.r0 + g.rows - 1)
  }
  const c0 = Math.max(lo, cellOf(minX, at[0])),
    c1 = Math.min(hi, cellOf(maxX, at[0])),
    r0 = Math.max(bottom, cellOf(minY, at[1])),
    r1 = Math.min(top, cellOf(maxY, at[1]))
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      let n = 0
      for (let g = 0; g < grids.length; g++) {
        const grid = grids[g]!,
          i = c - grid.c0,
          j = r - grid.r0
        if (i < 0 || j < 0 || i >= grid.cols || j >= grid.rows) continue
        const k = j * grid.cols + i
        if (grid.starts[k] === grid.starts[k + 1]) continue
        heads[n] = grid.starts[k]!
        ends[n] = grid.starts[k + 1]!
        which[n++] = g
      }
      // Most cells lie in one tile; where several hold items, take them in the whole map's order.
      for (;;) {
        let best = -1,
          id = Infinity
        for (let m = 0; m < n; m++) {
          if (heads[m]! >= ends[m]!) continue
          const grid = grids[which[m]!]!,
            v = grid.ids[grid.items[heads[m]!]!]!
          if (v < id) [best, id] = [m, v]
        }
        if (best < 0) break
        const g = which[best]!,
          grid = grids[g]!,
          item = grid.items[heads[best]!++]!
        if (grid.seen[item] === grid.stamp) continue
        grid.seen[item] = grid.stamp
        visit(g, item)
      }
    }
}
