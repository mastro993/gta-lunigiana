import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { gunzipSync } from "node:zlib"

import { provideMap } from "../../sim/map/packed.ts"

// Map check (pnpm test:map), on Cesena: this process loads it before anything decodes the map
// (tunnels.map-test.ts checks Lunigiana). Its tunnels are the Secante's cut and cover under the
// city, underpasses under the railway and the arcades of the centre.
provideMap(gunzipSync(readFileSync(new URL("../../sim/map/cesena.bin", import.meta.url))))
const { wholeVectors } = await import("./chunk-cut.ts")
const { checkTunnels } = await import("./tunnel-checks.ts")

test("Cesena: every road in a tunnel drawn at its floor, its bore under the hill, a portal at every mouth the hill stands over, its chunks as a whole-map build cuts them", () => {
  assert.deepEqual(checkTunnels(wholeVectors()), {
    tunnels: 64,
    passages: 22,
    metres: 5264,
    mouths: 77,
    portals: 11,
  })
})
