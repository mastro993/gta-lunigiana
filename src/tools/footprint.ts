// The geometry behind `footprint-check` (issue #3, runbook step 1): a part's play area (its mask, or
// else its rectangles' union) as labelled edges with its seams, the built parts' play area a road
// leaves, single-linkage clusters, and the stretches of a line that leave that area and come back,
// or run to the edge of the box the lines were fetched over.

import { type Rings, insideRings, ringsDistance } from "../sim/map/outline.ts"
import { type P, r1, segDist2 } from "./geometry.ts"
import { outlineOf } from "./play-area.ts"
import { type Part, type Rect, inRects } from "./region.ts"

/** A compass point: the way an edge faces out of the play area. */
export type Side = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW"

/**
 * A straight piece of a part's play area's outline, local m, its ends in (x, y) order: `side` is
 * the way it faces out, N/S/E/W on a vertical or horizontal edge and on a slanted one the nearest of
 * the eight points, with `bearing` its whole degrees clockwise from north; `seam` is the part
 * beyond it when one is.
 */
export interface Edge {
  readonly side: Side
  readonly bearing?: number
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly seam?: string
}

/** How far beside a piece's middle its outer side is probed, m: this, or a hundredth of a shorter piece. */
const PROBE = 1e-3
/**
 * Within this distance (m) a vertex of another outline lies on an edge; a piece shorter than this
 * lies between two cuts at one point that rounding set apart, and is left to its neighbours.
 */
const ON = 1e-6
const COMPASS: ReadonlyArray<Side> = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]

type Segment = readonly [number, number, number, number]

/** The edges [ax, ay, bx, by] of flat rings, each vertex to the next. */
const ringEdges = (rings: Rings): Array<Segment> =>
  rings.flatMap((ring) =>
    Array.from({ length: ring.length / 2 }, (_, i) => {
      const j = (2 * i + 2) % ring.length
      return [ring[2 * i]!, ring[2 * i + 1]!, ring[j]!, ring[j + 1]!] as const
    }),
  )

/** Where along edge a → b (0 at a, 1 at b) edge c → d crosses it or ends on it, its ends left out. */
const cutsBy = ([ax, ay, bx, by]: Segment, [cx, cy, dx, dy]: Segment): Array<number> => {
  const ts: Array<number> = []
  for (const [x, y] of [
    [cx, cy],
    [dx, dy],
  ] as const) {
    const { d2, t } = segDist2(x, y, ax, ay, bx, by)
    if (d2 <= ON * ON) ts.push(t)
  }
  const ex = bx - ax,
    ey = by - ay,
    fx = dx - cx,
    fy = dy - cy,
    den = ex * fy - ey * fx
  if (den !== 0) {
    const t = ((cx - ax) * fy - (cy - ay) * fx) / den,
      u = ((cx - ax) * ey - (cy - ay) * ex) / den
    if (u > 0 && u < 1) ts.push(t)
  }
  return ts.filter((t) => t > 0 && t < 1)
}

/** The way the play area, left of a → b, faces out across it. */
const facing = (dx: number, dy: number): Pick<Edge, "side" | "bearing"> => {
  if (dx === 0) return { side: dy > 0 ? "E" : "W" }
  if (dy === 0) return { side: dx > 0 ? "S" : "N" }
  // The outward normal (dy, −dx), clockwise from north.
  const bearing = Math.round((Math.atan2(dy, -dx) * 180) / Math.PI + 360) % 360
  return { side: COMPASS[Math.round(bearing / 45) % 8]!, bearing }
}

const kind = (e: Edge) => (e.x0 === e.x1 ? 0 : e.y0 === e.y1 ? 1 : 2)
// Vertical edges west to east, then horizontal ones south to north, then slanted ones by their west
// end; on one line, in order along it. A rectangle's edges keep the order the report listed them
// in before masks, which `nearestEdge` breaks a tie by.
const byPlace = (a: Edge, b: Edge) =>
  kind(a) - kind(b) ||
  (kind(a) === 1 ? a.y0 - b.y0 || a.x0 - b.x0 : a.x0 - b.x0 || a.y0 - b.y0) ||
  a.x1 - b.x1 ||
  a.y1 - b.y1

