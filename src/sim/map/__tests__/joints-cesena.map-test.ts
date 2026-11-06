import { readFileSync } from "node:fs"
import { test } from "node:test"
import { gunzipSync } from "node:zlib"

import { provideMap } from "../packed.ts"

// Map check (pnpm test:map), on Cesena: this process loads it before anything decodes the map
// (joints.map-test.ts checks Lunigiana).
provideMap(gunzipSync(readFileSync(new URL("../cesena.bin", import.meta.url))))
const { assertJoints } = await import("./joint-checks.ts")

test("joints: on Cesena, a driver coming onto or off a bridge or a tunnel reads a car standing in its lane past the joint on its level", () => {
  assertJoints([], 10_000)
})
