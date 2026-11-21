/**
 * Lookups over the map graph's edges as straight chords: the distance to an edge's centreline, its
 * midpoint, and grids that find the nearest edge or the edges around a point without scanning the
 * whole map. Static, derived once from `graph`. Kept apart from `route` so that modules `route`
 * reads (the residents along each walk edge) can use them without an import cycle.
 *
 * @module edges
 */
import { segmentDistance, staticGrid } from "./collide.ts"
import { ANCHOR, graph, type Segment } from "./map/index.ts"

/** Every graph edge as a segment a -> b, indexed like `graph.edges`. */
const chords: ReadonlyArray<Segment> = graph.edges.map((e) => {
  const a = graph.nodes[e.a]!,
    b = graph.nodes[e.b]!
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y }
})

/** Distance from (x, y) to the centreline of `edge`. */
export const distanceToEdge = (edge: number, x: number, y: number): number =>
  segmentDistance(chords[edge]!, x, y)

/** Midpoint of every graph edge, indexed like `graph.edges`. */
const midpoints: ReadonlyArray<{ readonly x: number; readonly y: number }> = chords.map((c) => ({
  x: (c.ax + c.bx) / 2,
  y: (c.ay + c.by) / 2,
}))

/** The midpoint of `edge`'s centreline. */
export const midpointOf = (edge: number): { readonly x: number; readonly y: number } =>
  midpoints[edge]!

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
      const c = chords[edges[k]!]!
      return [
        Math.min(c.ax, c.bx),
        Math.min(c.ay, c.by),
        Math.max(c.ax, c.bx),
        Math.max(c.ay, c.by),
      ]
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
        const m = midpoints[edges[k]!]!,
          d2 = (m.x - x) ** 2 + (m.y - y) ** 2
        if (d2 >= min * min && d2 <= max * max) found.push(edges[k]!)
      })
      return found
    },
  }
}