/**
 * The outline of `part`'s play area (`outlineOf`: its mask, or its rectangles' union) as straight
 * edges, vertical ones west to east, then horizontal ones south to north, then slanted ones by
 * their west end. Each edge of its rings is cut wherever an edge of another part's play area
 * crosses it or ends on it, which is where that area may start or stop beside it; a piece is a seam
 * with the first of `others` whose play area holds the point just outside its middle, and the
 * pieces of one edge with the same seam, or none, are merged back.
 */
export const partEdges = (part: Part, others: ReadonlyArray<Part> = []): Array<Edge> => {
  const beyond = others.map((p) => ({ key: p.key, rings: outlineOf([p]) }))
  const theirs = beyond.flatMap((b) => ringEdges(b.rings))
  const seamAt = (x: number, y: number) => beyond.find((b) => insideRings(b.rings, x, y))?.key
  const edges: Array<Edge> = []
  for (const edge of ringEdges(outlineOf([part]))) {
    const [ax, ay, bx, by] = edge,
      dx = bx - ax,
      dy = by - ay,
      len = Math.hypot(dx, dy)
    const ts = [...new Set([0, 1, ...theirs.flatMap((f) => cutsBy(edge, f))])].sort((s, t) => s - t)
    // Runs of pieces with one seam, each to where it stops along the edge.
    const runs: Array<{ to: number; readonly seam: string | undefined }> = []
    for (let k = 1; k < ts.length; k++) {
      const s = ts[k - 1]!,
        t = ts[k]!
      if ((t - s) * len < ON) continue
      const m = (s + t) / 2,
        h = Math.min(PROBE, ((t - s) * len) / 100)
      const seam = seamAt(ax + dx * m + (dy / len) * h, ay + dy * m - (dx / len) * h)
      const last = runs.at(-1)
      if (last !== undefined && last.seam === seam) last.to = t
      else runs.push({ to: t, seam })
    }
    const at = (t: number): P =>
      t === 0 ? [ax, ay] : t === 1 ? [bx, by] : [r1(ax + dx * t), r1(ay + dy * t)]
    let from = 0
    runs.forEach(({ to, seam }, k) => {
      const p = at(from),
        q = at(k === runs.length - 1 ? 1 : to),
        [[x0, y0], [x1, y1]] = p[0] < q[0] || (p[0] === q[0] && p[1] < q[1]) ? [p, q] : [q, p]
      edges.push({ ...facing(dx, dy), x0, y0, x1, y1, ...(seam === undefined ? {} : { seam }) })
      from = to
    })
  }
  return edges.sort(byPlace)
}

/**
 * An edge as the report names it, plus the seam's part: `E x=4900 y -6100..3900` along a vertical
 * line, `N y=3900 x -2900..4900` along a horizontal one, `NE 53° 800,2000..2000,400` on a slant.
 */
export const edgeLabel = (e: Edge): string =>
  (e.bearing === undefined
    ? e.x0 === e.x1
      ? `${e.side} x=${e.x0} y ${e.y0}..${e.y1}`
      : `${e.side} y=${e.y0} x ${e.x0}..${e.x1}`
    : `${e.side} ${e.bearing}° ${e.x0},${e.y0}..${e.x1},${e.y1}`) +
  (e.seam === undefined ? "" : ` (seam with ${e.seam})`)

/** The nearest of `edges` to local (x, y) with its distance, m; undefined for no edges. */
export const nearestEdge = (
  edges: ReadonlyArray<Edge>,
  x: number,
  y: number,
): { readonly edge: Edge; readonly distance: number } | undefined => {
  let best: { edge: Edge; distance: number } | undefined
  for (const edge of edges) {
    const distance = Math.sqrt(segDist2(x, y, edge.x0, edge.y0, edge.x1, edge.y1).d2)
    if (best === undefined || distance < best.distance) best = { edge, distance }
  }
  return best
}

/**
 * Whether local (x, y) lies in the play area of one of `parts`: its mask, or else one of its
 * rectangles, edges included.
 */
