// Map check (pnpm test:map) on every road and rail bridge's deck of each built region: Lunigiana,
// Cesena and the L test region, which `pnpm maps` builds into test-maps/. Without the L's build it
// is left out, but in CI, which builds it, a missing build fails: a skip there would pass with
// nothing checked.
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { test } from "node:test"

import { builtMapUrl, type JoinedMap, readWholeMap, wholeMap } from "../map-file.ts"
import { regionFromArgs } from "../region.ts"
import { deckShortfalls, mapDecks, meshOf } from "./decks.ts"

const L_URL = builtMapUrl(regionFromArgs(["--region", "lunigiana-l"]))

test("decks: the ground keeps out of every road and rail deck's slab between its end runs, and off the road along them, on Lunigiana, Cesena and the L", (t) => {
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
  const short = maps.flatMap(([name, map]) =>
    deckShortfalls(mapDecks(map), meshOf(map)).map((d) => `${name}: ${d}`),
  )
  const rail = short.filter((d) => d.includes("rail bridge")).length
  assert.deepEqual(
    short,
    [],
    `${short.length} decks (${short.length - rail} road, ${rail} rail) reach into the ground:\n${short.join("\n")}`,
  )
})
