// Plane geometry for the map build: local projection, the built terrain's box and clipping rings
// to a box, ring winding, point/segment distances and a bucketed segment index. The play area and
// clipping lines to it are play-area.ts's.

import { Ops } from "@typeonce/ritmo-math"

import { segD2, segT } from "../sim/collide.ts"
import { latLonToGaussBoaga, latLonToUtm32 } from "./crs.ts"
import { REGION, type Rect } from "./region.ts"

export type P = readonly [number, number]
/** A polyline vertex; `id` is the OSM node id, absent for points made by clipping. */
export interface V {
  readonly x: number
  readonly y: number
  readonly id?: string
}

export const ORIGIN = REGION.origin
export const M_PER_DEG = {
  lat: 111115.37,
  lon: REGION.id === "lunigiana" ? 79987.94 : 111320 * Ops.cos((ORIGIN.lat * Math.PI) / 180),
}
/** The built terrain's box, local metres: the box round every part's rectangles (region.ts), the play area (play-area.ts) inside it. */
export const BOUNDS = REGION.bounds
/** `BOUNDS` as a box [minX, minY, maxX, maxY]: what areas and land cover are clipped to (`clipRing`). */
export const TERRAIN_BOX: Rect = [BOUNDS.minX, BOUNDS.minY, BOUNDS.maxX, BOUNDS.maxY]

export const r1 = (v: number): number => Math.round(v * 10) / 10
export const toLocal = (lat: number, lon: number): P => [
  (lon - ORIGIN.lon) * M_PER_DEG.lon,
  (lat - ORIGIN.lat) * M_PER_DEG.lat,
]
/** Inverse of `toLocal`: [lat, lon]. */
export const fromLocal = (x: number, y: number): [number, number] => [
  ORIGIN.lat + y / M_PER_DEG.lat,
  ORIGIN.lon + x / M_PER_DEG.lon,
]
/**
 * Sutherland–Hodgman clip of an open ring to a box [minX, minY, maxX, maxY]. Only a convex window
 * clips a ring right, so the play area, which may not be, is never one: rings go to the built
 * terrain's box (`TERRAIN_BOX`).
 */
export const clipRing = (ring: ReadonlyArray<P>, [X0, Y0, X1, Y1]: Rect): Array<P> => {
  let poly: ReadonlyArray<P> = ring
  const edges: ReadonlyArray<readonly [(p: P) => boolean, (a: P, b: P) => P]> = [
    [(p) => p[0] >= X0, (a, b) => [X0, a[1] + ((b[1] - a[1]) * (X0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= X1, (a, b) => [X1, a[1] + ((b[1] - a[1]) * (X1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= Y0, (a, b) => [a[0] + ((b[0] - a[0]) * (Y0 - a[1])) / (b[1] - a[1]), Y0]],
    [(p) => p[1] <= Y1, (a, b) => [a[0] + ((b[0] - a[0]) * (Y1 - a[1])) / (b[1] - a[1]), Y1]],
  ]
  for (const [ins, cut] of edges) {
    const next: Array<P> = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[(i + poly.length - 1) % poly.length]!,
        b = poly[i]!
      if (ins(b)) {
        if (!ins(a)) next.push(cut(a, b))
        next.push(b)
      } else if (ins(a)) next.push(cut(a, b))
    }
    poly = next
    if (poly.length === 0) break
  }
  return [...poly]
}

/**
 * The EPSG:3003 box [e0, n0, e1, n1] round every corner of local rectangles, widened by `pad`
 * metres. The local frame turns against Gauss-Boaga's grid, so the box holds more than the
 * rectangles.
 */
export const gaussBoagaBox = (
  rects: ReadonlyArray<Rect>,
  pad = 0,
): [number, number, number, number] => boxOfCorners(rects, pad, latLonToGaussBoaga)

/** The UTM 32N box (EPSG:25832, 6707, 7791) [e0, n0, e1, n1] round every corner of local rectangles. */
export const utm32Box = (rects: ReadonlyArray<Rect>): [number, number, number, number] =>
  boxOfCorners(rects, 0, latLonToUtm32)

/** The box round every corner of `rects`, each projected by `project`, widened by `pad`. */
const boxOfCorners = (
  rects: ReadonlyArray<Rect>,
  pad: number,
  project: (lat: number, lon: number) => [number, number],
): [number, number, number, number] => {
  const corners = rects.flatMap(([x0, y0, x1, y1]) =>
    [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ].map(([x, y]) => project(...fromLocal(x!, y!))),
  )
  return [
    Math.min(...corners.map((c) => c[0])) - pad,
    Math.min(...corners.map((c) => c[1])) - pad,
    Math.max(...corners.map((c) => c[0])) + pad,
    Math.max(...corners.map((c) => c[1])) + pad,
  ]
}

export const signedArea = (r: ReadonlyArray<P>): number => {
  let s = 0
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!,
      q = r[(i + 1) % r.length]!
    s += p[0] * q[1] - q[0] * p[1]
  }
  return s / 2
}

/** Rounds to 0.1 m, drops repeated points, returns a flat ring with the requested winding (CCW = positive area), or undefined if degenerate. */
export const flatRing = (ring: ReadonlyArray<P>, ccw: boolean): Array<number> | undefined => {
  const pts: Array<P> = []
  for (const [x, y] of ring) {
    const p: P = [r1(x), r1(y)]
    const last = pts.at(-1)
    if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) pts.push(p)
  }
  while (pts.length > 1 && pts[0]![0] === pts.at(-1)![0] && pts[0]![1] === pts.at(-1)![1]) pts.pop()
  const area = signedArea(pts)
  if (pts.length < 3 || Math.abs(area) < 0.5) return undefined
  if (area > 0 !== ccw) pts.reverse()
  return pts.flatMap(([x, y]) => [x, y])
}

export const flatLine = (pts: ReadonlyArray<V>): Array<number> =>
  pts.flatMap((p) => [r1(p.x), r1(p.y)])

/** Vertex mean of a flat ring. */
export const centroid = (ring: ReadonlyArray<number>): P => {
  let cx = 0,
    cy = 0
  for (let i = 0; i < ring.length; i += 2)
    [cx, cy] = [cx + (2 * ring[i]!) / ring.length, cy + (2 * ring[i + 1]!) / ring.length]
  return [cx, cy]
}

/** Bounding box [x0, y0, x1, y1] of a flat ring or polyline. */
export const ringBox = (ring: ReadonlyArray<number>): [number, number, number, number] => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (let i = 0; i + 1 < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i]!)
    y0 = Math.min(y0, ring[i + 1]!)
    x1 = Math.max(x1, ring[i]!)
    y1 = Math.max(y1, ring[i + 1]!)
  }
  return [x0, y0, x1, y1]
}

