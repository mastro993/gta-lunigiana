// The check bake.test.ts and cesena-bake.test.ts share: the baked tables of the map the sim has loaded are what the game's
// own code makes of it now (lanes, parking, water beds, farms, lamps, the sky's place). Change that code or its tuning and the
// shipped maps are stale until `pnpm map` and `pnpm map --region cesena` bake them again.
import assert from "node:assert/strict"

import type { MonzoneMap } from "../../sim/map/index.ts"
import { placeFrom } from "../../sim/sky/place.ts"
import type { bake } from "../bake.ts"
import { wholeMap } from "../map-file.ts"

/** As the map file holds it: JSON keeps no −0 and no undefined. */
const saved = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

/** Asserts `map`'s baked tables equal a fresh `run()` of the bake and its place a fresh fit over its whole heightmap. */
export const assertBakesCurrent = (map: MonzoneMap, run: typeof bake): void => {
  const fresh = saved(run()) as ReturnType<typeof bake>
  const hint = `run pnpm map${map.name === "monzone" ? "" : " --region cesena"}`
  assert.deepEqual(fresh.lanes, saved(map.lanes), `MAP.lanes (src/sim/lanes.ts): ${hint}`)
  assert.deepEqual(
    fresh.parked,
    saved(map.spawns.parked),
    `MAP.spawns.parked (src/sim/parking.ts): ${hint}`,
  )
  assert.deepEqual(
    fresh.floors,
    saved(map.water.map((w) => w.floor)),
    `Water.floor (src/sim/water/channel.ts): ${hint}`,
  )
  assert.deepEqual(
    fresh.farms,
    saved(map.farms),
    `MAP.farms (src/sim/population/farms.ts): ${hint}`,
  )
  assert.deepEqual(fresh.lamps, saved(map.lamps), `MAP.lamps (src/render/sky/lamps.ts): ${hint}`)
  const { floor, downslope } = placeFrom(map.origin, wholeMap(map.name).heightmap)
  assert.deepEqual({ floor, downslope }, map.place, `MAP.place (src/sim/sky/place.ts): ${hint}`)
}
