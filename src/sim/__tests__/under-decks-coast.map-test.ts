import assert from "node:assert/strict"
import { test } from "node:test"

import { skipUnbuilt, TEST_MAPS } from "../../tools/__tests__/test-maps.ts"
import { readWholeMap } from "../../tools/map-file.ts"
import { useDiskMap } from "../map/source.ts"

// Map check (pnpm test:map) on every road bridge of the coast test region (`magra-coast`: its
// Magra and canal bridges, its footbridges over the A12 and its piers' decks), which `pnpm maps`
// builds into test-maps/: this process loads it before anything decodes the map. Without the build
// it is skipped, but in CI, which builds it, a missing build fails.
const [NAME, URL_COAST] = TEST_MAPS.find(([name]) => name === "the coast")!
const skip = skipUnbuilt(NAME, URL_COAST)
if (skip === false) useDiskMap(URL_COAST)
const checks = skip === false ? await import("./under-decks.ts") : undefined

test(
  "under decks: on the coast a walker or a car with room under a road deck never comes up onto it, and its ends still lead onto it on foot, verges included, and by car",
  { skip },
  () => {
    const map = readWholeMap(URL_COAST)
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