export { fillPolygon, pointInRing, segD2, segDist2 } from "../sim/collide.ts"

/** Arc length at each vertex. */
export const arcLengths = (pts: ReadonlyArray<V>): Array<number> => {
  const s = [0]
  for (let i = 1; i < pts.length; i++)
    s.push(s[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y))
  return s
}

/** Linear interpolation of per-vertex values `z` at arc length `at` (arc lengths `s`). */
export const along = (s: ReadonlyArray<number>, z: ArrayLike<number>, at: number): number => {
  let i = 1
  while (i < s.length - 1 && s[i]! < at) i++
  const t = Math.max(0, Math.min(1, (at - s[i - 1]!) / (s[i]! - s[i - 1]! || 1)))
  return z[i - 1]! + (z[i]! - z[i - 1]!) * t
}

/** Bounding box [minX, minY, maxX, maxY] of a polyline. */
export const lineBox = (l: ReadonlyArray<V>): [number, number, number, number] => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  // Each bound on its own: an array a vertex made 9 GB of garbage in Lunigiana's sources stage.
  for (const p of l) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return [x0, y0, x1, y1]
}

/** Side of the squares `nearBoxes` marks, m. */
const NEAR_CELL = 64

/**
 * Whether a [minX, minY, maxX, maxY] box may meet any of `boxes`: true for every box that does, from
 * the NEAR_CELL m squares they cover, and for a few that only share such a square with one. An
 * index needs only the features that can meet its queries' boxes: those of every road took about a
 * gigabyte at the walls stage's start, where the parapets and the walls under the decks ask near
 * the bridges alone.
 */
export const nearBoxes = (
  boxes: ReadonlyArray<readonly [number, number, number, number]>,
): ((x0: number, y0: number, x1: number, y1: number) => boolean) => {
  const squares = new Set<number>()
  const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096)
  for (const [x0, y0, x1, y1] of boxes)
    for (let i = Math.floor(x0 / NEAR_CELL); i <= Math.floor(x1 / NEAR_CELL); i++)
      for (let j = Math.floor(y0 / NEAR_CELL); j <= Math.floor(y1 / NEAR_CELL); j++)
        squares.add(key(i, j))
  return (x0, y0, x1, y1) => {
    for (let i = Math.floor(x0 / NEAR_CELL); i <= Math.floor(x1 / NEAR_CELL); i++)
      for (let j = Math.floor(y0 / NEAR_CELL); j <= Math.floor(y1 / NEAR_CELL); j++)
        if (squares.has(key(i, j))) return true
    return false
  }
}

