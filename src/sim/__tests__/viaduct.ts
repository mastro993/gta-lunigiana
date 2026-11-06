/**
 * The SR445's viaduct west of Gragnola (OSM 552592654) and the residential road under it (OSM
 * 140780578), found by geometry: the parapet tests of `walls.test.ts` and `walls.long-test.ts`
 * (issue #91). They read tile −2_2 alone.
 *
 * @module sim/__tests__/viaduct
 */
import { Ops } from "@typeonce/ritmo-math"

import { segDist2 } from "../collide.ts"
import { roadLevel } from "../map/ground.ts"
import { graph, isDrivable, MAP, roadClassOf } from "../map/index.ts"
import { placeAt } from "../map/tiles.ts"
import { edgeIndex } from "../route.ts"

/** Where the issue drove a Panda off the deck, over the road under it. */
const AT = { x: -2674.3, y: 4584 }

/** The drivable bridge whose line passes nearest AT: its index and its segment there. */
const deckRoad = (() => {
  const { ids, items } = placeAt(AT.x, AT.y).vectors.roads
  let best: { road: number; d2: number; ax: number; ay: number; bx: number; by: number } | null =
    null
  for (const [k, road] of ids.entries()) {
    const info = MAP.roads[road]!
    if (info.bridge !== true || !isDrivable(roadClassOf(info))) continue
    const { pts } = items[k]!
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const [ax, ay, bx, by] = [pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!]
      const { d2 } = segDist2(AT.x, AT.y, ax, ay, bx, by)
      if (best === null || d2 < best.d2) best = { road, d2, ax, ay, bx, by }
    }
  }
  if (best === null) throw new Error("no bridge by the SR445's viaduct")
  return best
})()

/** The traffic edge nearest AT on a road at grade: the residential road under the viaduct. */
const underEdge = edgeIndex(
  graph.trafficEdges.filter((e) => MAP.roads[graph.edges[e]!.road]!.bridge !== true),
).nearest(AT.x, AT.y)

const { ax, ay, bx, by } = deckRoad,
  len = Ops.hypot(bx - ax, by - ay)
const under = graph.edges[underEdge]!,
  p = graph.nodes[under.a]!,
  q = graph.nodes[under.b]!
// Where the road under crosses the deck's centreline.
const t =
  ((ax - p.x) * (by - ay) - (ay - p.y) * (bx - ax)) /
  ((q.x - p.x) * (by - ay) - (q.y - p.y) * (bx - ax))
const cross = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }

/** The viaduct: its road's index, its half-width (m), its heading's unit vector and its left (`across`), and its surface over the road under it (m a.s.l.). */
export const VIADUCT = {
  road: deckRoad.road,
  half: MAP.roads[deckRoad.road]!.w / 2,
  along: { x: (bx - ax) / len, y: (by - ay) / len },
  across: { x: -(by - ay) / len, y: (bx - ax) / len },
  level: roadLevel(deckRoad.road, cross.x, cross.y)!,
}

/** The road under the viaduct: its traffic edge there, and its surface where it passes under (m a.s.l.). */
export const UNDER = {
  edge: underEdge,
  level: roadLevel(under.road, cross.x, cross.y)!,
}

/** Where the road under crosses the viaduct's centreline. */
export const CROSSING = cross

/** A pose on the viaduct's centreline over the road under it, facing its left (`side` 1) or its right (−1). */
export const acrossDeck = (side: 1 | -1) => ({
  ...CROSSING,
  angle: Ops.atan2(side * VIADUCT.across.y, side * VIADUCT.across.x),
})

/** Where the player stands out of the way: on the viaduct, 30 m along it from the road under it. */
export const ASIDE = {
  x: CROSSING.x + VIADUCT.along.x * 30,
  y: CROSSING.y + VIADUCT.along.y * 30,
  angle: 0,
}

/** How far `at` stands off the viaduct's centreline, m, to its left (positive) or its right. */
export const offDeck = (at: { readonly x: number; readonly y: number }): number =>
  (at.x - CROSSING.x) * VIADUCT.across.x + (at.y - CROSSING.y) * VIADUCT.across.y
