import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { test } from "node:test"

import { builtMapUrl, loadBuiltMap, readWholeMap } from "../../../tools/map-file.ts"
import { regionFromArgs } from "../../../tools/region.ts"

// Map check (pnpm test:map), on the L test region (`lunigiana-l`), whose notch's two tiles are
// unlisted: a lookup there reads the vectors of the listed tiles round it, merged. This process
// loads the L from test-maps/ (`pnpm maps` builds it); without the build the check is skipped,
// but in CI, which builds it, a missing build fails.
const REGION = regionFromArgs(["--region", "lunigiana-l"])
const URL_L = builtMapUrl(REGION)
const skip = existsSync(URL_L)
  ? false
  : `no ${REGION.key} build in test-maps: run node src/tools/build-map.ts --region ${REGION.key}`
// GitHub Actions sets CI=true.
if (skip !== false && process.env.CI === "true") throw new Error(skip)
if (skip === false) await loadBuiltMap(REGION)
const checks = skip === false ? await import("./ground-checks.ts") : undefined

test(
  "the L: the ground, the surface and the water read from the tiles answer as the whole map's broad phases did, over the notch too",
  { skip },
  () => {
    const checked = checks!.assertGroundAsBefore(readWholeMap(URL_L), 65)
    assert.ok(checked > 10_000, `${checked} points`)
  },
)
