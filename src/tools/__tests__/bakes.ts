// The checks bake.test.ts, bake.map-test.ts and the Cesena pair share: the baked tables of the map the sim has loaded are
// what the game's own code makes of it now (lanes, parking, water beds, farms, lamps, the sky's place). Change that code or
// its tuning and the shipped maps are stale until `pnpm map` and `pnpm map --region cesena` bake them again.
import assert from "node:assert/strict"

import type { MonzoneMap } from "../../sim/map/index.ts"
import type { bakeParked } from "../../sim/parking.ts"
import type { bakeFarms } from "../../sim/population/farms.ts"
import { placeFrom } from "../../sim/sky/place.ts"
import type { bedOf } from "../../sim/water/channel.ts"
import type { bake } from "../bake.ts"
import { wholeMap } from "../map-file.ts"

/** As the map file holds it: JSON keeps no −0 and no undefined. */
const saved = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

/** What to run to bake `map` again. */
const hintFor = (map: MonzoneMap) =>
  `run pnpm map${map.name === "monzone" ? "" : " --region cesena"}`

/** Asserts `map`'s baked tables equal a fresh `run()` of the bake and its place a fresh fit over its whole heightmap. */
export const assertBakesCurrent = (map: MonzoneMap, run: typeof bake): void => {
  const fresh = saved(run()) as ReturnType<typeof bake>
  const hint = hintFor(map)
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

/** The bakes that run item by item, from the modules of the map the sim has loaded (Cesena's process imports them late). */
export interface ItemBakes {
  readonly bakeParked: typeof bakeParked
  readonly bedOf: typeof bedOf
  readonly bakeFarms: typeof bakeFarms
}

/**
 * Asserts `map`'s parked rests, water floors and farms within `reach` m of `at` equal a fresh bake of just those: the
 * cheap stand-in for `assertBakesCurrent`, whose cost grows with the map. The lanes, the lamps and the place are worked
 * out map-wide, so only it checks them.
 */
export const assertBakesCurrentNear = (
  map: MonzoneMap,
  at: { readonly x: number; readonly y: number },
  reach: number,
  { bakeParked, bedOf, bakeFarms }: ItemBakes,
): void => {
  const hint = hintFor(map),
    near = (x: number, y: number) => Math.hypot(x - at.x, y - at.y) <= reach
  const spots = map.spawns.parked.filter((p) => near(p.x, p.y))
  assert.ok(spots.length > 10, `${spots.length} parked spots`)
  assert.deepEqual(
    saved(bakeParked(spots)),
    saved(spots),
    `MAP.spawns.parked (src/sim/parking.ts): ${hint}`,
  )
  const waters = map.water.filter((w) =>
    w.pts.some((v, k) => k % 2 === 0 && near(v, w.pts[k + 1]!)),
  )
  assert.ok(waters.length > 0, "water")
  assert.deepEqual(
    saved(waters.map(bedOf)),
    saved(waters.map((w) => w.floor)),
    `Water.floor (src/sim/water/channel.ts): ${hint}`,
  )
  const buildings = [...map.buildings.keys()].filter((i) =>
    near(map.buildings[i]!.outer[0]!, map.buildings[i]!.outer[1]!),
  )
  const inside = new Set(buildings)
  assert.deepEqual(
    saved(bakeFarms(buildings)),
    saved(map.farms.filter((f) => inside.has(f.building))),
    `MAP.farms (src/sim/population/farms.ts): ${hint}`,
  )
}
