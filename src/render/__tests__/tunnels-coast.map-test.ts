import assert from "node:assert/strict"
import { test } from "node:test"

import { useDiskMap } from "../../sim/map/source.ts"
import { skipUnbuilt, TEST_MAPS } from "../../tools/__tests__/test-maps.ts"

// Map check (pnpm test:map), on the coast test region (`magra-coast`): this process loads it from
// test-maps/ (`pnpm maps` builds it); without the build the check is skipped, but in CI, which
// builds it, a missing build fails. Its underpass under the A12 by the east edge has a head wall at
// its north mouth and none at its south one, where the road out turns 43° and climbs across the
// wall's side ("crowded"); the footway under Via Togliatti at Luni lies under ground too low for
// one at both ends.
const [NAME, URL_COAST] = TEST_MAPS.find(([name]) => name === "the coast")!
const skip = skipUnbuilt(NAME, URL_COAST)
if (skip === false) useDiskMap(URL_COAST)
const chunkCut = skip === false ? await import("./chunk-cut.ts") : undefined
const checks = skip === false ? await import("./tunnel-checks.ts") : undefined

test(
  "the coast: every road in a tunnel drawn at its floor, its bore under the hill along both sides, a portal or a head wall clear of every other road at every mouth the hill stands over, else a reason by geometry for none, its chunks as a whole-map build cuts them",
  { skip },
  () => {
    assert.deepEqual(checks!.checkTunnels(chunkCut!.wholeVectors()), {
      tunnels: 6,
      passages: 4,
      metres: 83,
      walls: 225,
      mouths: 4,
      portals: 0,
      heads: 1,
      buried: 0,
      housed: 0,
      low: 2,
      crowded: 1,
    })
  },
)
