// The checks bake.test.ts, bake.map-test.ts and the Cesena pair share: the baked tables of the map the sim has loaded are
// what the game's own code makes of it now (lanes, parking, water beds, farms, lamps, the sky's place, the bells, the walkers'
// residents, the farms' centres, and the copies of what the railway points at). Change that code or
// its tuning and the shipped maps are stale until `pnpm map` and `pnpm map --region cesena` bake them again.
import assert from "node:assert/strict"

import type { MonzoneMap } from "../../sim/map/index.ts"
import type { Layer, TileVectors } from "../../sim/map/packed.ts"
import type { eachTile } from "../../sim/map/tiles.ts"
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
  const whole = wholeMap(map.name)
  const fresh = saved(run(whole)) as ReturnType<typeof bake>
  const hint = hintFor(map)
  assert.deepEqual(fresh.lanes, saved(map.lanes), `MAP.lanes (src/sim/lanes.ts): ${hint}`)
  assert.deepEqual(
    fresh.parked,
    saved(map.spawns.parked),
    `MAP.spawns.parked (src/sim/parking.ts): ${hint}`,
  )
  assert.deepEqual(
    fresh.floors,
    saved(whole.water.map((w) => w.floor)),
    `Water.floor (src/sim/water/channel.ts): ${hint}`,
  )
  assert.deepEqual(
    fresh.farms,
    saved(map.farms),
    `MAP.farms (src/sim/population/farms.ts): ${hint}`,
  )
  assert.deepEqual(fresh.lamps, saved(map.lamps), `MAP.lamps (src/render/sky/lamps.ts): ${hint}`)
  assert.deepEqual(
    fresh.bells,
    saved(map.derived.bells),
    `MAP.derived.bells (src/tools/bells.ts): ${hint}`,
  )
  assert.deepEqual(
    fresh.residents,
    saved(map.derived.residents),
    `MAP.derived.residents (src/sim/population/density.ts): ${hint}`,
  )
  assert.deepEqual(
    fresh.farmCentres,
    saved(map.derived.farms),
    `MAP.derived.farms (src/sim/population/density.ts): ${hint}`,
  )
  const { floor, downslope } = placeFrom(map.origin, whole.heightmap)
  assert.deepEqual({ floor, downslope }, map.place, `MAP.place (src/sim/sky/place.ts): ${hint}`)
  // the copies of what the railway points at
  const { crossings, platforms, stations } = map.railway
  assert.deepEqual(
    map.derived.crossings,
    crossings.map((c) => ({ pts: whole.roads[c.road]!.pts, z: whole.roads[c.road]!.z })),
  )
  assert.deepEqual(
    map.derived.platforms,
    platforms.map((p) => whole.areas[p.area]!.rings),
  )
  assert.deepEqual(
    map.derived.stations,
    stations.map(
      (st) => whole.buildings.find((b) => b.style === "station" && b.name === st.name) ?? null,
    ),
  )
}

/**
 * The bakes that run item by item, and the walk over the tiles that finds the items near a spot, from the modules of the
 * map the sim has loaded (Cesena's process imports them late).
 */
export interface ItemBakes {
  readonly bakeParked: typeof bakeParked
  readonly bedOf: typeof bedOf
  readonly bakeFarms: typeof bakeFarms
  readonly eachTile: typeof eachTile
}

/** The features of a layer in the tiles over the box `reach` m round `at` (`eachTile`): each once, in the whole map's order. */
const layerRound = <T>(
  each: typeof eachTile,
  at: { readonly x: number; readonly y: number },
  reach: number,
  of: (vectors: TileVectors) => Layer<T>,
): Layer<T> => {
  const byId = new Map<number, T>()
  each(at.x - reach, at.y - reach, at.x + reach, at.y + reach, ({ vectors }) => {
    const { ids, items } = of(vectors)
    ids.forEach((id, k) => byId.set(id, items[k]!))
  })
  const ids = [...byId.keys()].sort((a, b) => a - b)
  return { ids, items: ids.map((id) => byId.get(id)!) }
}

/**
 * Asserts `map`'s parked rests, water floors and farms within `reach` m of `at` equal a fresh bake of just those: the
 * cheap stand-in for `assertBakesCurrent`, whose cost grows with the map. It reads the waters and buildings of the tiles
 * round `at` only (any with a vertex within `reach` lies in one of them). The lanes, the lamps and the place are worked
 * out map-wide, so only it checks them.
 */
export const assertBakesCurrentNear = (
  map: MonzoneMap,
  at: { readonly x: number; readonly y: number },
  reach: number,
  { bakeParked, bedOf, bakeFarms, eachTile }: ItemBakes,
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
  const waters = layerRound(eachTile, at, reach, (v) => v.water).items.filter((w) =>
    w.pts.some((v, k) => k % 2 === 0 && near(v, w.pts[k + 1]!)),
  )
  assert.ok(waters.length > 0, "water")
  assert.deepEqual(
    saved(waters.map(bedOf)),
    saved(waters.map((w) => w.floor)),
    `Water.floor (src/sim/water/channel.ts): ${hint}`,
  )
  const round = layerRound(eachTile, at, reach, (v) => v.buildings),
    kept = round.items.flatMap(({ outer }, k) => (near(outer[0]!, outer[1]!) ? [k] : []))
  const buildings = {
      ids: kept.map((k) => round.ids[k]!),
      items: kept.map((k) => round.items[k]!),
    },
    inside = new Set(buildings.ids)
  assert.deepEqual(
    saved(bakeFarms(buildings)),
    saved(map.farms.filter((f) => inside.has(f.building))),
    `MAP.farms (src/sim/population/farms.ts): ${hint}`,
  )
}
