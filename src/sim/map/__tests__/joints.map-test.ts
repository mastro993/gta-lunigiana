import { test } from "node:test"

import { assertJoints } from "./joint-checks.ts"

// Map check (pnpm test:map), on Lunigiana (joints-cesena.map-test.ts and joints-l.map-test.ts check
// the others, each in its own process). Pieve San Lorenzo's underpass under the station (756577583)
// meets the road out of one mouth, 1191727402, 0.9 m under it, the road climbing to 2 m over its
// floor 2 m on (docs/map.md, "Known data limitations"): a driver in the underpass reads a car just
// past the mouth off its level.
test("joints: on Lunigiana, a driver coming onto or off a bridge or a tunnel reads a car standing in its lane past the joint on its level", () => {
  assertJoints([[756577583, 1191727402]], 50_000)
})
