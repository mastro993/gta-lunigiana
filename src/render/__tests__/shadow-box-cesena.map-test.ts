import "../../sim/map/__tests__/use-cesena.ts"
import { test } from "node:test"

import { assertTurn, framesAt, shapedSpots, wholeTurn } from "./shadow-turns.ts"

// Map check (pnpm test:map), on Cesena: this process picks it on its first line
// (shadow-box.map-test.ts turns the view on Lunigiana's ground), so the spots found by the terrain's
// shape are another region's, its plain and its hills. Measured: 2–8 changes a turn (86–272 when the
// box followed each frame's fit), on consecutive frames at most once.

test("Cesena: at its steepest fall, deepest gully and flattest ground the shadow box changes size a few times a turn, never strobing", () => {
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
