import assert from "node:assert/strict"
import { test } from "node:test"

import { useDiskMap } from "../../sim/map/source.ts"
import { skipUnbuilt, TEST_MAPS } from "../../tools/__tests__/test-maps.ts"

// Map check (pnpm test:map), on the L test region (`lunigiana-l`). This process loads the L from
// test-maps/ (`pnpm maps` builds it); without the build the check is skipped, but in CI, which
// builds it, a missing build fails. Its line leaves at Equi Terme's end of the foot and at the leg's
// north end, both on its bounds.
const [NAME, URL_L] = TEST_MAPS.find(([name]) => name === "the L")!
const skip = skipUnbuilt(NAME, URL_L)
if (skip === false) useDiskMap(URL_L)
const lines =
  skip === false ? await import("../../sim/rail/__tests__/railway-checks.ts") : undefined
const rail = skip === false ? await import("./rail-checks.ts") : undefined

test(
  "the L: its line runs its pieces terminal to terminal, then its run-out past each, its bed on the ground over the drawn run, and two rails drawn there where its trains ride",
  { skip },
  () => {
    lines!.checkTerminals(lines!.railwayAround().lines)
    // Both rails every metre past each of its two terminals.
    assert.equal(rail!.checkDrawnRuns(), 2 * 2 * 192)
  },
)
