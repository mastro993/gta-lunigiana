/**
 * Where the player is, in words: the name of the nearest road, if it has one (tracks and paths
 * skipped, their refs are trail numbers), and the district from the map.
 *
 * @module hud/location
 */
import { districtAt, MAP } from "../sim/map/index.ts"
import { isRoadClass } from "../sim/map/kinds.ts"
import { isResidentAt, placeAt } from "../sim/map/tiles.ts"
import { segDist2 } from "../tools/geometry.ts"

/** Whether the HUD can name a road of class `cls`: tracks and paths not (a class the build does not emit reads as a path). */
const nameable = (cls: string): boolean => isRoadClass(cls) && cls !== "track" && cls !== "path"

/**
 * The name (or ref) of the nearest road the HUD can name (`nameable`) within `reach` metres of
 * (x, y); undefined when that road has none. It reads the roads of the point's place (`placeAt`:
 * every road within the tiles' `HALO` of it, which is more than `reach`) in the whole map's order,
 * so a tie goes to the lowest road index, then its first segment; where that place is not in
 * memory (never under the player: the host keeps the tiles round it) it names none.
 */
const roadNear = (x: number, y: number, reach = 15): string | undefined => {
  if (!isResidentAt(x, y)) return undefined
  const { ids, items } = placeAt(x, y).vectors.roads
  let best = reach * reach,
    found: string | undefined
  for (let k = 0; k < ids.length; k++) {
    const road = MAP.roads[ids[k]!]!
    if (!nameable(road.cls)) continue
    const pts = items[k]!.pts
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const d = segDist2(x, y, pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!).d2
      if (d < best) [best, found] = [d, road.name ?? road.ref]
    }
  }
  return found
}

/** Road (if any) and district at (x, y). */
export const locationAt = (
  x: number,
  y: number,
): { readonly road: string | undefined; readonly district: string } => ({
  road: roadNear(x, y),
  district: districtAt(x, y).name,
})
