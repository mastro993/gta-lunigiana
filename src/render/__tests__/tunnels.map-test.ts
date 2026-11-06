import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeVectors } from "./chunk-cut.ts"
import { checkTunnels } from "./tunnel-checks.ts"

// Map check (pnpm test:map): every road tunnel of Lunigiana; tunnels-cesena.map-test.ts and
// tunnels-l.map-test.ts check the other built regions', tunnels.test.ts three of Lunigiana's.
test("Lunigiana: every road in a tunnel drawn at its floor, its bore under the hill, a portal at every mouth the hill stands over, its chunks as a whole-map build cuts them", () => {
  assert.deepEqual(checkTunnels(wholeVectors()), {
    tunnels: 35,
    passages: 21,
    metres: 967,
    mouths: 28,
    portals: 14,
  })
})
