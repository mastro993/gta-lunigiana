// The play area: the union of the region's parts, each its mask or else its rectangles. Its
// outline (`OUTLINE`: chained rings on 0.1 m, outer counter-clockwise, holes clockwise, collinear
// runs merged, each ring from its lowest (y, x) vertex) is what the map's lines are clipped to and
// walled along, and what the global file carries as `outline`. The built terrain is the box round
// every part's rectangles (`BOUNDS`), which may hold land outside the play area. Only + − × ÷ and
// sqrt, so every architecture builds the same outline; on vertical and horizontal edges the
// clipping is Liang–Barsky's to the bit.
import { edgeDistance, insideRings, ringsDistance, type Rings } from "../sim/map/outline.ts"
import { pointInRing, segDist2, type V } from "./geometry.ts"
import { type Part, REGION } from "./region.ts"

/** Within this distance (m) a point lies on a piece's edge, or a crossing on an outline edge. */
const ON = 1e-6
/** How far (m) beside a cut edge's middle the union is probed: at most this, and a hundredth of the edge. */
const PROBE = 1e-3
/**
 * A stretch of a line shorter than this (m) between two crossings of the outline is outside: the
 * line passes a corner, crossing both its edges' lines within this of each other, as Liang–Barsky
 * takes the later of two entries and the earlier of two exits.
 */
const SLIVER = 1e-5

/** Each part's pieces: its mask, or each of its rectangles, as counter-clockwise flat rings. */
const piecesOf = (parts: ReadonlyArray<Part>): Array<ReadonlyArray<number>> =>
  parts.flatMap((p) =>
    p.mask === undefined
      ? p.rects.map(([x0, y0, x1, y1]) => [x0, y0, x1, y0, x1, y1, x0, y1])
      : [p.mask],
  )

interface Edge {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
  readonly piece: number
}
/** A point cutting an edge, `t` its place along it. */
interface Cut {
  readonly t: number
  readonly x: number
  readonly y: number
}

/** Where along edge e (0 at a, 1 at b) the point (x, y) on it lies. */
const along = (e: Edge, x: number, y: number) => {
  const ex = e.bx - e.ax,
    ey = e.by - e.ay
  return ((x - e.ax) * ex + (y - e.ay) * ey) / (ex * ex + ey * ey)
}
const onEdge = (e: Edge, x: number, y: number) =>
  segDist2(x, y, e.ax, e.ay, e.bx, e.by).d2 <= ON * ON

/** Where e and f cross inside both, or undefined; a vertical and a horizontal edge meet exactly. */
const crossing = (e: Edge, f: Edge): { x: number; y: number } | undefined => {
  const ex = e.bx - e.ax,
    ey = e.by - e.ay,
    fx = f.bx - f.ax,
    fy = f.by - f.ay,
    den = ex * fy - ey * fx
  if (den === 0) return undefined
  const t = ((f.ax - e.ax) * fy - (f.ay - e.ay) * fx) / den,
    u = ((f.ax - e.ax) * ey - (f.ay - e.ay) * ex) / den
  if (!(t > 0 && t < 1 && u > 0 && u < 1)) return undefined
  if (ex === 0 && fy === 0) return { x: e.ax, y: f.ay }
  if (ey === 0 && fx === 0) return { x: f.ax, y: e.ay }
  return { x: e.ax + ex * t, y: e.ay + ey * t }
}

