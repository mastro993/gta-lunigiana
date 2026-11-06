import assert from "node:assert/strict"
import { test } from "node:test"

import { assertTurn, flatHalf, turnAt } from "./shadow-turns.ts"

// Long check (pnpm test:long): shadow-box.map-test.ts turns the view at spots found by the terrain's shape.
// Regression (#89): the box was sized for the view's yaw each frame, so over a whole turn it changed size on
// 220 of 359 steps at the trees by the Lucido at Cortila, and each change redrew every shadow edge (a blink).
const SPOTS = [
  { name: "the trees by the Lucido at Cortila", x: -1380, y: 2465 },
  { name: "Monzone", x: -412, y: 438 },
  { name: "the SR445 viaduct west of Gragnola", x: -2673, y: 4588 },
]

test("over a whole turn the shadow box changes size a few times, never on two frames in a row, holding the view's ground within a step", () => {
  for (const spot of SPOTS)
    for (const texelsPerMetre of [8, 6])
      for (const dir of [1, -1] as const) {
        const frames = turnAt(spot, texelsPerMetre, dir)
        assertTurn(frames, texelsPerMetre, 8, `${spot.name} at ${texelsPerMetre} texels/m`)
        if (texelsPerMetre === 8)
          assert.equal(frames[0]!.held, flatHalf(8), `${spot.name}: the home view's box on foot`)
      }
})
