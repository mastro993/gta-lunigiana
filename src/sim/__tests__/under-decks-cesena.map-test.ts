import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP_URL, provideMap, readMapFile } from "../map/packed.ts"

// Map check (pnpm test:map) on every road bridge of Cesena (issue #87): this process loads it before anything decodes the map.
provideMap(readMapFile(new URL("cesena.bin", MAP_URL)))
const { wholeMap } = await import("../../tools/map-file.ts")
const { deckClimbs, deckEndsShut } = await import("./under-decks.ts")

test("under decks: on Cesena a walker with room to stand under a road deck never comes up onto it, and its ends still lead onto it on foot and by car", () => {
  const map = wholeMap("cesena")
  const climbs = deckClimbs(map)
  assert.deepEqual(
    climbs,
    [],
    `${climbs.length} road decks are climbed from under:\n${climbs.join("\n")}`,
  )
  const shut = deckEndsShut(map)
  assert.deepEqual(shut, [], `${shut.length} deck ends are walled off:\n${shut.join("\n")}`)
})
