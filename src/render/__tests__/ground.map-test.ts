import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeMap } from "../../tools/map-file.ts"
import { assertBridgesCarry } from "./bridges.ts"

// Map check (pnpm test:map): every bridge of the map; ground.test.ts crosses those by Monzone.
// Sarzana's part's passes no rule keeps on their decks (issue #20; the user's choice, after three
// rounds of fixes, to list them as known limits): two ramps whose decks fork off the A12's and the
// SS1's at a shared vertex and leave their level while the carriageways still overlap, where the
// ground reads the flatter deck; two decks whose end a junction pinned at the ground before their
// clearance was fitted; and four dead-end stub decks no road leads onto in line, which the check
// sets out onto from the ground straight on. Each must still leave its deck, so a fix drops it.
const KNOWN = [
  "182148403 a -> b",
  "225715149 b -> a",
  "301036802 a -> b",
  "378584336 a -> b",
  "373319164 b -> a",
  "647881614 a -> b",
  "1196314490 a -> b",
  "1455968359 b -> a",
]

test("a car's wheels and a walker crossing every drivable bridge, both ways, from 12 m before it, stay on the deck", () => {
  const { roads } = wholeMap()
  const passes = assertBridgesCarry(roads, roads, KNOWN)
  assert.ok(passes >= 40, `${passes} passes`)
})
