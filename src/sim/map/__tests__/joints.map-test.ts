import { test } from "node:test"

import { assertJoints } from "./joint-checks.ts"

// Map check (pnpm test:map), on Lunigiana (joints-cesena.map-test.ts and joints-l.map-test.ts check
// the others, each in its own process). Sarzana's part's three no rule clears (issue #20; the user's choice,
// after three rounds of fixes, to list them as known limits): the service road 378584357 crosses
// over Via Alta's bore at grade 2.5 m behind its south mouth, its carriageway over the approach's
// last 2 m, and the ground blends the two; the SS62 meets a junction pinned at the ground before
// its deck's clearance was fitted; and 1352409569 runs into its mouth beside the yard's tracks,
// whose core holds the cells under it at the rail's level.
test("joints: on Lunigiana, a driver coming onto or off a bridge or a tunnel reads a car standing in its lane past the joint on its level", () => {
  assertJoints(
    [
      [106907873, 107843275],
      [308956561, 301036802],
      [1352409569, 1352409570],
    ],
    50_000,
  )
})