/** Every piece edge cut where an edge of another piece crosses it or ends on it. */
const cutEdges = (pieces: ReadonlyArray<ReadonlyArray<number>>) => {
  const edges: Array<Edge> = []
  pieces.forEach((ring, piece) => {
    for (let i = 0, n = ring.length / 2; i < n; i++) {
      const j = (i + 1) % n
      edges.push({
        ax: ring[2 * i]!,
        ay: ring[2 * i + 1]!,
        bx: ring[2 * j]!,
        by: ring[2 * j + 1]!,
        piece,
      })
    }
  })
  const cuts: Array<Array<Cut>> = edges.map((e) => [
    { t: 0, x: e.ax, y: e.ay },
    { t: 1, x: e.bx, y: e.by },
  ])
  const box = (e: Edge) =>
    [
      Math.min(e.ax, e.bx),
      Math.min(e.ay, e.by),
      Math.max(e.ax, e.bx),
      Math.max(e.ay, e.by),
    ] as const
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const e = edges[i]!,
        f = edges[j]!,
        [ex0, ey0, ex1, ey1] = box(e),
        [fx0, fy0, fx1, fy1] = box(f)
      if (
        e.piece === f.piece ||
        ex0 > fx1 + ON ||
        fx0 > ex1 + ON ||
        ey0 > fy1 + ON ||
        fy0 > ey1 + ON
      )
        continue
      let touch = false
      for (const [g, h, k] of [
        [e, f, i],
        [f, e, j],
      ] as const)
        for (const [x, y] of [
          [h.ax, h.ay],
          [h.bx, h.by],
        ] as const)
          if (onEdge(g, x, y)) {
            cuts[k]!.push({ t: along(g, x, y), x, y })
            touch = true
          }
      const p = touch ? undefined : crossing(e, f)
      if (p === undefined) continue
      cuts[i]!.push({ t: along(e, p.x, p.y), ...p })
      cuts[j]!.push({ t: along(f, p.x, p.y), ...p })
    }
  return { edges, cuts }
}

/** How far clockwise direction w turns from direction r, as a number in (0, 4] growing with the angle. */
const clockwise = (rx: number, ry: number, wx: number, wy: number): number => {
  const c = rx * wy - ry * wx,
    cos = (rx * wx + ry * wy) / Math.sqrt((rx * rx + ry * ry) * (wx * wx + wy * wy))
  if (c < 0) return 1 - cos
  if (c > 0) return 3 + cos
  return cos < 0 ? 2 : 4
}

/** Whole decimetres. */
const dm = (v: number) => Math.round(v * 10)

/** A ring of whole decimetres with collinear runs merged, from its lowest (y, x) vertex. */
const tidy = (ring: Array<number>): Array<number> => {
  const pts = ring.slice()
  for (let changed = true; changed && pts.length >= 6;) {
    changed = false
    const n = pts.length / 2
    for (let i = 0; i < n; i++) {
      const h = (i + n - 1) % n,
        j = (i + 1) % n
      const ux = pts[2 * i]! - pts[2 * h]!,
        uy = pts[2 * i + 1]! - pts[2 * h + 1]!,
        wx = pts[2 * j]! - pts[2 * i]!,
        wy = pts[2 * j + 1]! - pts[2 * i + 1]!
      if (ux * wy - uy * wx === 0) {
        pts.splice(2 * i, 2)
        changed = true
        break
      }
    }
  }
  let low = 0
  for (let i = 1; i < pts.length / 2; i++)
    if (
      pts[2 * i + 1]! < pts[2 * low + 1]! ||
      (pts[2 * i + 1] === pts[2 * low + 1] && pts[2 * i]! < pts[2 * low]!)
    )
      low = i
  return [...pts.slice(2 * low), ...pts.slice(0, 2 * low)]
}

/**
 * The outline of the union of the parts' pieces as chained rings in metres on 0.1 m: outer rings
 * counter-clockwise, holes clockwise, collinear runs merged, each from its lowest (y, x) vertex,
 * the rings in that vertex's order. Every piece edge is cut where another piece's edge crosses or
 * ends on it; a piece of edge is outline when the union holds the point just left of its middle
 * and not the point just right. Where two rings touch at a vertex, each turns there as far left as
 * it can, so neither crosses itself.
 */
