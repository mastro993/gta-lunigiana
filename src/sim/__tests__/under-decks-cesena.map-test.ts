import "../map/__tests__/use-cesena.ts"
import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeMap } from "../../tools/map-file.ts"
import { deckClimbs, deckEndsShut } from "./under-decks.ts"

// Map check (pnpm test:map) on every road bridge of Cesena (issue #87): this process picks it on its first line.

test("under decks: on Cesena a walker or a car with room under a road deck never comes up onto it, and its ends still lead onto it on foot, verges included, and by car", () => {
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
