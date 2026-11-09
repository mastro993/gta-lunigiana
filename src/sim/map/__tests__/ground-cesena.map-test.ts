import "./use-cesena.ts"
import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeMap } from "../../../tools/map-file.ts"
import { assertGroundAsBefore } from "./ground-checks.ts"

// Map check (pnpm test:map), on Cesena: this process picks it on its first line
// (ground.map-test.ts checks Lunigiana). Its rivers' reaches run up to 386 m.

test("Cesena: the ground, the surface and the water read from the tiles answer as the whole map's broad phases did, to the bit", () => {
  const checked = assertGroundAsBefore(wholeMap("cesena"), 64)
  assert.ok(checked > 10_000, `${checked} points`)
})