export const outlineOf = (parts: ReadonlyArray<Part>): Array<Array<number>> => {
  const pieces = piecesOf(parts)
  const covered = (x: number, y: number) => pieces.some((ring) => pointInRing(x, y, ring))
  const { edges, cuts } = cutEdges(pieces)
  // The outline's pieces, rounded to whole decimetres, each once.
  const segs = new Map<string, readonly [number, number, number, number]>()
  edges.forEach((e, k) => {
    const len = Math.hypot(e.bx - e.ax, e.by - e.ay),
      nx = -(e.by - e.ay) / len,
      ny = (e.bx - e.ax) / len
    const cs = cuts[k]!.sort((p, q) => p.t - q.t)
    for (let c = 0; c + 1 < cs.length; c++) {
      const p = cs[c]!,
        q = cs[c + 1]!,
        mx = (p.x + q.x) / 2,
        my = (p.y + q.y) / 2,
        h = Math.min(PROBE, Math.hypot(q.x - p.x, q.y - p.y) / 100)
      if (h === 0 || !covered(mx + nx * h, my + ny * h) || covered(mx - nx * h, my - ny * h))
        continue
      const s = [dm(p.x), dm(p.y), dm(q.x), dm(q.y)] as const
      if (s[0] !== s[2] || s[1] !== s[3]) segs.set(s.join(","), s)
    }
  })
  // Chained from the lowest (y, x) start; at a vertex the outline leaves by the edge the least
  // clockwise from the way it came in (the sharpest left turn).
  const all = [...segs.values()].sort(
    (p, q) => p[1] - q[1] || p[0] - q[0] || p[3] - q[3] || p[2] - q[2],
  )
  const from = new Map<string, Array<number>>()
  all.forEach((s, k) => {
    const key = `${s[0]},${s[1]}`
    from.set(key, [...(from.get(key) ?? []), k])
  })
  const used = new Uint8Array(all.length),
    rings: Array<Array<number>> = []
  for (let first = 0; first < all.length; first++) {
    if (used[first] === 1) continue
    const ring: Array<number> = []
    for (let k = first; ;) {
      used[k] = 1
      const [ax, ay, bx, by] = all[k]!
      ring.push(ax, ay)
      const next = (from.get(`${bx},${by}`) ?? [])
        .filter((m) => used[m] === 0 || m === first)
        .map((m) => [m, clockwise(ax - bx, ay - by, all[m]![2] - bx, all[m]![3] - by)] as const)
        .sort((p, q) => p[1] - q[1])[0]
      if (next === undefined)
        throw new Error(`the play area's outline does not close at (${bx / 10}, ${by / 10})`)
      if (next[0] === first) break
      k = next[0]
    }
    const tidied = tidy(ring)
    let area = 0
    for (let i = 0, n = tidied.length / 2; i < n; i++)
      area +=
        tidied[2 * i]! * tidied[(2 * i + 3) % (2 * n)]! -
        tidied[(2 * i + 2) % (2 * n)]! * tidied[2 * i + 1]!
    if (area !== 0) rings.push(tidied)
  }
  return rings.sort((p, q) => p[1]! - q[1]! || p[0]! - q[0]!).map((ring) => ring.map((v) => v / 10))
}

/** The region's play area outline (`outlineOf` its parts). */
export const OUTLINE: Rings = outlineOf(REGION.parts)

/** Whether local (x, y) lies in the play area with the outline at least `margin` m away (`insideRings`). */
export const inPlay = (x: number, y: number, margin = 0): boolean =>
  insideRings(OUTLINE, x, y, margin)

/** Whether local (x, y) lies within `tol` m of the outline. */
export const onOutline = (x: number, y: number, tol: number): boolean =>
  ringsDistance(OUTLINE, x, y) < tol

/** The outline edge [ax, ay, bx, by] nearest (x, y) when nearer than `tol` m (the first in ring order on a tie). */
export const outlineEdgeAt = (
  x: number,
  y: number,
  tol: number,
): readonly [number, number, number, number] | undefined => {
  let best: readonly [number, number, number, number] | undefined,
    near = tol
  for (const ring of OUTLINE)
    for (let i = 0, n = ring.length / 2; i < n; i++) {
      const j = (i + 1) % n,
        edge = [ring[2 * i]!, ring[2 * i + 1]!, ring[2 * j]!, ring[2 * j + 1]!] as const,
        d = edgeDistance(x, y, ...edge)
      if (d < near) [best, near] = [edge, d]
    }
  return best
}

