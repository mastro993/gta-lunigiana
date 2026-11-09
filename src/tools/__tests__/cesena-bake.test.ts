import "../../sim/map/__tests__/use-cesena.ts"
import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { eachTile } from "../../sim/map/tiles.ts"
import { bakeParked } from "../../sim/parking.ts"
import { bakeFarms } from "../../sim/population/farms.ts"
import { bedOf } from "../../sim/water/channel.ts"
import { assertBakesCurrentNear } from "./bakes.ts"

// This process loads Cesena (bake.test.ts checks Lunigiana), picked on the first line.
// cesena-bake.map-test.ts (pnpm test:map) bakes the whole map again.
test("Cesena's baked parked spots, water beds and farms round its start are what the game's code makes of them now (run pnpm map --region cesena when this fails)", () => {
  assert.equal(MAP.name, "cesena")
  assertBakesCurrentNear(MAP, MAP.spawns.player, 1000, {
    bakeParked,
    bedOf,
    bakeFarms,
    eachTile,
  })
})
