import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { test } from "node:test"

import { useDiskMap } from "../../sim/map/source.ts"
import { builtMapUrl } from "../../tools/map-file.ts"
import { regionFromArgs } from "../../tools/region.ts"

// Map check (pnpm test:map), on the L test region (`lunigiana-l`): this process loads it from
// test-maps/ (`pnpm maps` builds it); without the build the check is skipped, but in CI, which
// builds it, a missing build fails.
const REGION = regionFromArgs(["--region", "lunigiana-l"])
const skip = existsSync(builtMapUrl(REGION))
  ? false
  : `no ${REGION.key} build in test-maps: run node src/tools/build-map.ts --region ${REGION.key}`
// GitHub Actions sets CI=true.
if (skip !== false && process.env.CI === "true") throw new Error(skip)
if (skip === false) useDiskMap(builtMapUrl(REGION))
const chunkCut = skip === false ? await import("./chunk-cut.ts") : undefined
const checks = skip === false ? await import("./tunnel-checks.ts") : undefined

test(
  "the L: every road in a tunnel drawn at its floor, its bore under the hill along both sides, a portal or a head wall clear of every other road at every mouth the hill stands over, else a reason by geometry for none, its chunks as a whole-map build cuts them",
  { skip },
  () => {
    assert.deepEqual(checks!.checkTunnels(chunkCut!.wholeVectors()), {
      tunnels: 7,
      passages: 1,
      metres: 194,
      walls: 650,
      mouths: 12,
      portals: 3,
      heads: 0,
      buried: 0,
      housed: 1,
      low: 8,
      crowded: 0,
    })
  },
)
