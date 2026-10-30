import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../map/index.ts"
import { assertVergesDry } from "./verges.ts"

// Map check (pnpm test:map): every bridge of the map; water.test.ts checks those by Monzone.
// Regression: the deck lookup skipped a bridge by its first vertex's height and read one 16 m bucket, putting verge walkers
// in the river.
test("bridges: every walker's verge over the water in a spate (0.6 m³/s per km²) is on the deck, on every bridge of the map", () => {
  const checked = assertVergesDry(MAP.roads, 0.6)
  assert.ok(checked > 20, `${checked} verge points over deep water`)
})
