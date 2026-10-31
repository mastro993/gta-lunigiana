import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { assertBridgesCarry } from "./bridges.ts"

// Map check (pnpm test:map): every bridge of the map; ground.test.ts crosses those by Monzone.
test("a car's wheels and a walker crossing every drivable bridge, both ways, from 12 m before it, stay on the deck", () => {
  const passes = assertBridgesCarry(MAP.roads)
  assert.ok(passes >= 40, `${passes} passes`)
})
