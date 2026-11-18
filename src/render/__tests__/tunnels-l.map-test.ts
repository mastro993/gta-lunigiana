import assert from "node:assert/strict"
import { test } from "node:test"

import { useDiskMap } from "../../sim/map/source.ts"
import { skipUnbuilt, TEST_MAPS } from "../../tools/__tests__/test-maps.ts"

// Map check (pnpm test:map), on the L test region (`lunigiana-l`): this process loads it from
// test-maps/ (`pnpm maps` builds it); without the build the check is skipped, but in CI, which
// builds it, a missing build fails.
const [NAME, URL_L] = TEST_MAPS.find(([name]) => name === "the L")!
const skip = skipUnbuilt(NAME, URL_L)
if (skip === false) useDiskMap(URL_L)
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
      // The profiles' bounds across a crossing's carriageway and at a deck's ends (road-levels.ts),
      // and the motorways' grade fitted unrelaxed (ROAD_PASSES), moved the bores' bend samples:
      // +1 wall triangle.
      // Equi Terme's footway underpass 1133296350 now rises to its approach 1306844336 at 264.2 m (it
      // ended 1.7 m under it, at 262.9): 650 -> 654 wall triangles.
      walls: 654,
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
