import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeMap } from "../../tools/map-file.ts"
import { deckClimbs, deckEndsShut } from "./under-decks.ts"

// Map check (pnpm test:map) on every road bridge of Lunigiana (issue #87); under-decks-cesena.map-test.ts and
// under-decks-l.map-test.ts load the other regions.
test("under decks: on Lunigiana a walker or a car with room under a road deck never comes up onto it, and its ends still lead onto it on foot, verges included, and by car", () => {
  const map = wholeMap()
  const climbs = deckClimbs(map)
  // Sarzana's road 491595994, 9.8 m wide on the survey's carriageways, runs beside the A15's viaduct
  // 156568131 at (−19607.5, −5037.8), its centreline 6.35 m off the deck's, outside its 5.7 m
  // half-width, so no clearance bound holds it; its carriageway overlaps the deck's edge by up to
  // 4.25 m, on terrain at the deck's level, and a walker or a car on it comes up onto the deck there
  // (issue #20; the user's choice, after three rounds of fixes, to list it as a known limit). It must
  // still climb, so a fix drops it from here.
  const climbing = (c: string) => c.startsWith("motorway bridge 156568131:")
  assert.deepEqual(
    climbs.filter((c) => !climbing(c)),
    [],
    `${climbs.length} road decks are climbed from under:\n${climbs.join("\n")}`,
  )
  assert.ok(climbs.some(climbing), "156568131 is no longer climbed: drop it from the known climbs")
  // A micro-mapped knot at (-16438, 5072): the 3.3 m steps bridge 717897184's end stands 3.1 m over
  // the ground the 3.1 m footway tunnel 717897178 under it cuts for its approaches 2 m away, and the
  // 0.7 m footway 1065384887 off the end drops into it. Two of Sarzana's short decks over ditches
  // (issue #20; the user's choice, after three rounds of fixes, to list them as known limits): the
  // right verge of residential 814776139 sinks 1.46 m under the 10.7 m bridge 262912001's top at
  // (−11882, −5592), short of the 2 m that would make it a ditch, and meets the wall under the deck
  // 4.3 m before its end; the left verge of service 1149354825 meets the 19 m bridge 1149354824's,
  // 0.6 m under its top, 5 m before its end at (−13108, −6415).
  const known = [
    "steps bridge 717897184: its last end",
    "residential bridge 262912001: its first end",
    "service bridge 1149354824: its first end",
  ]
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
