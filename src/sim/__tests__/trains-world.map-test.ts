import assert from "node:assert/strict"
import { test } from "node:test"

import { broughtOut, line } from "./railway.ts"

// Map checks (pnpm test:map): the whole of Monzone's line; trains-world.test.ts checks the line within 1.5 km of Monzone station.
test("trains: animals brought out anywhere along the line come out off its track at grade, 3 m or more off any centreline", () => {
  const { brought, on } = broughtOut(250, line.length, 250)
  assert.ok(brought > 200, `${brought} brought out`)
  assert.deepEqual(on, [])
})
