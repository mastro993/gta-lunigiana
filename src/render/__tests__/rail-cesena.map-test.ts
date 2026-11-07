import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { gunzipSync } from "node:zlib"

import { provideMap } from "../../sim/map/packed.ts"

// Map check (pnpm test:map), on Cesena: this process loads it before anything decodes the map
// (lines.map-test.ts and rail.map-test.ts check Lunigiana's). Its two lines leave the play area on
// its bounds, to the north-west and east, where no track runs on in the box: their run-outs go
// straight on over the apron.
provideMap(gunzipSync(readFileSync(new URL("../../sim/map/cesena.bin", import.meta.url))))
const { checkTerminals, railwayAround } = await import("../../sim/rail/__tests__/railway-checks.ts")
const { checkDrawnRuns } = await import("./rail-checks.ts")

test("Cesena: every line runs its pieces terminal to terminal, then its run-out past each, its bed on the ground over the drawn run, and two rails drawn there where its trains ride", () => {
  checkTerminals(railwayAround().lines)
  // Both rails every metre past each of the four terminals.
  assert.equal(checkDrawnRuns(), 4 * 2 * 192)
})