export const inArea = (parts: ReadonlyArray<Part>, x: number, y: number): boolean =>
  parts.some((p) => (p.mask === undefined ? inRects(p.rects, x, y) : insideRings([p.mask], x, y)))

/** The distance from local (x, y) to the nearest of `rects`, m: 0 inside one. */
const rectsDistance = (rects: ReadonlyArray<Rect>, x: number, y: number): number =>
  Math.min(
    ...rects.map(([x0, y0, x1, y1]) =>
      Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)),
    ),
  )

/**
 * The distance from local (x, y) to the play area of `parts` (`inArea`), m: 0 inside it. A part
 * without a mask is measured to its rectangles as before masks were judged (`Math.hypot`), so its
 * report does not move by a rounding.
 */
const areaDistance = (parts: ReadonlyArray<Part>, x: number, y: number): number =>
  Math.min(
    ...parts.map((p) =>
      p.mask === undefined
        ? rectsDistance(p.rects, x, y)
        : insideRings([p.mask], x, y)
          ? 0
          : ringsDistance([p.mask], x, y),
    ),
  )

/** (b − a) × (c − a): its sign says which side of a → b point c lies on. */
const cross = (a: P, b: P, c: P) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

/**
 * Whether the play area of one of `parts` holds all of segment a–b, which `excursions` then need
 * not probe: one of its rectangles holds both ends, or its mask holds them and none of its edges
 * meets the segment. A touch or a collinear edge counts as meeting, so this may say no to a
 * segment the mask holds (probed for nothing), never yes to one it does not.
 */
const areaHolds = (parts: ReadonlyArray<Part>, a: P, b: P): boolean =>
  parts.some(({ rects, mask }) => {
    if (mask === undefined)
      return rects.some(
        ([x0, y0, x1, y1]) =>
          Math.min(a[0], b[0]) >= x0 &&
          Math.max(a[0], b[0]) <= x1 &&
          Math.min(a[1], b[1]) >= y0 &&
          Math.max(a[1], b[1]) <= y1,
      )
    if (!insideRings([mask], a[0], a[1]) || !insideRings([mask], b[0], b[1])) return false
    for (let i = 0, n = mask.length; i < n; i += 2) {
      const c: P = [mask[i]!, mask[i + 1]!],
        d: P = [mask[(i + 2) % n]!, mask[(i + 3) % n]!]
      if (cross(c, d, a) * cross(c, d, b) <= 0 && cross(a, b, c) * cross(a, b, d) <= 0) return false
    }
    return true
  })

/**
 * Single-linkage clusters of `pts`: points at most `link` m apart share one. Each cluster lists its
 * points' indices in ascending order; clusters come in the order of their first index.
 */
export const clusters = (pts: ReadonlyArray<P>, link: number): Array<Array<number>> => {
  const parent = pts.map((_, i) => i)
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!
    return i
  }
  const cells = new Map<string, Array<number>>()
  const cellOf = ([x, y]: P) => [Math.floor(x / link), Math.floor(y / link)] as const
  pts.forEach((p, i) => {
    const [cx, cy] = cellOf(p),
      key = `${cx},${cy}`
    if (cells.has(key)) cells.get(key)!.push(i)
    else cells.set(key, [i])
  })
  pts.forEach(([x, y], i) => {
    const [cx, cy] = cellOf([x, y])
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const [qx, qy] = pts[j]!
          if (j > i && (qx - x) ** 2 + (qy - y) ** 2 <= link * link) parent[root(j)] = root(i)
        }
  })
  const groups = new Map<number, Array<number>>()
  pts.forEach((_, i) => {
    const r = root(i)
    if (groups.has(r)) groups.get(r)!.push(i)
    else groups.set(r, [i])
  })
  return [...groups.values()].sort((a, b) => a[0]! - b[0]!)
}

const dist = (a: P, b: P) => Math.hypot(b[0] - a[0], b[1] - a[1])