/** Where along a → a + (dx, dy) the segment crosses an edge of the rings, in (0, 1), sorted, each once. */
const crossingsOf = (rings: Rings, ax: number, ay: number, dx: number, dy: number) => {
  const ts: Array<number> = []
  for (const ring of rings)
    for (let i = 0, n = ring.length / 2; i < n; i++) {
      const j = (i + 1) % n,
        cx = ring[2 * i]!,
        cy = ring[2 * i + 1]!,
        ex = ring[2 * j]!,
        ey = ring[2 * j + 1]!
      let t = Number.NaN
      // A vertical or horizontal edge as Liang–Barsky has it: t = (X − a.x) / dx.
      if (cx === ex) {
        if (dx === 0) continue
        t = (cx - ax) / dx
        const y = ay + t * dy
        if (!(y >= Math.min(cy, ey) - ON && y <= Math.max(cy, ey) + ON)) continue
      } else if (cy === ey) {
        if (dy === 0) continue
        t = (cy - ay) / dy
        const x = ax + t * dx
        if (!(x >= Math.min(cx, ex) - ON && x <= Math.max(cx, ex) + ON)) continue
      } else {
        const fx = ex - cx,
          fy = ey - cy,
          den = dx * fy - dy * fx,
          slack = ON / Math.hypot(fx, fy)
        if (den === 0) continue
        t = ((cx - ax) * fy - (cy - ay) * fx) / den
        const u = ((cx - ax) * dy - (cy - ay) * dx) / den
        if (!(u >= -slack && u <= 1 + slack)) continue
      }
      if (t > 0 && t < 1) ts.push(t)
    }
  return [...new Set(ts.sort((p, q) => p - q))]
}

/**
 * Polyline `pts` clipped to the area `rings` bound (edges in it), consecutive stretches inside
 * joined into pieces. Original vertices keep their ids; the points where a piece is cut have none,
 * which is how later stages know a line leaves the play area there.
 */
export const clipLineTo = (rings: Rings, pts: ReadonlyArray<V>): Array<Array<V>> => {
  const out: Array<Array<V>> = []
  let cur: Array<V> = []
  const end = () => {
    if (cur.length > 1) out.push(cur)
    cur = []
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!,
      b = pts[i]!
    const dx = b.x - a.x,
      dy = b.y - a.y,
      len = Math.sqrt(dx * dx + dy * dy)
    const at = (t: number): V => (t === 0 ? a : t === 1 ? b : { x: a.x + t * dx, y: a.y + t * dy })
    // The stretches between crossings inside, consecutive ones joined.
    const runs: Array<[number, number]> = []
    if (len === 0) {
      if (insideRings(rings, a.x, a.y)) runs.push([0, 1])
    } else {
      let s = 0
      for (const t of [...crossingsOf(rings, a.x, a.y, dx, dy), 1]) {
        const m = (s + t) / 2
        if (
          (s === 0 || t === 1 || (t - s) * len >= SLIVER) &&
          insideRings(rings, a.x + m * dx, a.y + m * dy)
        ) {
          const last = runs.at(-1)
          if (last?.[1] === s) last[1] = t
          else runs.push([s, t])
        }
        s = t
      }
    }
    if (cur.length > 0 && runs[0]?.[0] !== 0) end()
    for (const [s, t] of runs) {
      if (cur.length === 0) cur.push(at(s))
      cur.push(at(t))
      if (t < 1) end()
    }
  }
  end()
  return out
}

/** Polyline `pts` clipped to the play area (`clipLineTo` the outline). */
export const clipToPlay = (pts: ReadonlyArray<V>): Array<Array<V>> => clipLineTo(OUTLINE, pts)
