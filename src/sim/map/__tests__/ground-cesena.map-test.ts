import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { gunzipSync } from "node:zlib"

import { provideMap } from "../packed.ts"

// Map check (pnpm test:map), on Cesena: this process loads it before anything decodes the map
// (ground.map-test.ts checks Lunigiana). Its rivers' reaches run up to 386 m.
provideMap(gunzipSync(readFileSync(new URL("../cesena.bin", import.meta.url))))
const { wholeMap } = await import("../../../tools/map-file.ts")
const { assertGroundAsBefore } = await import("./ground-checks.ts")

test("Cesena: the ground, the surface and the water read from the tiles answer as the whole map's broad phases did, to the bit", () => {
  const checked = assertGroundAsBefore(wholeMap("cesena"), 64)
  assert.ok(checked > 10_000, `${checked} points`)
})
