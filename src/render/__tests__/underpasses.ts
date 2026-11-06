// The underpasses index.test.ts jumps the player to, found by geometry in the tiles round a spot so the tests survive a map
// rebuild and a new map part: where an at-grade road passes under a road bridge's deck with room to stand between them.
import { atGrade, roadLevel } from "../../sim/map/ground.ts"
import { graph, inPlay } from "../../sim/map/index.ts"
import { distanceToEdge, walkIndex } from "../../sim/route.ts"
import { vectorsAround } from "../testing.ts"

/** An at-grade road under a road bridge's deck: where their centrelines cross, the deck's top and the road's surface there. */
export interface Underpass {
  readonly x: number
  readonly y: number
  /** The bridge's road and the road under it, indices into `MAP.roads`. */
  readonly bridge: number
  readonly road: number
  /** The bridge's deck (`roadLevel`) and the ground on the terrain's level under it (`atGrade`), m a.s.l. */
  readonly deck: number
  readonly ground: number
}

/** Where segments a→b and c→d cross, as the fraction of the way from a to b, or undefined. */
const crossing = (
  [ax, ay, bx, by]: readonly [number, number, number, number],
  [cx, cy, dx, dy]: readonly [number, number, number, number],
): number | undefined => {
  const rx = bx - ax,
    ry = by - ay,
    sx = dx - cx,
    sy = dy - cy,
    den = rx * sy - ry * sx
  if (Math.abs(den) < 1e-9) return undefined
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den,
    u = ((cx - ax) * ry - (cy - ay) * rx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : undefined
}

/** Segment k of a road's line. */
const segment = (pts: ReadonlyArray<number>, k: number) =>
  pts.slice(2 * k, 2 * k + 4) as [number, number, number, number]

/**
 * Every underpass in the play area within `reach` m of `spot` whose deck stands `room` m or more over the road under it (room
 * for a person under it, as issue #87 counts it), in the map's order of bridges, then roads under them.
 */
export const underpassesAround = (
  spot: { readonly x: number; readonly y: number },
  reach: number,
  room = 2.5,
): ReadonlyArray<Underpass> => {
  const { roads } = vectorsAround([spot], reach)
  const all = roads.items.map((r, k) => ({ r, index: roads.ids[k]! }))
  const atGradeRoads = all.filter(({ r }) => r.bridge !== true && r.tunnel !== true)
  const found: Array<Underpass> = []
  for (const bridge of all.filter(({ r }) => r.bridge === true))
    for (let k = 0; 2 * k + 3 < bridge.r.pts.length; k++)
      for (const road of atGradeRoads)
        for (let m = 0; 2 * m + 3 < road.r.pts.length; m++) {
          const ab = segment(bridge.r.pts, k),
            t = crossing(ab, segment(road.r.pts, m))
          if (t === undefined) continue
          const x = ab[0] + (ab[2] - ab[0]) * t,
            y = ab[1] + (ab[3] - ab[1]) * t
          const deck = roadLevel(bridge.index, x, y),
            ground = atGrade(x, y)
          if (Math.hypot(x - spot.x, y - spot.y) > reach || !inPlay(x, y)) continue
          if (deck === undefined || deck - ground < room) continue
          found.push({ x, y, bridge: bridge.index, road: road.index, deck, ground })
        }
  return found
}

/** The walk edge of road `road` (index into `MAP.roads`) nearest (x, y) on it, or undefined when people walk none of it there. */
export const walkEdgeOf = (road: number, x: number, y: number): number | undefined => {
  let best: number | undefined,
    distance = Number.MAX_VALUE
  // Edges are at most ~25 m: the one through (x, y) has its midpoint within 13 m of it.
  for (const edge of walkIndex.around(x, y, [0, 15])) {
    if (graph.edges[edge]!.road !== road) continue
    const d = distanceToEdge(edge, x, y)
    if (d < distance) [best, distance] = [edge, d]
  }
  return best
}
