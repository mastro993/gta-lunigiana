import assert from "node:assert/strict"
import { test } from "node:test"

import { skipUnbuilt, TEST_MAPS } from "../../../tools/__tests__/test-maps.ts"
import { readWholeMap } from "../../../tools/map-file.ts"
import { useDiskMap } from "../source.ts"

// Map check (pnpm test:map), on the coast test region (`magra-coast`), whose sea is cut into a
// piece per tile: a lookup reads the pieces of the tile holding it. This process loads the coast
// from test-maps/ (`pnpm maps` builds it); without the build the check is skipped, but in CI, which
// builds it, a missing build fails.
const [NAME, URL_COAST] = TEST_MAPS.find(([name]) => name === "the coast")!
const skip = skipUnbuilt(NAME, URL_COAST)
if (skip === false) useDiskMap(URL_COAST)
const checks = skip === false ? await import("./ground-checks.ts") : undefined

test(
  "the coast: the ground, the surface and the water read from the tiles answer as the whole map's broad phases did, over the sea too",
  { skip },
  () => {
    const checked = checks!.assertGroundAsBefore(readWholeMap(URL_COAST), 65)
    assert.ok(checked > 10_000, `${checked} points`)
  },
)
