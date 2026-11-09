import "../../sim/map/__tests__/use-cesena.ts"
import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { bake } from "../bake.ts"
import { assertBakesCurrent } from "./bakes.ts"

// This process loads Cesena (bake.map-test.ts checks Lunigiana), picked on the first line.
test("Cesena's baked tables are what the game's code makes of the map now (run pnpm map --region cesena when this fails)", () => {
  assert.equal(MAP.name, "cesena")
  assertBakesCurrent(MAP, bake)
})
