// The geometry behind `footprint-check` (issue #3, runbook step 1): a part's outline as labelled
// edges with its seams, single-linkage clusters, and the stretches of a line that leave the play
// area and come back, or run to the edge of the box the lines were fetched over.

import { type P, segDist2 } from "./geometry.ts"
import { type Part, type Rect, inRects } from "./region.ts"

/** A compass side of the play area. */
export type Side = "N" | "S" | "E" | "W"

/**
 * A straight piece of the play area's outline, local m, x0 ≤ x1 and y0 ≤ y1: `side` is the side of
 * the play area it bounds, `seam` the part beyond it when one is.
 */
export interface Edge {
  readonly side: Side
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly seam?: string
}

/** A probe's offset beside an edge, m: rectangles lie on 100 m multiples. */
const EPS = 1e-3

const sortedUnique = (vs: ReadonlyArray<number>): Array<number> =>
  [...new Set(vs)].sort((a, b) => a - b)

/**
 * The outline of the union of `rects`: an edge shared by two rectangles, or lying inside another,
 * is interior and left out. Every rectangle corner of `rects` and `others` cuts the edges, and
 * pieces on one line with the same side and seam are merged back.
 */
export const outline = (
  rects: ReadonlyArray<Rect>,
  others: ReadonlyArray<Part> = [],
): Array<Edge> => {
  const all = [...rects, ...others.flatMap((p) => p.rects)]
  const xs = sortedUnique(all.flatMap((r) => [r[0], r[2]])),
    ys = sortedUnique(all.flatMap((r) => [r[1], r[3]]))
  const seamAt = (x: number, y: number) => others.find((p) => inRects(p.rects, x, y))?.key
  const edges: Array<Edge> = []
  const push = (edge: Edge) => {
    const last = edges.at(-1)
    const joins =
      last !== undefined &&
      last.side === edge.side &&
      last.seam === edge.seam &&
      (edge.side === "E" || edge.side === "W"
        ? last.x0 === edge.x0 && last.y1 === edge.y0
        : last.y0 === edge.y0 && last.x1 === edge.x0)
    if (joins) edges[edges.length - 1] = { ...last, x1: edge.x1, y1: edge.y1 }
    else edges.push(edge)
  }
  for (const x of sortedUnique(rects.flatMap((r) => [r[0], r[2]])))
    for (let k = 1; k < ys.length; k++) {
      const y0 = ys[k - 1]!,
        y1 = ys[k]!,
        ym = (y0 + y1) / 2
      const west = inRects(rects, x - EPS, ym),
        east = inRects(rects, x + EPS, ym)
      if (west === east) continue
      const seam = seamAt(west ? x + EPS : x - EPS, ym)
      push({
        side: west ? "E" : "W",
        x0: x,
        y0,
        x1: x,
        y1,
        ...(seam === undefined ? {} : { seam }),
      })
    }
  for (const y of sortedUnique(rects.flatMap((r) => [r[1], r[3]])))
    for (let k = 1; k < xs.length; k++) {
      const x0 = xs[k - 1]!,
        x1 = xs[k]!,
        xm = (x0 + x1) / 2
      const south = inRects(rects, xm, y - EPS),
        north = inRects(rects, xm, y + EPS)
      if (south === north) continue
      const seam = seamAt(xm, south ? y + EPS : y - EPS)
      push({
        side: south ? "N" : "S",
        x0,
        y0: y,
        x1,
        y1: y,
        ...(seam === undefined ? {} : { seam }),
      })
    }
  return edges
}

/** An edge as the report names it: `E x=4900 y -6100..3900`, plus the seam's part. */
export const edgeLabel = (e: Edge): string =>
  (e.side === "E" || e.side === "W"
    ? `${e.side} x=${e.x0} y ${e.y0}..${e.y1}`
    : `${e.side} y=${e.y0} x ${e.x0}..${e.x1}`) +
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

/** The distance from local (x, y) to the nearest of `rects`, m: 0 inside one. */
const rectsDistance = (rects: ReadonlyArray<Rect>, x: number, y: number): number =>
  Math.min(
    ...rects.map(([x0, y0, x1, y1]) =>
      Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)),
    ),
  )

const dist = (a: P, b: P) => Math.hypot(b[0] - a[0], b[1] - a[1])

/** The outline point between `inside` (in `rects`) and `outside`, by bisection to under 1 mm. */
const crossing = (rects: ReadonlyArray<Rect>, inside: P, outside: P): P => {
  let a = inside,
    b = outside
  while (dist(a, b) > 1e-3) {
    const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    if (inRects(rects, m[0], m[1])) a = m
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
 * Where the network of `lines`, fetched over the local `box`, leaves the union of `rects`: the
 * re-entries, and the roads that run out to the box's edge without one (unresolved). Lines join
 * where they share a vertex, so a road split into several ways counts. From each place a line
 * crosses the outline, the shortest way outside to another crossing is a re-entry; each pair of
 * crossings is reported once. A segment that no single rectangle holds is probed every `step` m,
 * so one cutting across the inner corner of an L of rectangles counts.
 */
export const excursions = (
  lines: ReadonlyArray<Line>,
  rects: ReadonlyArray<Rect>,
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
    inside.push(inRects(rects, p[0], p[1]))
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
  const held = (a: P, b: P) =>
    rects.some(
      ([x0, y0, x1, y1]) =>
        Math.min(a[0], b[0]) >= x0 &&
        Math.max(a[0], b[0]) <= x1 &&
        Math.min(a[1], b[1]) >= y0 &&
        Math.max(a[1], b[1]) <= y1,
    )
  const atEdge = ([x, y]: P) =>
    x < box[0] + EDGE || y < box[1] + EDGE || x > box[2] - EDGE || y > box[3] - EDGE
  for (const { id, pts: line } of lines)
    line.forEach((b, i) => {
      const a = line[i - 1]
      if (a === undefined) return
      const n = held(a, b) ? 1 : Math.max(1, Math.ceil(dist(a, b) / step))
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
          .map((e) => ({ at: crossing(rects, pts[u]!, pts[e.to]!), out: e.to, line: e.line }))
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
      rectsDistance(rects, ...pts[b]!) > rectsDistance(rects, ...pts[a]!) ? b : a,
    )
    reentries.push({
      exit: from.at,
      entry: to.at,
      far: pts[far]!,
      length: best.len,
      depth: rectsDistance(rects, ...pts[far]!),
      lines: ids,
    })
  })
  return { reentries, unresolved }
}
