// Each building's floor, read off the finished grid as the ground stood before the paths'
// approaches: the map ships it (`z0`), and the walls read it to open a house only on its level.
import type { BuildingF } from "./features.ts"
import { sampleGrid, type Grid } from "./terrain.ts"

/**
 * Each building's floor (`z0`): the least of the grid sampled at its rings' vertices, on the ground
 * as it stood before the paths' approaches (`before`, the nodes their claims moved): a building stands
 * on that ground, and the stairs down to an underpass run under it. On the grid they carved, Cesena's
 * station (185180766) sank 4.8 m into its plaza, 1.0 m of its 6 m showing, and two buildings by it
 * 2.9 and 4.2 m (68910735, 1270896860), the footways to the underpass 43076054 running on its wall;
 * on the coast an approach's bank lifted a shed 3.0 m, its top under the bank. The grid holds those
 * nodes' levels without them for the reading alone.
 */
export const floorsOf = (
  grid: Grid,
  before: ReadonlyMap<number, number>,
  buildings: ReadonlyArray<Pick<BuildingF, "outer" | "holes">>,
): Array<number> => {
  const after = [...before.keys()].map((n) => grid.z[n]!)
  for (const [n, z] of before) grid.z[n] = z
  const floors = buildings.map((b) => {
    let z0 = Number.MAX_VALUE
    for (const ring of [b.outer, ...(b.holes ?? [])])
      for (let i = 0; i < ring.length; i += 2)
        z0 = Math.min(z0, sampleGrid(grid, ring[i]!, ring[i + 1]!))
    return z0
  })
  let k = 0
  for (const n of before.keys()) grid.z[n] = after[k++]!
  return floors
}
