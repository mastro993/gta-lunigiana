// Lightning on Lunigiana with its north-east tiles unlisted and an L outline (`notchMap`): bolts
// strike only the play area, the L.
import "../../map/__tests__/use-notch.ts"
import assert from "node:assert/strict"
import { test } from "node:test"

import { Random } from "@typeonce/ritmo-math"

import { inPlay } from "../../map/index.ts"
import { screenAxes } from "../../view.ts"
import { initialWeather, setWeather, stormStep } from "../weather.ts"

test("an L: by the notch, bolts strike only the play area", () => {
  const t = 1792648800 // 2026-10-22, 10:00 in Rome
  for (const [x, y] of [
    [1700, 800],
    [3000, -300],
  ] as const) {
    const witness = { x, y, ...screenAxes(0) }
    let bolts = 0
    for (const seed of [1, 2, 3, 4]) {
      const random = Random.make(seed)
      let w = setWeather(initialWeather(t, 1), { regime: "storm", settle: true }, t)!
      for (let step = 0; step < 60 * 180; step++) {
        const out = stormStep(w, witness, 1 / 60, step, random)
        w = out.weather
        if (out.lightning?.bolt !== true) continue
        bolts++
        assert.ok(
          inPlay(out.lightning.x, out.lightning.y),
          `a bolt at ${out.lightning.x}, ${out.lightning.y}`,
        )
      }
    }
    assert.ok(bolts > 20, `(${x}, ${y}): ${bolts} bolts`)
  }
})
