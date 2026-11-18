// Map check (pnpm test:map) on every drivable bridge's parapets of each built region: Lunigiana,
// Cesena and the test regions `pnpm maps` builds into test-maps/, the L and the coast. Without a
// test region's build it is left out, but in CI, which builds it, a missing build fails: a skip
// there would pass with nothing checked.
import assert from "node:assert/strict"
import { test } from "node:test"

import { latticeGround, levelOn } from "../build-ground.ts"
import { type JoinedMap, readWholeMap, wholeMap } from "../map-file.ts"
import { parapetFaults } from "./parapets.ts"
import { builtTestMaps } from "./test-maps.ts"

test("parapets: a car on a deck meets its parapet wherever no road on the deck's level reaches it, and a car on any road meets no parapet in its way, on Lunigiana, Cesena, the L and the coast", (t) => {
  const maps: ReadonlyArray<readonly [string, JoinedMap]> = [
    ["Lunigiana", wholeMap()],
    ["Cesena", wholeMap("cesena")],
    ...builtTestMaps(t).map(([name, url]) => [name, readWholeMap(url)] as const),
  ]
  const faults = maps.flatMap(([name, map]) =>
    parapetFaults(
      map.roads,
      map.walls,
      levelOn(latticeGround(map.heightmap, (n) => map.heightmap.data[n]!, map.roads)),
    ).map((f) => `${name}: ${f}`),
  )
  assert.deepEqual(faults, [], `${faults.length} bridges' parapets fail:\n${faults.join("\n")}`)
})
