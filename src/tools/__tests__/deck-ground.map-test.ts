// Map check (pnpm test:map) on every road and rail bridge's deck of each built region: Lunigiana,
// Cesena and the test regions `pnpm maps` builds into test-maps/, the L and the coast. Without a
// test region's build it is left out, but in CI, which builds it, a missing build fails: a skip
// there would pass with nothing checked.
import assert from "node:assert/strict"
import { test } from "node:test"

import { type JoinedMap, readWholeMap, wholeMap } from "../map-file.ts"
import { deckShortfalls, mapDecks, meshOf } from "./decks.ts"
import { builtTestMaps } from "./test-maps.ts"

test("decks: the ground keeps out of every road and rail deck's slab more than 4 m in from its outer ends, and off the road nearer them, on Lunigiana, Cesena, the L and the coast", (t) => {
  const maps: ReadonlyArray<readonly [string, JoinedMap]> = [
    ["Lunigiana", wholeMap()],
    ["Cesena", wholeMap("cesena")],
    ...builtTestMaps(t).map(([name, url]) => [name, readWholeMap(url)] as const),
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