/** `box` grown by `r` on every side. */
export const grownBox = (
  [x0, y0, x1, y1]: readonly [number, number, number, number],
  r: number,
): [number, number, number, number] => [x0 - r, y0 - r, x1 + r, y1 + r]

export interface Crossing {
  readonly x: number
  readonly y: number
  readonly sa: number
  readonly sb: number
}

/** Whether two [minX, minY, maxX, maxY] boxes overlap (touching counts): where `crossings` can find any. */
export const boxesMeet = (
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): boolean => !(a[0] > b[2] || b[0] > a[2] || a[1] > b[3] || b[1] > a[3])

/** Points where polylines a and b meet (shared vertices included, duplicates dropped), with the arc length along each. */
export const crossings = (a: ReadonlyArray<V>, b: ReadonlyArray<V>): Array<Crossing> => {
  const out: Array<Crossing> = []
  if (!boxesMeet(lineBox(a), lineBox(b))) return out
  const la = arcLengths(a),
    lb = arcLengths(b)
  for (let i = 0; i + 1 < a.length; i++)
    for (let j = 0; j + 1 < b.length; j++) {
      const p = a[i]!,
        q = a[i + 1]!,
        r = b[j]!,
        s = b[j + 1]!
      const ex = q.x - p.x,
        ey = q.y - p.y,
        fx = s.x - r.x,
        fy = s.y - r.y,
        den = ex * fy - ey * fx
      if (den === 0) continue
      const t = ((r.x - p.x) * fy - (r.y - p.y) * fx) / den,
        u = ((r.x - p.x) * ey - (r.y - p.y) * ex) / den
      if (t < 0 || t > 1 || u < 0 || u > 1) continue
      const x = p.x + ex * t,
        y = p.y + ey * t
      if (out.some((c) => Math.abs(c.x - x) < 0.05 && Math.abs(c.y - y) < 0.05)) continue
      out.push({
        x,
        y,
        sa: la[i]! + t * (la[i + 1]! - la[i]!),
        sb: lb[j]! + u * (lb[j + 1]! - lb[j]!),
      })
    }
  return out
}

/**
 * The ends of polyline `a` (its first and last vertex) lying within `reach` of polyline `b`, square
 * to it between its ends (not past its first or last vertex), with the arc length along each, as
 * `crossings` gives a meeting.
 */
export const endsUnder = (
  a: ReadonlyArray<V>,
  b: ReadonlyArray<V>,
  reach: number,
): Array<Crossing> => {
  if (a.length < 2) return []
  const out: Array<Crossing> = []
  const lb = arcLengths(b)
  for (const [p, sa] of [
    [a[0]!, 0],
    [a.at(-1)!, arcLengths(a).at(-1)!],
  ] as const) {
    let best = reach * reach,
      sb: number | undefined
    for (let j = 0; j + 1 < b.length; j++) {
      const t = segT(p.x, p.y, b[j]!.x, b[j]!.y, b[j + 1]!.x, b[j + 1]!.y),
        d2 = segD2(p.x, p.y, b[j]!.x, b[j]!.y, b[j + 1]!.x, b[j + 1]!.y, t)
      if ((t <= 0 && j === 0) || (t >= 1 && j + 2 === b.length) || d2 > best) continue
      ;[best, sb] = [d2, lb[j]! + t * (lb[j + 1]! - lb[j]!)]
    }
    if (sb !== undefined) out.push({ x: p.x, y: p.y, sa, sb })
  }
  return out
}

/** Point and unit tangent at arc length `at` along a polyline with precomputed arc lengths. */
export const pointAt = (
  pts: ReadonlyArray<V>,
  s: ReadonlyArray<number>,
  at: number,
): { x: number; y: number; tx: number; ty: number } => {
  let i = 1
  while (i < pts.length - 1 && s[i]! < at) i++
  const a = pts[i - 1]!,
    b = pts[i]!,
    len = s[i]! - s[i - 1]! || 1
  const t = Math.max(0, Math.min(1, (at - s[i - 1]!) / len))
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    tx: (b.x - a.x) / len,
    ty: (b.y - a.y) / len,
  }
}

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

/** Deterministic hash of integers to [0, 1). */
export const hash01 = (...ns: ReadonlyArray<number>): number => {
  let h = 0x9e3779b9
  for (const n of ns) {
    h = Math.imul(h ^ (n | 0), 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    h ^= h >>> 16
  }
  return (h >>> 0) / 4294967296
}
