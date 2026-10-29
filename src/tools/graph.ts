// Road graph from shared OSM node ids (clip points get their own nodes), edges densified to <= 25 m.
import { isTraffic } from "../sim/map/kinds.ts"
import type { RoadF } from "./features.ts"
import { arcLengths, pointAt, r1, type V } from "./geometry.ts"

const MAX_EDGE = 25
/** Map-edge dead ends stop this far (m) back along the road: past the road-exit caps (4 m in) with room for a car's nose. */
const EXIT = 8

/** The polyline with each map-edge end (a clip point: no OSM id) pulled EXIT m back along it. */
const trimExits = (pts: ReadonlyArray<V>): ReadonlyArray<V> => {
  const head = (q: ReadonlyArray<V>): Array<V> => {
    const s = arcLengths(q)
    if (q[0]!.id !== undefined || s.at(-1)! < 2 * EXIT) return [...q]
    const p = pointAt(q, s, EXIT)
    let i = 1
    while (s[i]! <= EXIT) i++
    return [{ x: p.x, y: p.y }, ...q.slice(i)]
  }
  return head(head(pts).reverse()).reverse()
}

interface GraphOut {
  readonly xy: Array<number>
  readonly edges: Array<number>
  readonly traffic: Array<number>
  readonly walk: Array<number>
  /** Node degree over all edges. */
  readonly degree: Array<number>
  /** The node of each vertex id (OSM's, or the conflation's `ctr:` and `culvert:` ones); clip and split points are keyed `clip:`/`mid:`. */
  readonly ids: ReadonlyMap<string, number>
}

/** Edge indices of the largest connected component among `ids`. */
const largest = (
  nodes: number,
  edges: ReadonlyArray<number>,
  ids: ReadonlyArray<number>,
): Array<number> => {
  const parent = Array.from({ length: nodes }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!
    return i
  }
  for (const e of ids) parent[find(edges[3 * e]!)] = find(edges[3 * e + 1]!)
  const size = new Map<number, number>()
  for (const e of ids) size.set(find(edges[3 * e]!), (size.get(find(edges[3 * e]!)) ?? 0) + 1)
  const [root] = [...size].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [-1]
  return ids.filter((e) => find(edges[3 * e]!) === root)
}

/** Drops edges hanging off a dead end (`end` is its dead-end node) while `drop` says so, repeatedly. */
const pruneSpurs = (
  edges: ReadonlyArray<number>,
  ids: ReadonlyArray<number>,
  drop: (e: number, end: number) => boolean,
): Array<number> => {
  let kept = [...ids]
  for (;;) {
    const deg = new Map<number, number>()
    for (const e of kept)
      for (const n of [edges[3 * e]!, edges[3 * e + 1]!]) deg.set(n, (deg.get(n) ?? 0) + 1)
    const next = kept.filter(
      (e) => ![edges[3 * e]!, edges[3 * e + 1]!].some((n) => deg.get(n) === 1 && drop(e, n)),
    )
    if (next.length === kept.length) return kept
    kept = next
  }
}

/**
 * The road graph. Traffic drops tunnel spurs and dead-end tips where `roomy(x, y)` is false
 * (no room for a car to stop and turn: lanes that end between houses).
 */
export const buildGraph = (
  roads: ReadonlyArray<RoadF>,
  roomy: (x: number, y: number) => boolean,
): GraphOut => {
  const ids = new Map<string, number>()
  const xy: Array<number> = [],
    edges: Array<number> = []
  const node = (key: string, x: number, y: number) => {
    let id = ids.get(key)
    if (id === undefined) {
      id = xy.length / 2
      ids.set(key, id)
      xy.push(r1(x), r1(y))
    }
    return id
  }
  roads.forEach((r, ri) => {
    let prev = -1
    trimExits(r.pts).forEach((p, k) => {
      const cur = node(p.id ?? `clip:${ri}:${k}`, p.x, p.y)
      if (prev >= 0 && prev !== cur) {
        const ax = xy[2 * prev]!,
          ay = xy[2 * prev + 1]!,
          bx = xy[2 * cur]!,
          by = xy[2 * cur + 1]!
        const n = Math.ceil(Math.hypot(bx - ax, by - ay) / MAX_EDGE)
        let a = prev
        for (let s = 1; s < n; s++) {
          const mid = node(
            `mid:${ri}:${k}:${s}`,
            ax + ((bx - ax) * s) / n,
            ay + ((by - ay) * s) / n,
          )
          edges.push(a, mid, ri)
          a = mid
        }
        edges.push(a, cur, ri)
      }
      prev = cur
    })
  })
  const nodes = xy.length / 2,
    all = Array.from({ length: edges.length / 3 }, (_, e) => e)
  const road = (e: number) => roads[edges[3 * e + 2]!]!
  const drivable = all.filter((e) => isTraffic(road(e).cls) && !road(e).private)
  const traffic = largest(
    nodes,
    edges,
    pruneSpurs(
      edges,
      drivable,
      (e, n) => road(e).tunnel === true || !roomy(xy[2 * n]!, xy[2 * n + 1]!),
    ),
  )
  const walk = largest(
    nodes,
    edges,
    all.filter((e) => road(e).tunnel !== true),
  )
  const degree = Array.from({ length: nodes }, () => 0)
  for (const e of all) {
    degree[edges[3 * e]!]!++
    degree[edges[3 * e + 1]!]!++
  }
  return { xy, edges, traffic, walk, degree, ids }
}
