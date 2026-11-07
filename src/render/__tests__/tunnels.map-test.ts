import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeVectors } from "./chunk-cut.ts"
import { checkTunnels } from "./tunnel-checks.ts"

// Map check (pnpm test:map): every road tunnel of Lunigiana; tunnels-cesena.map-test.ts and
// tunnels-l.map-test.ts check the other built regions', tunnels.test.ts four of Lunigiana's.
test("Lunigiana: every road in a tunnel drawn at its floor, its bore under the hill along both sides, a portal or a head wall clear of every other road at every mouth the hill stands over, else a reason by geometry for none, its chunks as a whole-map build cuts them", () => {
  assert.deepEqual(checkTunnels(wholeVectors()), {
    tunnels: 35,
    passages: 21,
    metres: 967,
    walls: 3166,
    mouths: 28,
    portals: 12,
    heads: 2,
    housed: 1,
    low: 13,
    crowded: 0,
  })
})
