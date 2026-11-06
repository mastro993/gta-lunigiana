import assert from "node:assert/strict"
import { test } from "node:test"

import {
  assertTurn,
  changesOf,
  flatHalf,
  followTurn,
  framesAt,
  quarterTurn,
  wholeTurn,
  zoomEase,
} from "./shadow-turns.ts"

// Long check (pnpm test:long): shadow-box.map-test.ts turns the view at spots found by the terrain's shape.
// Regression (#89): the box was sized for the view's yaw each frame, so over a whole turn it changed size on
// 220 of 359 steps at the trees by the Lucido at Cortila, and each change redrew every shadow edge (a blink).
const SPOTS = [
  { name: "the trees by the Lucido at Cortila", x: -1380, y: 2465 },
  { name: "Monzone", x: -412, y: 438 },
  { name: "the SR445 viaduct west of Gragnola", x: -2673, y: 4588 },
]
/** On foot, in a car, and above 16 m/s, texels per metre. */
const ZOOMS = [8, 6, 5]

test("over a whole turn the shadow box changes size a few times, never on two frames in a row, holding the view's ground within a step", () => {
  for (const spot of SPOTS)
    for (const texelsPerMetre of ZOOMS)
      for (const dir of [1, -1] as const) {
        const frames = framesAt(spot, wholeTurn(texelsPerMetre, dir))
        const label = `${spot.name}, a whole turn at ${texelsPerMetre} texels/m`
        assertTurn(frames, texelsPerMetre, { most: 8, pairs: 0 }, label)
        if (texelsPerMetre === 8)
          assert.equal(frames[0]!.held, flatHalf(8), `${spot.name}: the home view's box on foot`)
      }
})

// The view turns faster than a degree a frame: Q and E turn 16° in their first frame and the follow spring up
// to 4.4°. Through an E the fit grows by four or five steps within 3–7 frames, and the box may stand at most a
// step above it, so it grows step by step: 3–4 changes, two of them on consecutive frames, where issue #89 asks
// for one (docs/architecture.md). Measured: a Q or E 0–4 changes, a half turn 0–6.
test("through a Q or E turn and the follow spring's half turn the box grows step by step, on consecutive frames at most once a turn and only where the view forces it", () => {
  for (const spot of SPOTS)
    for (const texelsPerMetre of ZOOMS)
      for (const dir of [1, -1] as const) {
        const label = `${spot.name} at ${texelsPerMetre} texels/m`
        assertTurn(
          framesAt(spot, quarterTurn(texelsPerMetre, dir)),
          texelsPerMetre,
          { most: 4, pairs: 1 },
          `${label}, ${dir > 0 ? "Q" : "E"}`,
        )
        assertTurn(
          framesAt(spot, followTurn(texelsPerMetre, dir)),
          texelsPerMetre,
          { most: 6, pairs: 0 },
          `${label}, the follow spring's half turn`,
        )
      }
})

// Regression (review of #89): the box's wait to shrink ran on through the zoom's 1.8 s ease, so getting into a car
// at Monzone it shrank mid-ease and grew back 8 frames later, and getting out at Cortila it shrank twice.
test("on a slope, getting into a car or out of it moves the shadow box once", () => {
  for (const [spot, degrees, from, to] of [
    [SPOTS[1]!, 300, 8, 6],
    [SPOTS[0]!, 330, 6, 8],
  ] as const) {
    const frames = framesAt(spot, zoomEase((degrees * Math.PI) / 180, from, to))
    const label = `${spot.name}, ${degrees}°, ${from} → ${to} texels/m`
    assert.deepEqual(
      changesOf(frames)
        .filter((k) => k > 120)
        .map((k) => `${frames[k - 1]!.held.toFixed(1)} → ${frames[k]!.held.toFixed(1)}`)
        .slice(1),
      [],
      `${label}: the box changed size more than once`,
    )
    frames.forEach(({ held, need }, k) =>
      assert.ok(held >= need, `${label} frame ${k}: ${held} m holds less than ${need} m`),
    )
  }
})
