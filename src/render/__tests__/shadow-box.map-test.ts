import { test } from "node:test"

import { assertTurn, shapedSpots, turnAt } from "./shadow-turns.ts"

// Map check (pnpm test:map): reads the whole map's coarse lattice for the spots; shadow-box.long-test.ts turns
// the view at the spots of issue #89. Found by the terrain's shape, they cover a new map part's or region's ground.
// Measured on Lunigiana: 4–16 changes a turn (127–189 when the box followed each frame's fit). Where a ray of
// the fit finds or loses a cliff's foot from one degree to the next, the fit itself jumps steps back and forth,
// and the box must follow it (never more than a step above it): only those changes may come two in a row.
test("at the steepest fall, the deepest gully and the flattest ground of the map the shadow box changes size a few times a turn, twice in a row only when the view forces it", () => {
  for (const spot of shapedSpots())
    for (const texelsPerMetre of [8, 6])
      for (const dir of [1, -1] as const)
        assertTurn(
          turnAt(spot, texelsPerMetre, dir),
          texelsPerMetre,
          20,
          `${spot.name} at (${spot.x}, ${spot.y}), ${texelsPerMetre} texels/m`,
          true,
        )
})
