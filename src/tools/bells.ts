// Which towers ring: the tallest church or tower of every district that has one, among all of the
// map's buildings. The bells ring all over the map (src/audio/places.ts), so the build finds them
// once over the whole map and bakes them (`MAP.derived.bells`; bake.ts).
import { type BellEntry, type Building, buildingStyleOf, districtAt } from "../sim/map/index.ts"
import { buildingBox } from "../sim/map/vectors.ts"

/**
 * The bells among `buildings` (the whole map's, in its order): per district, by the centre of each
 * building's box, its tallest church or tower (the first of the tallest), in the order the districts
 * first have one.
 */
export const bellsOf = (buildings: ReadonlyArray<Building>): Array<BellEntry> => {
  const tallest = new Map<string, number>()
  buildings.forEach((b, i) => {
    const style = buildingStyleOf(b)
    if (style !== "church" && style !== "tower") return
    const [bx0, by0, bx1, by1] = buildingBox(b.outer),
      district = districtAt((bx0 + bx1) / 2, (by0 + by1) / 2).name,
      best = tallest.get(district)
    if (best === undefined || b.h > buildings[best]!.h) tallest.set(district, i)
  })
  return [...tallest.values()].map((i) => {
    const { id, z0, h, outer } = buildings[i]!,
      [bx0, by0, bx1, by1] = buildingBox(outer)
    return { id, x: (bx0 + bx1) / 2, y: (by0 + by1) / 2, z: z0 + h, h }
  })
}
