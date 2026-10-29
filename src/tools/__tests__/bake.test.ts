import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { bake } from "../bake.ts"
import { assertBakesCurrent } from "./bakes.ts"

// The baked tables come from the game's own code (lanes, parking, water beds, farms, lamps, the sky's place): change that
// code or its tuning and the shipped map is stale until `pnpm map` bakes them again. This test is what notices; Cesena's
// tables have their own process (cesena-bake.test.ts), since a process loads one map.
test("Lunigiana's baked tables are what the game's code makes of the map now (run pnpm map when this fails)", () => {
  assertBakesCurrent(MAP, bake)
})
