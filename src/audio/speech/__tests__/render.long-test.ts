import assert from "node:assert/strict"
import { test } from "node:test"

import { measure } from "../../measure.ts"
import { lineFor } from "../lines.ts"
import { lineSeconds } from "../plan.ts"
import { renderSpeech } from "../render.ts"
import { seeded } from "../testing.ts"
import { RATE, rms, SITUATIONS, SPEAKERS } from "./speakers.ts"

test("every line renders clean: peak ≈ 0.5, no NaN, starting silent and ringing out to silence, as long as lineSeconds", () => {
  const random = seeded(1)
  for (const situation of SITUATIONS)
    for (const speaker of SPEAKERS)
      for (const loud of [false, true]) {
        const l = lineFor(situation, random),
          out = renderSpeech({ speaker, line: l }, loud, RATE, random),
          m = measure([out], RATE)
        assert.ok(!m.nan, l.text)
        assert.ok(m.peak >= 0.4 && m.peak <= 0.6, `${l.text}: peak ${m.peak}`)
        assert.ok(Math.abs(out.length / RATE - lineSeconds(l, speaker, loud)) < 0.001, l.text)
        // The tract rings into the trailing pad (≈ −66 dB re the peak 10 ms from the end), the fade takes the rest.
        assert.ok(
          rms(out.subarray(0, RATE * 0.01)) < 1e-3 && rms(out.subarray(-RATE * 0.005)) < 1e-3,
          `${l.text}: not silent at the ends`,
        )
      }
})
