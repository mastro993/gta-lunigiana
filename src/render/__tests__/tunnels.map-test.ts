import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeVectors } from "./chunk-cut.ts"
import { checkTunnels } from "./tunnel-checks.ts"

// Map check (pnpm test:map): every road tunnel of Lunigiana; tunnels-cesena.map-test.ts and
// tunnels-l.map-test.ts check the other built regions', tunnels.test.ts four of Lunigiana's.
test("Lunigiana: every road in a tunnel drawn at its floor, its bore under the hill along both sides, a portal or a head wall clear of every other road at every mouth the hill stands over, else a reason by geometry for none, its chunks as a whole-map build cuts them", () => {
  assert.deepEqual(checkTunnels(wholeVectors()), {
    tunnels: 59,
    passages: 30,
    metres: 1186,
    walls: 3574,
    mouths: 56,
    portals: 12,
    heads: 2,
    housed: 14,
    low: 28,
    crowded: 0,
  })
})
