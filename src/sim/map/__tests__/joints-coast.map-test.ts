import { test } from "node:test"

import { skipUnbuilt, TEST_MAPS } from "../../../tools/__tests__/test-maps.ts"
import { useDiskMap } from "../source.ts"

// Map check (pnpm test:map), on the coast test region (`magra-coast`). This process loads it from
// test-maps/ (`pnpm maps` builds it); without the build the check is skipped, but in CI, which
// builds it, a missing build fails.
const [NAME, URL_COAST] = TEST_MAPS.find(([name]) => name === "the coast")!
const skip = skipUnbuilt(NAME, URL_COAST)
if (skip === false) useDiskMap(URL_COAST)
const checks = skip === false ? await import("./joint-checks.ts") : undefined

test(
  "joints: on the coast, a driver coming onto or off a bridge or a tunnel reads a car standing in its lane past the joint on its level",
  { skip },
  () => {
    checks!.assertJoints([], 5_000)
  },
)
