// The tables the game would otherwise work out at load from the dense layers, which it now has
// only near the player: each reads the terrain or the walls map-wide. Every one is computed by the
// game's own code (the owner module's `bake…`), so the bake and the game agree. This module holds
// the registry's runs, keyed as its landings in `BAKES` (bake-landings.ts). `writeMap`
// (build-output.ts) imports it after handing the provisional map to the sim (`provideMap`,
// `setTileSource`), and src/tools/__tests__/bake.map-test.ts runs it on the shipped map to check the
// baked tables are current.
import { bakeMouths } from "../render/mouths/index.ts"
import { bakeLamps } from "../render/sky/lamps.ts"
import { bakeLanes } from "../sim/lanes.ts"
import type { Building, Road, Water } from "../sim/map/index.ts"
import { bakeParked } from "../sim/parking.ts"
import { bakeResidents, buildingCentre } from "../sim/population/density.ts"
import { bakeFarms } from "../sim/population/farms.ts"
import { bedOf } from "../sim/water/channel.ts"
import type { Bakes } from "./bake-landings.ts"
import { bellsOf } from "./bells.ts"

/** The whole map's vectors, in its order: what the bakes that read them all are given (the sim holds them only near the player). */
interface WholeVectors {
  readonly roads: ReadonlyArray<Road>
  readonly buildings: ReadonlyArray<Building>
  readonly water: ReadonlyArray<Omit<Water, "floor">>
}

/** Each bake's run on the provisional map and the whole map's vectors: the lanes, parking and residents read `MAP` and the tiles alone. */
const RUNS: { readonly [K in keyof Bakes]: (whole: WholeVectors) => Bakes[K] } = {
  lanes: () => ({ lanes: bakeLanes() }),
  parked: () => ({ parked: bakeParked() }),
  floors: (whole) => whole.water.map(bedOf),
  bells: (whole) => ({ bells: bellsOf(whole.buildings) }),
  residents: () => ({ residents: bakeResidents() }),
  farms: (whole) => {
    const farms = bakeFarms({ ids: [...whole.buildings.keys()], items: whole.buildings })
    return {
      farms,
      centres: farms.flatMap((f) => {
        const { x, y } = buildingCentre(whole.buildings[f.building]!)
        return [x, y]
      }),
    }
  },
  lamps: (whole) => ({ lamps: bakeLamps(whole.roads) }),
  mouths: (whole) => ({
    mouths: bakeMouths({ ids: [...whole.roads.keys()], items: whole.roads }, whole.buildings),
  }),
}

/** Every baked table, from the map the sim has loaded and its vectors `whole`. */
export const bake = (whole: WholeVectors): Bakes =>
  Object.fromEntries(Object.entries(RUNS).map(([name, run]) => [name, run(whole)])) as Bakes
