import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { test } from "node:test"

import { builtMapUrl, loadBuiltMap, readWholeMap } from "../../tools/map-file.ts"
import { regionFromArgs } from "../../tools/region.ts"

// Map check (pnpm test:map) on every road bridge of the L test region (issue #87), which `pnpm maps` builds into test-maps/:
// this process loads it before anything decodes the map. Without the build it is skipped, but in CI, which builds it, a
// missing build fails.
const REGION = regionFromArgs(["--region", "lunigiana-l"])
const URL_L = builtMapUrl(REGION)
const skip = existsSync(URL_L)
  ? false
  : `no ${REGION.key} build in test-maps: run node src/tools/build-map.ts --region ${REGION.key}`
// GitHub Actions sets CI=true.
if (skip !== false && process.env.CI === "true") throw new Error(skip)
if (skip === false) await loadBuiltMap(REGION)
const checks = skip === false ? await import("./under-decks.ts") : undefined

test(
  "under decks: on the L a walker or a car with room under a road deck never comes up onto it, and its ends still lead onto it on foot, verges included, and by car",
  { skip },
  () => {
    const map = readWholeMap(URL_L)
    const climbs = checks!.deckClimbs(map)
    assert.deepEqual(
      climbs,
      [],
      `${climbs.length} road decks are climbed from under:\n${climbs.join("\n")}`,
    )
    const shut = checks!.deckEndsShut(map)
    assert.deepEqual(shut, [], `${shut.length} deck ends are walled off:\n${shut.join("\n")}`)
  },
)
