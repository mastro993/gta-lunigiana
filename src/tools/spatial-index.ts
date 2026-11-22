// Bucketed indexes for the map build's "what lies near this point" queries, on a square grid:
// segments with a buffer radius each, added as they come (`segIndex`) or fixed and packed
// (`staticSegs`), and fixed points (`staticPoints`). They hold their entries in typed arrays, since
// an object an entry and an array a bucket took hundreds of megabytes at Lunigiana's size. The rest
// of the map build's plane geometry is geometry.ts's.

import { segD2, segT } from "../sim/collide.ts"
import type { V } from "./geometry.ts"

interface Buffered<T> {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
  readonly r: number
  readonly data: T
}

/** `a` with room for `n` values, its values kept: itself, or a copy twice as long or more. */
const roomF64 = (a: Float64Array<ArrayBuffer>, n: number): Float64Array<ArrayBuffer> => {
  if (n <= a.length) return a
  const b = new Float64Array(Math.max(n, 2 * a.length))
  b.set(a)
  return b
}
/** `roomF64` for an Int32Array. */
const roomI32 = (a: Int32Array<ArrayBuffer>, n: number): Int32Array<ArrayBuffer> => {
  if (n <= a.length) return a
  const b = new Int32Array(Math.max(n, 2 * a.length))
  b.set(a)
  return b
}

/**
 * Segments with a buffer radius each, bucketed on a square grid for "is this point within r of a
 * segment" queries. Each segment's ends and radius lie in one Float64Array and each bucket's
 * segments in a chain of entries in Int32Arrays, in the order added: an object a segment and an
 * array a bucket took about 300 MB of the walls' indexes of Lunigiana's roads and water. The query
 * hands `visit` an object of its own for each segment it meets, which goes once the visit is done.
 */
export const segIndex = <T>(bucket = 16) => {
  // Segment k's ends and radius at 5k, and its data.
  let geo = new Float64Array(5 * 64)
  const data: Array<T> = []
  // Each bucket's number by its key, and its first and last entry.
  const numbers = new Map<number, number>()
  let first = new Int32Array(64),
    last = new Int32Array(64)
  // Each entry's segment and the next entry of its bucket (-1 after the last).
  let segOf = new Int32Array(256),
    after = new Int32Array(256),
    entries = 0
  const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096)
  const add = (ax: number, ay: number, bx: number, by: number, r: number, item: T) => {
    const k = data.length
    geo = roomF64(geo, 5 * k + 5)
    geo[5 * k] = ax
    geo[5 * k + 1] = ay
    geo[5 * k + 2] = bx
    geo[5 * k + 3] = by
    geo[5 * k + 4] = r
    data.push(item)
    for (
      let i = Math.floor((Math.min(ax, bx) - r) / bucket);
      i <= Math.floor((Math.max(ax, bx) + r) / bucket);
      i++
    )
      for (
        let j = Math.floor((Math.min(ay, by) - r) / bucket);
        j <= Math.floor((Math.max(ay, by) + r) / bucket);
        j++
      ) {
        segOf = roomI32(segOf, entries + 1)
        after = roomI32(after, entries + 1)
        segOf[entries] = k
        after[entries] = -1
        const q = key(i, j),
          b = numbers.get(q)
        if (b === undefined) {
          const n = numbers.size
          numbers.set(q, n)
          first = roomI32(first, n + 1)
          last = roomI32(last, n + 1)
          first[n] = entries
          last[n] = entries
        } else {
          after[last[b]!] = entries
          last[b] = entries
        }
        entries++
      }
  }
  const addLine = (pts: ReadonlyArray<V> | ReadonlyArray<number>, r: number, item: T) => {
    if (typeof pts[0] === "number") {
      const xy = pts as ReadonlyArray<number>
      for (let i = 0; i + 3 < xy.length; i += 2)
        add(xy[i]!, xy[i + 1]!, xy[i + 2]!, xy[i + 3]!, r, item)
    } else {
      const vs = pts as ReadonlyArray<V>
      for (let i = 0; i + 1 < vs.length; i++)
        add(vs[i]!.x, vs[i]!.y, vs[i + 1]!.x, vs[i + 1]!.y, r, item)
    }
  }
  /** Calls `visit` for each segment whose buffer contains (x,y), with the squared distance and projection t. */
  const within = (x: number, y: number, visit: (s: Buffered<T>, d2: number, t: number) => void) => {
    const b = numbers.get(key(Math.floor(x / bucket), Math.floor(y / bucket)))
    if (b === undefined) return
    for (let e = first[b]!; e >= 0; e = after[e]!) {
      const k = segOf[e]!,
        ax = geo[5 * k]!,
        ay = geo[5 * k + 1]!,
        bx = geo[5 * k + 2]!,
        by = geo[5 * k + 3]!,
        r = geo[5 * k + 4]!
      const t = segT(x, y, ax, ay, bx, by),
        d2 = segD2(x, y, ax, ay, bx, by, t)
      if (d2 < r * r) visit({ ax, ay, bx, by, r, data: data[k] as T }, d2, t)
    }
  }
  const covers = (x: number, y: number, pred?: (data: T) => boolean): boolean => {
    let hit = false
    within(x, y, (s) => {
      if (pred === undefined || pred(s.data)) hit = true
    })
    return hit
  }
  return { add, addLine, within, covers }
}

/**
 * `segIndex` over a fixed set of flat (ax, ay, bx, by) segments, all with buffer radius `r`, the
 * segments of `parts` one after another (the clearance's walls and their shore's, with no copy of
 * both): the same buckets, each one's segment indices packed into one Int32Array in the order added
 * (an object a segment and an array a bucket took about 500 MB at Lunigiana's 1.7 million walls).
 * The query calls `visit` with the index of each segment whose buffer contains (x, y), in index
 * order, the squared distance and the segment.
 */
