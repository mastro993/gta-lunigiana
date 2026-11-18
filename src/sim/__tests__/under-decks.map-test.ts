import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeMap } from "../../tools/map-file.ts"
import { deckClimbs, deckEndsShut } from "./under-decks.ts"

// Map check (pnpm test:map) on every road bridge of Lunigiana (issue #87); under-decks-cesena.map-test.ts and
// under-decks-l.map-test.ts load the other regions.
test("under decks: on Lunigiana a walker or a car with room under a road deck never comes up onto it, and its ends still lead onto it on foot, verges included, and by car", () => {
  const map = wholeMap()
  const climbs = deckClimbs(map)
  assert.deepEqual(
    climbs,
    [],
    `${climbs.length} road decks are climbed from under:\n${climbs.join("\n")}`,
  )
  // A micro-mapped knot at (-16438, 5072): the 3.3 m steps bridge 717897184's end stands 3.1 m over
  // the ground the 3.1 m footway tunnel 717897178 under it cuts for its approaches 2 m away, and the
  // 0.7 m footway 1065384887 off the end drops into it.
  const known = ["steps bridge 717897184: its last end"]
  const shut = deckEndsShut(map)
  assert.deepEqual(
    shut.filter((s) => !known.some((k) => s.startsWith(k))),
    [],
    `${shut.length} deck ends are walled off:\n${shut.join("\n")}`,
  )
  for (const k of known)
    assert.ok(
      shut.some((s) => s.startsWith(k)),
      `${k} leads onto its deck now: drop it from the known ends`,
    )
})
