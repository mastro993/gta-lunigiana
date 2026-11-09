import "../../sim/map/__tests__/use-cesena.ts"
import assert from "node:assert/strict"
import { test } from "node:test"

import { checkTerminals, railwayAround } from "../../sim/rail/__tests__/railway-checks.ts"
import { checkDrawnRuns } from "./rail-checks.ts"

// Map check (pnpm test:map), on Cesena: this process picks it on its first line
// (lines.map-test.ts and rail.map-test.ts check Lunigiana's). Its two lines leave the play area on
// its bounds, to the north-west and east, where no track runs on in the box: their run-outs go
// straight on over the apron.

test("Cesena: every line runs its pieces terminal to terminal, then its run-out past each, its bed on the ground over the drawn run, and two rails drawn there where its trains ride", () => {
  checkTerminals(railwayAround().lines)
  // Both rails every metre past each of the four terminals.
  assert.equal(checkDrawnRuns(), 4 * 2 * 192)
})
