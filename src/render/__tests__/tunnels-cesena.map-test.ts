import "../../sim/map/__tests__/use-cesena.ts"
import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeVectors } from "./chunk-cut.ts"
import { checkTunnels } from "./tunnel-checks.ts"

// Map check (pnpm test:map), on Cesena: this process picks it on its first line
// (tunnels.map-test.ts checks Lunigiana). Its tunnels are the Secante's cut and cover under the
// city, underpasses under the railway and the arcades of the centre.

test("Cesena: every road in a tunnel drawn at its floor, its bore under the hill along both sides, a portal or a head wall clear of every other road at every mouth the hill stands over, else a reason by geometry for none, its chunks as a whole-map build cuts them", () => {
  assert.deepEqual(checkTunnels(wholeVectors()), {
    tunnels: 64,
    passages: 22,
    metres: 5264,
    walls: 18267,
    // 70184534's end where 70184520 runs on through the bore is a junction, no mouth.
    mouths: 76,
    portals: 6,
    heads: 2,
    buried: 7,
    housed: 46,
    low: 13,
    crowded: 2,
  })
})
