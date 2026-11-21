/**
 * Lookups over the map graph's edges as straight chords: the distance to an edge's centreline, its
 * midpoint, which networks it is in, and grids that find the nearest edge or the edges around a point
 * without scanning the whole map. Static, derived once from `graph`; a chord is read from its two
 * nodes when asked, never stored (an object per edge for the chords and another for the midpoints
 * kept 18 MB of the heap on Lunigiana). Kept apart from `route` so that modules `route` reads (the
 * residents along each walk edge) can use them without an import cycle.
 *
 * @module edges
 */
import { distanceToSegment, staticGrid } from "./collide.ts"
import { ANCHOR, graph } from "./map/index.ts"

/** Distance from (x, y) to the centreline of `edge`. */
export const distanceToEdge = (edge: number, x: number, y: number): number => {
  const e = graph.edges[edge]!,
    a = graph.nodes[e.a]!,
    b = graph.nodes[e.b]!
  return distanceToSegment(a.x, a.y, b.x, b.y, x, y)
}

/** The midpoint of `edge`'s centreline. */
export const midpointOf = (edge: number): { readonly x: number; readonly y: number } => {
  const e = graph.edges[edge]!,
    a = graph.nodes[e.a]!,
    b = graph.nodes[e.b]!
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Per graph edge, 1 where `edges` holds it: a set of edges at a byte each (three `Set`s of them kept 4-5 MB of the heap on Lunigiana). */
const flagsOf = (edges: ReadonlyArray<number>): Uint8Array => {
  const flags = new Uint8Array(graph.edges.length)
  for (const e of edges) flags[e] = 1
  return flags
}
const trafficFlags = flagsOf(graph.trafficEdges),
  walkFlags = flagsOf(graph.walkEdges)

/** Whether AI traffic may drive `edge`: one of `graph.trafficEdges`. */
export const isTrafficEdge = (edge: number): boolean => trafficFlags[edge] === 1
/** Whether people walk `edge`: one of `graph.walkEdges`. */
export const isWalkEdge = (edge: number): boolean => walkFlags[edge] === 1

/** Grid cell of `edgeIndex`, m (edges are at most ~25 m). */
const EDGE_CELL = 32

/**
 * Lookups over a fixed set of graph edges through a grid of their chords, so that no query scans
 * the whole map. `nearest`: the edge whose centreline is nearest (x, y), the first of `edges` on a
 * tie. `around`: the edges whose midpoint is `min` to `max` m from (x, y), in a fixed order (the
 * grid's cells, counted from the region's anchor, then `edges`' order), in an array reused by the
 * next call: Populate picks from it, so a part joining far off must not reorder it.
 */
export const edgeIndex = (edges: ReadonlyArray<number>) => {
  const grid = staticGrid(
    edges.length,
    (k) => {
      const e = graph.edges[edges[k]!]!,
        a = graph.nodes[e.a]!,
        b = graph.nodes[e.b]!
      return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)]
    },
    EDGE_CELL,
    ANCHOR,
  )
  const found: Array<number> = []
  return {
    nearest: (x: number, y: number): number => {
      let best = 0,
        distance = Number.MAX_VALUE
      const visit = (k: number) => {
        const d = distanceToEdge(edges[k]!, x, y)
        if (d < distance || (d === distance && k < best)) [best, distance] = [k, d]
      }
      // An edge outside the box is farther than r: once one inside is within r, it is the nearest.
      for (let r = EDGE_CELL; r < 1e6; r *= 2) {
        grid(x - r, y - r, x + r, y + r, visit)
        if (distance <= r) break
      }
      return edges[best]!
    },
    around: (
      x: number,
      y: number,
      [min, max]: readonly [number, number],
    ): ReadonlyArray<number> => {
      found.length = 0
      grid(x - max, y - max, x + max, y + max, (k) => {
        // `midpointOf`'s arithmetic, with no point built per edge.
        const e = graph.edges[edges[k]!]!,
          a = graph.nodes[e.a]!,
          b = graph.nodes[e.b]!,
          d2 = ((a.x + b.x) / 2 - x) ** 2 + ((a.y + b.y) / 2 - y) ** 2
        if (d2 >= min * min && d2 <= max * max) found.push(edges[k]!)
      })
      return found
    },
  }
}
