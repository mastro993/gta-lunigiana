import { test } from "node:test"

import { checkStepsClear, railwayAround } from "./railway-checks.ts"

// Map check (pnpm test:map): every level crossing of the map; roads.test.ts checks those by
// Monzone station.
test("roads: no traffic step into any box of the map has its middle, where traffic is brought out, outside the box's clearance unless it is long", () => {
  checkStepsClear(railwayAround().boxes)
})
