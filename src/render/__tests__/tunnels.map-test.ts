import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeVectors } from "./chunk-cut.ts"
import { checkTunnels } from "./tunnel-checks.ts"

// Map check (pnpm test:map): every road tunnel of Lunigiana; tunnels-cesena.map-test.ts and
// tunnels-l.map-test.ts check the other built regions', tunnels.test.ts four of Lunigiana's.
test("Lunigiana: every road in a tunnel drawn at its floor, its bore under the hill along both sides, a portal or a head wall clear of every other road at every mouth the hill stands over, else a reason by geometry for none, its chunks as a whole-map build cuts them", () => {
  // Aulla's part brought 80 tunnels and 72 mouths; 5 open as crowded, 3 of them the Galleria
  // Barbarasco's, each of the A15's twin bores' faces standing on the other carriageway.
  assert.deepEqual(checkTunnels(wholeVectors()), {
    tunnels: 139,
    passages: 67,
    metres: 2875,
    walls: 8012,
    mouths: 128,
    portals: 23,
    heads: 3,
    buried: 0,
    housed: 30,
    low: 67,
    crowded: 5,
  })
})
