import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeMap } from "../../../tools/map-file.ts"
import { assertGroundAsBefore } from "./ground-checks.ts"

// Map check (pnpm test:map): Lunigiana's every road, river and road bucket; ground.test.ts checks
// that the answers by Monzone are the same whichever tiles are in memory.
test("the ground, the surface and the water read from the tiles answer as the whole map's broad phases did, to the bit, across the seams too", () => {
  const checked = assertGroundAsBefore(wholeMap(), 63)
  assert.ok(checked > 100_000, `${checked} points`)
})
