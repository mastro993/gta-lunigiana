// Map check (pnpm test:map) on every drivable bridge's parapets of each built region: Lunigiana,
// Cesena and the L test region, which `pnpm maps` builds into test-maps/. Without the L's build it
// is left out, but in CI, which builds it, a missing build fails: a skip there would pass with
// nothing checked.
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { test } from "node:test"

import { builtMapUrl, type JoinedMap, readWholeMap, wholeMap } from "../map-file.ts"
import { regionFromArgs } from "../region.ts"
import { parapetFaults } from "./parapets.ts"

const L_URL = builtMapUrl(regionFromArgs(["--region", "lunigiana-l"]))

test("parapets: a car on a deck meets its parapet wherever no road on the deck's level reaches it, and a car on any road meets no parapet in its way, on Lunigiana, Cesena and the L", (t) => {
  // GitHub Actions sets CI=true.
  if (!existsSync(L_URL)) {
    assert.notEqual(process.env.CI, "true", "no lunigiana-l build in test-maps")
    t.diagnostic("no lunigiana-l build in test-maps: the L is not checked")
  }
  const maps: ReadonlyArray<readonly [string, JoinedMap]> = [
    ["Lunigiana", wholeMap()],
    ["Cesena", wholeMap("cesena")],
    ...(existsSync(L_URL) ? [["the L", readWholeMap(L_URL)] as const] : []),
  ]
  const faults = maps.flatMap(([name, map]) =>
    parapetFaults(map.roads, map.walls).map((f) => `${name}: ${f}`),
  )
  assert.deepEqual(faults, [], `${faults.length} bridges' parapets fail:\n${faults.join("\n")}`)
})
