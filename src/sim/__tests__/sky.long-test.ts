import assert from "node:assert/strict"
import { test } from "node:test"

import { type PlanValue, SetClock, SetWeather } from "../index.ts"
import { jsonSave, start } from "../testing.ts"
import { FAR_AWAY } from "./spots.ts"

// Regression: the day plan drew from WeatherRng after the storm, whose draws follow where the player stands, so after a thunderstorm two
// games from one seed planned other days.
test("the weather seed alone plans the days: two games from one seed plan the same days, though their players stood apart in a storm", () => {
  /** A game from seed 1 with its player at `at`: a forced storm for half a real minute, handed back to the plan, then six game days. */
  const game = (at: { readonly x: number; readonly y: number; readonly angle: number }) => {
    const played = start([], [at])
    played.runtime.send(SetWeather, { regime: "storm", settle: true })
    played.run(60 * 30)
    played.runtime.send(SetWeather, { regime: null })
    played.runtime.send(SetClock, { rate: 3600 })
    const days: Array<PlanValue> = []
    played.run(24 * 6, () => {
      const { plan } = played.world().weather
      if (days.at(-1)?.day !== plan.day) days.push(plan)
    })
    return {
      days,
      lightning: played.heard.lightning,
      rng: jsonSave(played.runtime).resources["Lunigiana/WeatherRng"],
    }
  }
  const a = game(FAR_AWAY),
    b = game({ x: -412, y: 438, angle: 0 })
  assert.ok(
    a.lightning.length > 0 && b.lightning.length > 0 && a.rng !== b.rng,
    "the storms drew differently",
  )
  assert.ok(a.days.length >= 6)
  assert.deepEqual(b.days, a.days)
})
