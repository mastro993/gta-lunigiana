import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { gunzipSync } from "node:zlib"

import { provideMap } from "../../sim/map/packed.ts"
import { assertBakesCurrent } from "./bakes.ts"

// This process loads Cesena (bake.test.ts checks Lunigiana): the global file goes in before anything decodes the map.
test("Cesena's baked tables are what the game's code makes of the map now (run pnpm map --region cesena when this fails)", async () => {
  provideMap(gunzipSync(readFileSync(new URL("../../sim/map/cesena.bin", import.meta.url))))
  const { MAP } = await import("../../sim/map/index.ts")
  const { bake } = await import("../bake.ts")
  assert.equal(MAP.name, "cesena")
  assertBakesCurrent(MAP, bake)
})
