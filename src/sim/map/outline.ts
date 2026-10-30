/**
 * The play area's outline, as the build writes it into the global file (`MAP.outline`) and as the
 * build and the game both test points against it: flat rings [x0, y0, x1, y1, ...], each closed
 * from its last vertex back to its first, outer rings counter-clockwise and holes clockwise, so the
 * play area lies left of every edge. It imports no map data, so the build shares it. Only + − × ÷
 * and sqrt, so every architecture answers alike; a vertical or horizontal edge is measured by a
 * plain difference of coordinates, so a rectangle answers bit for bit as a box test does.
 *
 * @module map/outline
 */
import { pointInRing, segDist2 } from "../collide.ts"

/** Flat rings [x0, y0, x1, y1, ...]: outer rings counter-clockwise, holes clockwise. */
export type Rings = ReadonlyArray<ReadonlyArray<number>>

/** Within this distance of an edge (m), a point lies on it: for slanted edges, whose distances round. */
const ON = 1e-9

/**
 * Whether (x, y) lies within `margin` (m) of edge a–b; with `margin` 0, whether it lies on it. Beside
 * a vertical edge it compares x with the edge's X ± margin (a horizontal one y with Y ± margin), as
 * a box test with a margin does.
 */
const nearEdge = (
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  margin: number,
): boolean => {
  if (ax === bx && y >= Math.min(ay, by) && y <= Math.max(ay, by))
    return margin > 0 ? x > ax - margin && x < ax + margin : x === ax
  if (ay === by && x >= Math.min(ax, bx) && x <= Math.max(ax, bx))
    return margin > 0 ? y > ay - margin && y < ay + margin : y === ay
  const { d2 } = segDist2(x, y, ax, ay, bx, by)
  return margin > 0 ? d2 < margin * margin : d2 <= ON * ON
}

/**
 * Whether (x, y) lies in the area the rings bound (an edge counts as in it) with no edge closer
 * than `margin` m (≥ 0). On a rectangle this is `x >= minX + margin && x <= maxX − margin` and the
 * same in y, to the bit.
 */
export const insideRings = (rings: Rings, x: number, y: number, margin = 0): boolean => {
  let odd = false,
    on = false
  for (const ring of rings) {
    if (pointInRing(x, y, ring)) odd = !odd
    const n = ring.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++)
      if (nearEdge(x, y, ring[2 * j]!, ring[2 * j + 1]!, ring[2 * i]!, ring[2 * i + 1]!, margin)) {
        if (margin > 0) return false
        on = true
      }
  }
  return odd || on
}

/** Distance (m) from (x, y) to edge a–b: beside a vertical edge |x − X|, beside a horizontal one |y − Y|, exactly. */
export const edgeDistance = (
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  if (ax === bx && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return Math.abs(x - ax)
  if (ay === by && x >= Math.min(ax, bx) && x <= Math.max(ax, bx)) return Math.abs(y - ay)
  return Math.sqrt(segDist2(x, y, ax, ay, bx, by).d2)
}

/** Distance (m) from (x, y) to the nearest edge of the rings (`edgeDistance`). */
export const ringsDistance = (rings: Rings, x: number, y: number): number => {
  let best = Infinity
  for (const ring of rings) {
    const n = ring.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++)
      best = Math.min(
        best,
        edgeDistance(x, y, ring[2 * j]!, ring[2 * j + 1]!, ring[2 * i]!, ring[2 * i + 1]!),
      )
  }
  return best
}