export const staticSegs = (parts: ReadonlyArray<ArrayLike<number>>, r: number, bucket = 16) => {
  // The segments each part ends at, counted from the first part's first.
  const ends: Array<number> = []
  let count = 0
  for (const xy of parts) ends.push((count += Math.floor(xy.length / 4)))
  let ax = 0,
    ay = 0,
    bx = 0,
    by = 0
  /** Segment k into (ax, ay, bx, by). */
  const load = (k: number) => {
    let p = 0
    while (k >= ends[p]!) p++
    const xy = parts[p]!,
      o = 4 * (k - (p === 0 ? 0 : ends[p - 1]!))
    ax = xy[o]!
    ay = xy[o + 1]!
    bx = xy[o + 2]!
    by = xy[o + 3]!
  }
  // Each segment's buckets, as segIndex's `add` takes them.
  const span = (k: number) => {
    load(k)
    return [
      Math.floor((Math.min(ax, bx) - r) / bucket),
      Math.floor((Math.max(ax, bx) + r) / bucket),
      Math.floor((Math.min(ay, by) - r) / bucket),
      Math.floor((Math.max(ay, by) + r) / bucket),
    ] as const
  }
  let i0 = Infinity,
    i1 = -Infinity,
    j0 = Infinity,
    j1 = -Infinity
  for (let k = 0; k < count; k++) {
    const [a, b, c, d] = span(k)
    i0 = Math.min(i0, a)
    i1 = Math.max(i1, b)
    j0 = Math.min(j0, c)
    j1 = Math.max(j1, d)
  }
  const cols = count === 0 ? 0 : i1 - i0 + 1,
    rows = count === 0 ? 0 : j1 - j0 + 1
  // Bucket q's segments are items[starts[q] .. starts[q + 1]): count them, sum, then fill.
  const starts = new Int32Array(cols * rows + 1)
  const each = (k: number, f: (q: number) => void) => {
    const [a, b, c, d] = span(k)
    for (let i = a; i <= b; i++) for (let j = c; j <= d; j++) f((j - j0) * cols + i - i0)
  }
  for (let k = 0; k < count; k++) each(k, (q) => starts[q + 1]!++)
  for (let q = 0; q < cols * rows; q++) starts[q + 1]! += starts[q]!
  const items = new Int32Array(starts[cols * rows]!)
  const next = starts.slice(0, -1)
  for (let k = 0; k < count; k++) each(k, (q) => (items[next[q]!++] = k))
  return (
    x: number,
    y: number,
    visit: (k: number, d2: number, ax: number, ay: number, bx: number, by: number) => void,
  ) => {
    const i = Math.floor(x / bucket) - i0,
      j = Math.floor(y / bucket) - j0
    if (!(i >= 0 && j >= 0 && i < cols && j < rows)) return
    const q = j * cols + i
    for (let m = starts[q]!; m < starts[q + 1]!; m++) {
      const k = items[m]!
      load(k)
      const d2 = segD2(x, y, ax, ay, bx, by)
      if (d2 < r * r) visit(k, d2, ax, ay, bx, by)
    }
  }
}

/**
 * `staticGrid` (sim/collide.ts) over points, the i-th at (xy[stride·i], xy[stride·i + 1]): the same
 * cells and the same query, its visits in the same order, without the box `staticGrid` keeps a
 * point while it builds or the mark it keeps an item for those that span cells (both 270 MB at
 * Lunigiana's 7.4 million trees).
 */
export const staticPoints = (xy: ArrayLike<number>, stride: number, cellSize: number) => {
  const count = Math.floor(xy.length / stride)
  let x0 = 0,
    y0 = 0,
    x1 = 0,
    y1 = 0
  for (let i = 0; i < count; i++) {
    const x = xy[stride * i]!,
      y = xy[stride * i + 1]!
    x0 = i === 0 ? x : Math.min(x0, x)
    y0 = i === 0 ? y : Math.min(y0, y)
    x1 = i === 0 ? x : Math.max(x1, x)
    y1 = i === 0 ? y : Math.max(y1, y)
  }
  const cols = Math.floor((x1 - x0) / cellSize) + 1,
    rows = Math.floor((y1 - y0) / cellSize) + 1
  const col = (x: number) => Math.floor((x - x0) / cellSize),
    row = (y: number) => Math.floor((y - y0) / cellSize)
  const cellOf = (i: number) => row(xy[stride * i + 1]!) * cols + col(xy[stride * i]!)
  // Cell k's points are items[starts[k] .. starts[k + 1]): count them, sum, then fill.
  const starts = new Int32Array(cols * rows + 1)
  for (let i = 0; i < count; i++) starts[cellOf(i) + 1]!++
  for (let k = 0; k < cols * rows; k++) starts[k + 1]! += starts[k]!
  const items = new Int32Array(count)
  const next = starts.slice(0, -1)
  for (let i = 0; i < count; i++) items[next[cellOf(i)]!++] = i
  return (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    visit: (item: number) => void,
  ): void => {
    const c0 = Math.max(0, col(minX)),
      c1 = Math.min(cols - 1, col(maxX))
    for (let r = Math.max(0, row(minY)), r1 = Math.min(rows - 1, row(maxY)); r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        for (let j = starts[r * cols + c]!, end = starts[r * cols + c + 1]!; j < end; j++)
          visit(items[j]!)
  }
}
