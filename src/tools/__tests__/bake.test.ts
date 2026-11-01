import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { eachTile } from "../../sim/map/tiles.ts"
import { bakeParked } from "../../sim/parking.ts"
import { bakeFarms } from "../../sim/population/farms.ts"
import { bedOf } from "../../sim/water/channel.ts"
import { assertBakesCurrentNear } from "./bakes.ts"

// The baked tables by Monzone, so pnpm test notices a change to the code that bakes them; bake.map-test.ts (pnpm test:map)
// bakes the whole map again, the lanes, lamps and the sky's place too.
test("Lunigiana's baked parked spots, water beds and farms by Monzone are what the game's code makes of them now (run pnpm map when this fails)", () => {
  assertBakesCurrentNear(MAP, { x: -493.8, y: 436.9 }, 1000, {
    bakeParked,
    bedOf,
    bakeFarms,
    eachTile,
  })
})
