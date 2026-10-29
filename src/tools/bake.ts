// The tables the game would otherwise work out at load from the dense layers, which it now has
// only near the player: each reads the terrain or the walls map-wide. Every one is computed by the
// game's own code (the owner module's `bake…`), so the bake and the game agree. build-map.ts imports
// this module after handing the provisional map to the sim (`provideMap`, `setTileSource`), and
// src/tools/__tests__/bake.test.ts runs it on the shipped map to check the baked tables are current.
import { bakeLamps } from "../render/sky/lamps.ts"
import { bakeLanes } from "../sim/lanes.ts"
import { MAP } from "../sim/map/index.ts"
import { bakeParked } from "../sim/parking.ts"
import { bakeFarms } from "../sim/population/farms.ts"
import { bedOf } from "../sim/water/channel.ts"
import type { Bakes } from "./tile-map.ts"

/** Every baked table, from the map the sim has loaded. */
export const bake = (): Bakes => ({
  lanes: bakeLanes(),
  parked: bakeParked(),
  floors: MAP.water.map(bedOf),
  farms: bakeFarms(),
  lamps: bakeLamps(),
})
