import "./use-cesena.ts"
import { test } from "node:test"

import { assertJoints } from "./joint-checks.ts"

// Map check (pnpm test:map), on Cesena: this process picks it on its first line
// (joints.map-test.ts checks Lunigiana).

test("joints: on Cesena, a driver coming onto or off a bridge or a tunnel reads a car standing in its lane past the joint on its level", () => {
  assertJoints([], 10_000)
})
