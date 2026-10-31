// What location.ts answered when the global file held every road's line, for location.test.ts
// (the roads of the tiles round Monzone) and location.map-test.ts (the whole map's) to compare
// `locationAt` with: every road the HUD can name, in the whole map's order, every segment, the
// first nearest within 15 m.
import { isRoadClass } from "../../sim/map/kinds.ts"
import { segDist2 } from "../../tools/geometry.ts"

/** A road as the oracle reads it: its attributes and line. */
interface OracleRoad {
  readonly cls: string
  readonly name?: string
  readonly ref?: string
  readonly pts: ReadonlyArray<number>
}

/**
 * The old `roadNear` over `roads` (any subset holding every road within 15 m of the points it is
 * asked about, in the whole map's order): the name or ref of the first nearest road within 15 m
 * that is neither a track nor a path, by `<` over the roads, then their segments; a road whose box
 * lies farther than that is passed over, which never changes the answer.
 */
export const roadOracle = (roads: ReadonlyArray<OracleRoad>) => {
  const kept = roads
    .filter((road) => isRoadClass(road.cls) && road.cls !== "track" && road.cls !== "path")
    .map((road) => {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity
      for (let k = 0; k + 1 < road.pts.length; k += 2) {
        x0 = Math.min(x0, road.pts[k]!)
        x1 = Math.max(x1, road.pts[k]!)
        y0 = Math.min(y0, road.pts[k + 1]!)
        y1 = Math.max(y1, road.pts[k + 1]!)
      }
      return { name: road.name ?? road.ref, pts: road.pts, box: [x0, y0, x1, y1] as const }
    })
  return (x: number, y: number, reach = 15): string | undefined => {
    let best = reach * reach,
      found: string | undefined
    for (const { name, pts, box } of kept) {
      if (box[0] - reach > x || box[2] + reach < x || box[1] - reach > y || box[3] + reach < y)
        continue
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const d = segDist2(x, y, pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!).d2
        if (d < best) [best, found] = [d, name]
      }
    }
    return found
  }
}
