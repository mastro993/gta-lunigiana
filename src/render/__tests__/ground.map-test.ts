import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeMap } from "../../tools/map-file.ts"
import { assertBridgesCarry } from "./bridges.ts"

// Map check (pnpm test:map): every bridge of the map; ground.test.ts crosses those by Monzone.
test("a car's wheels and a walker crossing every drivable bridge, both ways, from 12 m before it, stay on the deck", () => {
  const { roads } = wholeMap()
  const passes = assertBridgesCarry(roads, roads)
  assert.ok(passes >= 40, `${passes} passes`)
})
