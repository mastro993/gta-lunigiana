/**
 * How vehicles stand on the map's parked spots: settled on their wheels where the ground is level
 * enough, and where a truck fits. It reads the terrain and the walls at every spot of the map, so the
 * build bakes it into the spots (`bakeParked`, `MAP.spawns.parked`) and `systems/spawn.ts` reads
 * them; `bake.test.ts` checks they are current.
 *
 * @module parking
 */
import { Ops } from "@typeonce/ritmo-math"

import { carClear } from "./body.ts"
import { settle, uprightness } from "./chassis.ts"
import { MAP, type ParkedSpot, type Rest, type Spawn } from "./map/index.ts"
import { VEHICLE_MODELS } from "./vehicles.ts"

/**
 * A vehicle that would stand tilted more than this (rad, 15°) on a spot is not parked there: the 4 m terrain puts some verges on a
 * bank. A spot too steep for a Panda is skipped; one too steep for the Ape or the truck the dice gave it gets a Panda instead.
 */
const LEVEL = 0.26

/** Every parked spot of the map with each model's rest where it stands level, and whether a truck fits (clear of the walls, and level). */
export const bakeParked = (): Array<ParkedSpot> =>
  MAP.spawns.parked.map(({ x, y, angle }) => {
    const spot: Spawn = { x, y, angle }
    const rest: Partial<Record<(typeof VEHICLE_MODELS)[number], Rest>> = {}
    for (const model of VEHICLE_MODELS) {
      const chassis = settle(model, spot)
      if (uprightness(chassis) > Ops.cos(LEVEL))
        rest[model] = [chassis.z, chassis.pitch, chassis.roll]
    }
    return {
      ...spot,
      rest,
      ...(rest.truck !== undefined && carClear("truck", spot) ? { truck: true as const } : {}),
    }
  })
