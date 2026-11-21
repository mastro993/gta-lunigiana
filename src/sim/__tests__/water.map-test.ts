import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeMap } from "../../tools/map-file.ts"
import { assertVergesDry } from "./verges.ts"

// Map check (pnpm test:map): every bridge of the map; water.test.ts checks those by Monzone.
// Regression: the deck lookup skipped a bridge by its first vertex's height and read one 16 m bucket, putting verge walkers
// in the river.
// Sarzana's footbridge 93746068 (OSM: access=no, "chiuso", fenced, blocked at its entrances) runs
// 305 m straight from Via Aurelia's junction, which the rail's fit holds at 18.1 m, down to the
// south bank, and stands 0.11 m under the spate at (−17922.5, −2696.9): the path pass fits decks
// before the catchments give the spate's level (issue #20; the user's choice, after three rounds of
// fixes, to list it as a known limit). It must still flood, so a fix drops it from here.
test("bridges: every walker's verge over the water in a spate (0.6 m³/s per km²) is on the deck, on every bridge of the map", () => {
  const checked = assertVergesDry(wholeMap().roads, 0.6, [93746068])
  assert.ok(checked > 20, `${checked} verge points over deep water`)
})
