import { test } from "node:test"

import { assertTurn, framesAt, shapedSpots, wholeTurn } from "./shadow-turns.ts"

// Map check (pnpm test:map): reads the whole map's coarse lattice for the spots; shadow-box.long-test.ts turns
// the view at the spots of issue #89. Measured on Lunigiana: 4–14 changes a turn (127–189 when the box followed
// each frame's fit). A turn may change the box on consecutive frames once, as an E does, and only where the view
// forces the second (the fit left the box's window: the box may stand at most a step above it, and the drop
// lands on the fit's own step), and never back to the size it held two frames before, a strobe. These spots
// are found by the terrain's shape, not where the fit leaps most: at some spots of the play area the fit itself
// flips 50.2 ↔ 300 m from one degree to the next, and the box follows it (docs/architecture.md).
test("at the steepest fall, the deepest gully and the flattest ground of the map the shadow box changes size a few times a turn, never strobing", () => {
  for (const spot of shapedSpots())
    for (const texelsPerMetre of [8, 6])
      for (const dir of [1, -1] as const)
        assertTurn(
          framesAt(spot, wholeTurn(texelsPerMetre, dir)),
          texelsPerMetre,
          { most: 20, pairs: 1 },
          `${spot.name} at (${spot.x}, ${spot.y}), ${texelsPerMetre} texels/m`,
        )
})
