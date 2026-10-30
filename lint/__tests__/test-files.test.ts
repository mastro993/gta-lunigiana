import assert from "node:assert/strict"
import { test } from "node:test"

import { misplacedTest } from "../test-files.ts"

test("a test belongs directly in a __tests__ folder; other files are not checked", () => {
  assert.equal(misplacedTest("/repo/src/sim/__tests__/walls.test.ts"), false)
  assert.equal(misplacedTest("/repo/src/sim/walls.test.ts"), true)
  assert.equal(misplacedTest("/repo/src/sim/__tests__/deep/walls.test.ts"), true)
  assert.equal(misplacedTest("/repo/src/sim/__tests__/helpers.ts"), false)
  assert.equal(misplacedTest("/repo/src/sim/walls.ts"), false)
})

test("a map check (`*.map-test.ts`, run by pnpm test:map) belongs directly in a __tests__ folder too", () => {
  assert.equal(misplacedTest("/repo/src/sim/map/__tests__/map.map-test.ts"), false)
  assert.equal(misplacedTest("/repo/src/sim/map/map.map-test.ts"), true)
  assert.equal(misplacedTest("/repo/src/sim/map/__tests__/deep/map.map-test.ts"), true)
})
