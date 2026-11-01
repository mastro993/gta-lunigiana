import assert from "node:assert/strict"
import { test } from "node:test"

import type { PlanValue } from "../../schema.ts"
import { civilFromDays, DAY, daysFromCivil, utcFromRome } from "../calendar.ts"
import { oddsAt, WET_PERSISTENCE } from "../odds.ts"
import { providePlace, REFERENCE_PLACE } from "../place.ts"
import { regimeAt } from "../plan.ts"
import { type Regime, REGIME_SPECS } from "../regimes.ts"
import { HOUR, PLACES, plans } from "./plans.ts"

const DAYS_IN = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** How much of `plan`'s day counts in the Aeronautica Militare's way at 06 and 18 UTC, each half a day, as clear-ish or overcast. */
const sky = (plan: PlanValue, counts: (regime: Regime) => boolean) =>
  [6, 18].reduce(
    (sum, hour) => sum + (counts(regimeAt(plan, plan.day * DAY + hour * HOUR)) ? 0.5 : 0),
    0,
  )
/** 4/8 cloud or less; 7/8 or more, the sky seen (a stratus's fog is the fog row's). */
const clearish = (regime: Regime) => REGIME_SPECS[regime].cloud <= 4 / 8
const overcast = (regime: Regime) => regime !== "fog" && REGIME_SPECS[regime].cloud >= 7 / 8

// Statistics of the plans alone, 300 years at each latitude: every event's days a month come out as the national table (oddsAt), the
// skies counted at 06 and 18 UTC, and the chain's persistence as the design's p11, each within its slack or four standard errors of
// what 300 years can resolve, whichever is wider: some 300 checks would see one past three by chance.
test("plan: over 300 years at 38, 42 and 45.5 N the days a month of rain, heavy rain, rainstorms, thunder, fog, strong wind and overcast, the clear-ish share and p11 are the table's", () => {
  try {
    for (const where of PLACES) {
      providePlace(where)
      const list = plans(Math.round(300 * 365.25), 2026)
      const months = Array.from({ length: 12 }, () => ({
        days: 0,
        rain: 0,
        heavy: 0,
        rainstorm: 0,
        thunder: 0,
        fog: 0,
        windy: 0,
        overcast: 0,
        clear: 0,
        after: 0,
        again: 0,
      }))
      list.forEach((plan, k) => {
        const m = months[civilFromDays(plan.day).month - 1]!
        m.days++
        if (plan.wet) {
          m.rain++
          if (plan.intensity !== "ordinary") m.heavy++
          if (plan.intensity === "rainstorm") m.rainstorm++
          if (plan.event === "storm") m.thunder++
        }
        if (plan.fog !== "none") m.fog++
        if (plan.windyTo > 0) m.windy++
        m.overcast += sky(plan, overcast)
        m.clear += sky(plan, clearish)
        if (k > 0 && list[k - 1]!.wet) {
          m.after++
          if (plan.wet) m.again++
        }
      })
      let thunderYear = 0
      months.forEach((m, i) => {
        const odds = oddsAt(
            utcFromRome(daysFromCivil(2001, i + 1, 15) * DAY + 12 * HOUR),
            where.lat,
          ),
          per = DAYS_IN[i]! / m.days,
          label = `${where.lat} N, month ${i + 1}`
        // A month's days come in spells, which widens a binomial count's standard error by about half.
        const error = (chance: number) =>
          1.5 * DAYS_IN[i]! * Math.sqrt((chance * (1 - chance)) / m.days)
        const days = (count: number, chance: number, slack: number) =>
          assert.ok(
            Math.abs(count * per - chance * DAYS_IN[i]!) <= Math.max(slack, 4 * error(chance)),
            `${label}: ${count * per} days against ${chance * DAYS_IN[i]!}`,
          )
        days(m.rain, odds.rain, 0.6)
        days(m.heavy, odds.heavy, 0.3)
        days(m.rainstorm, odds.rainstorm, 0.2)
        days(m.thunder, odds.thunder, 0.35)
        days(m.fog, odds.fog, 0.6)
        days(m.windy, odds.windy, 0.25)
        days(m.overcast, odds.overcast, 0.6)
        assert.ok(
          Math.abs(m.clear / m.days - odds.clear) <= 0.025,
          `${label}: clear-ish ${m.clear / m.days} against ${odds.clear}`,
        )
        const p11 = m.again / m.after
        assert.ok(
          Math.abs(p11 - WET_PERSISTENCE[i]!) <=
            Math.max(0.04, 4 * Math.sqrt((p11 * (1 - p11)) / m.after)),
          `${label}: p11 ${p11} of ${m.after}`,
        )
        thunderYear += m.thunder * per
      })
      assert.ok(
        Math.abs(thunderYear - 40) <= 4,
        `${where.lat} N: ${thunderYear} thunder days a year`,
      )
    }
  } finally {
    providePlace(REFERENCE_PLACE)
  }
})
