// The tables the game would otherwise work out at load from the dense layers, which it now has
// only near the player: each reads the terrain or the walls map-wide. Every one is computed by the
// game's own code (the owner module's `bake…`), so the bake and the game agree. `writeMap`
// (build-output.ts) imports this module after handing the provisional map to the sim (`provideMap`,
// `setTileSource`), and src/tools/__tests__/bake.map-test.ts runs it on the shipped map to check the
// baked tables are current.
import { bakeLamps } from "../render/sky/lamps.ts"
import { bakeLanes } from "../sim/lanes.ts"
import type { Building, Road, Water } from "../sim/map/index.ts"
import { bakeParked } from "../sim/parking.ts"
import { bakeResidents, buildingCentre } from "../sim/population/density.ts"
import { bakeFarms } from "../sim/population/farms.ts"
import { bedOf } from "../sim/water/channel.ts"
import { bellsOf } from "./bells.ts"
import type { Bakes } from "./tile-map.ts"

/** The whole map's vectors, in its order: what the bakes that read them all are given (the sim holds them only near the player). */
export interface WholeVectors {
  readonly roads: ReadonlyArray<Road>
  readonly buildings: ReadonlyArray<Building>
  readonly water: ReadonlyArray<Omit<Water, "floor">>
}

/** Every baked table, from the map the sim has loaded and its vectors `whole`. */
export const bake = (whole: WholeVectors): Bakes => {
  const farms = bakeFarms({ ids: [...whole.buildings.keys()], items: whole.buildings })
  return {
    lanes: bakeLanes(),
    parked: bakeParked(),
    floors: whole.water.map(bedOf),
    farms,
    lamps: bakeLamps(whole.roads),
    bells: bellsOf(whole.buildings),
    residents: bakeResidents(),
    farmCentres: farms.flatMap((f) => {
      const { x, y } = buildingCentre(whole.buildings[f.building]!)
      return [x, y]
    }),
  }
}
