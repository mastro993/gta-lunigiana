import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { gunzipSync } from "node:zlib"

import { provideMap } from "../../sim/map/packed.ts"
import { assertBakesCurrentNear } from "./bakes.ts"

// This process loads Cesena (bake.test.ts checks Lunigiana): the global file goes in before anything decodes the map.
// cesena-bake.map-test.ts (pnpm test:map) bakes the whole map again.
test("Cesena's baked parked spots, water beds and farms round its start are what the game's code makes of them now (run pnpm map --region cesena when this fails)", async () => {
  provideMap(gunzipSync(readFileSync(new URL("../../sim/map/cesena.bin", import.meta.url))))
  const { MAP } = await import("../../sim/map/index.ts")
  const { bakeParked } = await import("../../sim/parking.ts")
  const { bakeFarms } = await import("../../sim/population/farms.ts")
  const { bedOf } = await import("../../sim/water/channel.ts")
  const { eachTile } = await import("../../sim/map/tiles.ts")
  assert.equal(MAP.name, "cesena")
  assertBakesCurrentNear(MAP, MAP.spawns.player, 1000, {
    bakeParked,
    bedOf,
    bakeFarms,
    eachTile,
  })
})