/** The outline point between `inside` (in the play area of `parts`) and `outside`, by bisection to under 1 mm. */
const crossing = (parts: ReadonlyArray<Part>, inside: P, outside: P): P => {
  let a = inside,
    b = outside
  while (dist(a, b) > 1e-3) {
    const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    if (inArea(parts, m[0], m[1])) a = m
    else b = m
  }
  return b
}

/** A binary min-heap of graph nodes by distance. */
const minHeap = () => {
  const keys: Array<number> = [],
    nodes: Array<number> = []
  const swap = (i: number, j: number) => {
    ;[keys[i], keys[j], nodes[i], nodes[j]] = [keys[j]!, keys[i]!, nodes[j]!, nodes[i]!]
  }
  return {
    size: () => keys.length,
    push: (key: number, node: number) => {
      keys.push(key)
      nodes.push(node)
      for (let i = keys.length - 1, up = (i - 1) >> 1; i > 0 && keys[up]! > keys[i]!;) {
        swap(i, up)
        i = up
        up = (i - 1) >> 1
      }
    },
    pop: (): [number, number] => {
      const top: [number, number] = [keys[0]!, nodes[0]!]
      const key = keys.pop()!,
        node = nodes.pop()!
      if (keys.length > 0) {
        keys[0] = key
        nodes[0] = node
        for (let i = 0; ;) {
          const l = 2 * i + 1,
            r = l + 1
          let m = i
          if (l < keys.length && keys[l]! < keys[m]!) m = l
          if (r < keys.length && keys[r]! < keys[m]!) m = r
          if (m === i) break
          swap(i, m)
          i = m
        }
      }
      return top
    },
  }
}

/** A polyline with the id of what it draws (an OSM way). */
export interface Line {
  readonly id: number
  readonly pts: ReadonlyArray<P>
}

/**
 * A road out of the play area and back in: where it leaves and comes back (on the outline), its
 * point farthest out, the length outside and that farthest distance, m, and the ids of the lines it
 * follows, in order.
 */
export interface Reentry {
  readonly exit: P
  readonly entry: P
  readonly far: P
  readonly length: number
  readonly depth: number
  readonly lines: ReadonlyArray<number>
}

/**
 * A road out of the play area that does not come back before it nears the edge of the box its lines
 * were fetched over, where what lies beyond is unknown: where it leaves (on the outline), where it
 * first comes within EDGE m of the box's edge, the length outside to there, m, and the ids of the
 * lines it follows, in order.
 */
export interface Unresolved {
  readonly exit: P
  readonly end: P
  readonly length: number
  readonly lines: ReadonlyArray<number>
}

/** Within this many m of the fetched box's edge, m, a road may go on along ways that were not fetched. */
const EDGE = 50

/**
 * Where the network of `lines`, fetched over the local `box`, leaves the play area of `parts`
 * (`inArea`): the re-entries, and the roads that run out to the box's edge without one
 * (unresolved). Lines join where they share a vertex, so a road split into several ways counts.
 * From each place a line crosses the outline, the shortest way outside to another crossing is a
 * re-entry; each pair of crossings is reported once. A segment that no single rectangle or mask
 * holds whole (`areaHolds`) is probed every `step` m, so one cutting across the inner corner of an
 * L of rectangles, or across a mask's notch, counts.
 */
