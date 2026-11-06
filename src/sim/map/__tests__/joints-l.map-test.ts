import { existsSync } from "node:fs"
import { test } from "node:test"

import { builtMapUrl, loadBuiltMap } from "../../../tools/map-file.ts"
import { regionFromArgs } from "../../../tools/region.ts"

// Map check (pnpm test:map), on the L test region (`lunigiana-l`). This process loads the L from
// test-maps/ (`pnpm maps` builds it); without the build the check is skipped, but in CI, which
// builds it, a missing build fails.
const REGION = regionFromArgs(["--region", "lunigiana-l"])
const skip = existsSync(builtMapUrl(REGION))
  ? false
  : `no ${REGION.key} build in test-maps: run node src/tools/build-map.ts --region ${REGION.key}`
// GitHub Actions sets CI=true.
if (skip !== false && process.env.CI === "true") throw new Error(skip)
if (skip === false) await loadBuiltMap(REGION)
const checks = skip === false ? await import("./joint-checks.ts") : undefined

test(
  "joints: on the L, a driver coming onto or off a bridge or a tunnel reads a car standing in its lane past the joint on its level",
  { skip },
  () => {
    checks!.assertJoints([], 5_000)
  },
)