export const excursions = (
  lines: ReadonlyArray<Line>,
  parts: ReadonlyArray<Part>,
  box: Rect,
  step = 10,
): { readonly reentries: Array<Reentry>; readonly unresolved: Array<Unresolved> } => {
  const pts: Array<P> = [],
    inside: Array<boolean> = [],
    adj: Array<Array<{ readonly to: number; readonly len: number; readonly line: number }>> = []
  const byVertex = new Map<string, number>()
  const node = (p: P, shared: boolean) => {
    const key = `${p[0]},${p[1]}`,
      known = shared ? byVertex.get(key) : undefined
    if (known !== undefined) return known
    pts.push(p)
    inside.push(inArea(parts, p[0], p[1]))
    adj.push([])
    if (shared) byVertex.set(key, pts.length - 1)
    return pts.length - 1
  }
  const link = (a: number, b: number, line: number) => {
    if (a === b || adj[a]!.some((e) => e.to === b)) return
    const len = dist(pts[a]!, pts[b]!)
    adj[a]!.push({ to: b, len, line })
    adj[b]!.push({ to: a, len, line })
  }
  const atEdge = ([x, y]: P) =>
    x < box[0] + EDGE || y < box[1] + EDGE || x > box[2] - EDGE || y > box[3] - EDGE
  for (const { id, pts: line } of lines)
    line.forEach((b, i) => {
      const a = line[i - 1]
      if (a === undefined) return
      const n = areaHolds(parts, a, b) ? 1 : Math.max(1, Math.ceil(dist(a, b) / step))
      let last = node(a, true)
      for (let k = 1; k < n; k++) {
        const mid = node([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], false)
        link(last, mid, id)
        last = mid
      }
      link(last, node(b, true), id)
    })

  // A crossing: where the edge from an inside node to the outside node `out` meets the outline.
  const crossings = adj.flatMap((es, u) =>
    inside[u]
      ? es
          .filter((e) => !inside[e.to])
          .map((e) => ({ at: crossing(parts, pts[u]!, pts[e.to]!), out: e.to, line: e.line }))
      : [],
  )
  const crossingsAt = new Map<number, Array<number>>()
  crossings.forEach((c, i) => {
    if (crossingsAt.has(c.out)) crossingsAt.get(c.out)!.push(i)
    else crossingsAt.set(c.out, [i])
  })

  const reentries: Array<Reentry> = [],
    unresolved: Array<Unresolved> = []
  const pairs = new Set<string>()
  crossings.forEach((from, i) => {
    const d = new Map<number, number>([[from.out, dist(from.at, pts[from.out]!)]]),
      back = new Map<number, { readonly node: number; readonly line: number }>()
    const open = minHeap()
    open.push(d.get(from.out)!, from.out)
    let best: { readonly to: number; readonly len: number } | undefined,
      edge: { readonly node: number; readonly len: number } | undefined
    while (open.size() > 0) {
      const [du, u] = open.pop()
      if (best !== undefined && du >= best.len) break
      if (du > d.get(u)!) continue
      if (edge === undefined && atEdge(pts[u]!)) edge = { node: u, len: du }
      for (const j of crossingsAt.get(u) ?? []) {
        const len = du + dist(pts[u]!, crossings[j]!.at)
        if (j !== i && (best === undefined || len < best.len)) best = { to: j, len }
      }
      for (const e of adj[u]!)
        if (!inside[e.to] && du + e.len < (d.get(e.to) ?? Infinity)) {
          d.set(e.to, du + e.len)
          back.set(e.to, { node: u, line: e.line })
          open.push(du + e.len, e.to)
        }
    }
    /** The nodes from `end` back to `from`'s, and the ids of the lines from `from` to `end`, in order. */
    const trail = (end: number, last: ReadonlyArray<number>) => {
      const path = [end],
        ids = [...last]
      for (let hop = back.get(end); hop !== undefined; hop = back.get(hop.node)) {
        path.push(hop.node)
        ids.push(hop.line)
      }
      ids.push(from.line)
      return { path, lines: ids.reverse().filter((id, k, all) => id !== all[k - 1]) }
    }
    if (best === undefined) {
      if (edge !== undefined)
        unresolved.push({
          exit: from.at,
          end: pts[edge.node]!,
          length: edge.len,
          lines: trail(edge.node, []).lines,
        })
      return
    }
    const to = crossings[best.to]!,
      pair = `${Math.min(i, best.to)},${Math.max(i, best.to)}`
    if (pairs.has(pair)) return
    pairs.add(pair)
    const { path, lines: ids } = trail(to.out, [to.line])
    const far = path.reduce((a, b) =>
      areaDistance(parts, ...pts[b]!) > areaDistance(parts, ...pts[a]!) ? b : a,
    )
    reentries.push({
      exit: from.at,
      entry: to.at,
      far: pts[far]!,
      length: best.len,
      depth: areaDistance(parts, ...pts[far]!),
      lines: ids,
    })
  })
  return { reentries, unresolved }
}
