import assert from "node:assert/strict"
import { test } from "node:test"

import type { PlanValue } from "../../schema.ts"
import { civilFromDays, DAY, daysFromCivil, romeDay } from "../calendar.ts"
import { AIR_MASS } from "../climate.ts"
import { oddsAt, WET_PERSISTENCE } from "../odds.ts"
import { providePlace, REFERENCE_PLACE } from "../place.ts"
import { calmPlan, planFor, rainingAt, regimeAt, untilChange } from "../plan.ts"
import { HOUR, midnight, PLACES, plans } from "./plans.ts"

/** How long Rome day `day` lasts, s. */
const lengthOf = (day: number) => midnight(day + 1) - midnight(day)
/** A plan for the day before `day`, drawn and dry: what a jump or the next midnight draws after. */
const dryBefore = (day: number): PlanValue => ({
  ...calmPlan(midnight(day - 1)),
  drawn: true,
  from: 0,
})

test("plan: a new game's holds clear and calm for 90 game minutes; the first step draws the day, its rain and wind starting after the calm", () => {
  const start = 1792648800,
    calm = calmPlan(start),
    { day, second } = romeDay(start)
  assert.deepEqual(
    [calm.drawn, calm.day, calm.from, calm.wet, calm.airMass],
    [false, day, second + 90 * 60, false, 0],
  )
  assert.equal(regimeAt(calm, start + 89 * 60), "clear")
  assert.equal(untilChange(calm, start + 180), 87 * 60)
  for (let seed = 0; seed < 300; seed++) {
    const plan = planFor(calm, start + 1, seed)
    assert.ok(plan.drawn && plan.day === day && plan.from === calm.from, `seed ${seed}`)
    assert.equal(regimeAt(plan, start + 89 * 60), "clear", `seed ${seed}: still calm`)
    assert.ok(
      !plan.wet || plan.start - 1.5 * HOUR >= plan.from,
      `seed ${seed}: the sky thickens only after the calm`,
    )
    assert.ok(plan.windyTo === 0 || plan.windyFrom >= plan.from, `seed ${seed}`)
    assert.notEqual(plan.fog, "morning", "the calm start's morning is past")
  }
})

test("plan: the same weather seed draws the same days, another seed others; a day drawn again after the same day before is the same", () => {
  assert.deepEqual(plans(400, 7), plans(400, 7))
  assert.notDeepEqual(plans(400, 7), plans(400, 8))
  const list = plans(400, 9)
  for (let k = 1; k < list.length; k++)
    assert.deepEqual(
      planFor(list[k - 1]!, midnight(list[k]!.day) + 7 * HOUR, 9),
      list[k],
      `day ${k}`,
    )
  assert.equal(
    planFor(list[399]!, midnight(list[399]!.day) + 5 * HOUR, 9),
    list[399],
    "the same day: the same plan",
  )
})

test("plan: a wet day rains in one window inside its day under an overcast sky, a summer thunderstorm in the afternoon out of a fair one; a dry day keeps its sky, its stratus till it lifts and its wind", () => {
  for (const plan of plans(3000, 11)) {
    const month = civilFromDays(plan.day).month - 1,
      length = lengthOf(plan.day),
      at = (second: number) => regimeAt(plan, midnight(plan.day) + second)
    if (plan.wet) {
      assert.ok(
        plan.start >= 0 && plan.end <= length && plan.end > plan.start,
        JSON.stringify(plan),
      )
      const total = (plan.precip * (plan.end - plan.start)) / HOUR
      const [low, high] = ({ ordinary: [1.5, 9], heavy: [11, 18.5], rainstorm: [22, 80] } as const)[
        plan.intensity
      ]
      assert.ok(
        total >= low - 1e-9 && total <= high + 1e-9 && plan.precip <= 15 + 1e-9,
        `${plan.intensity}: ${total} mm at ${plan.precip} mm/h`,
      )
      if (plan.event === "snow") assert.ok(month === 11 || month <= 2)
      if (plan.event === "storm" && month >= 2 && month <= 8) {
        assert.ok(
          plan.start >= 13 * HOUR && plan.start <= 18 * HOUR && plan.sky === "fair",
          JSON.stringify(plan),
        )
        assert.deepEqual(
          [
            at(plan.start - 1.5 * HOUR - 1),
            at(plan.start - 1),
            at(plan.start),
            at(plan.end - 1),
            at(plan.end),
          ],
          ["fair", "cloudy", "storm", "storm", "cloudy"],
        )
      } else {
        assert.equal(plan.sky, "overcast")
        assert.deepEqual([at(plan.start), at(plan.end - 1)], [plan.event, plan.event])
        assert.ok(
          (plan.start === 0 || at(plan.start - 1) === "overcast") &&
            (plan.end === length || at(plan.end) === "overcast"),
          JSON.stringify(plan),
        )
      }
    } else {
      assert.ok(["clear", "fair", "cloudy", "overcast"].includes(plan.sky) && plan.precip === 0)
      const clear = plan.sky === "clear" || plan.sky === "fair"
      if (plan.windyTo > 0)
        assert.ok(
          clear &&
            plan.fog === "none" &&
            plan.windyTo - plan.windyFrom >= 6 * HOUR &&
            plan.windyTo <= length &&
            at(plan.windyFrom) === "windy",
          JSON.stringify(plan),
        )
      if (plan.fog === "morning") assert.ok(clear)
      if (plan.fog === "stratus")
        assert.ok(
          !clear &&
            at(0) === "fog" &&
            (plan.lift === length || (plan.lift >= 10 * HOUR && plan.lift <= 14 * HOUR)),
          JSON.stringify(plan),
        )
      if (plan.fog === "stratus" && plan.lift === length) assert.ok(month >= 10 || month <= 1)
      assert.equal(
        at(15 * HOUR),
        plan.windyTo > 15 * HOUR && plan.windyFrom <= 15 * HOUR
          ? "windy"
          : plan.fog === "stratus" && plan.lift > 15 * HOUR
            ? "fog"
            : plan.sky,
      )
    }
  }
})

// Regression: every wet day's rain fell between 01:30 and 23:00, so no rain fell around midnight and every wet spell stopped there.
test("plan: rain falls at any hour, and on days of steady rain in a row about half the spells rain on through the midnight between them", () => {
  const list = plans(30 * 365, 5),
    hours = Array.from({ length: 24 }, () => 0)
  let wet = 0,
    pairs = 0,
    through = 0
  list.forEach((plan, k) => {
    if (!plan.wet) return
    wet++
    for (let hour = 0; hour < 24; hour++)
      hours[hour]! += rainingAt(plan, midnight(plan.day) + hour * HOUR + 1800) ? 1 : 0
    const next = list[k + 1]
    if (next === undefined || !next.wet || plan.event === "storm" || next.event === "storm") return
    pairs++
    through += plan.end === lengthOf(plan.day) && next.start === 0 ? 1 : 0
  })
  assert.ok(
    hours.every((n) => n / wet > 0.05),
    `the share of wet days raining at each hour: ${hours.map((n) => (n / wet).toFixed(2)).join(" ")}`,
  )
  assert.ok(
    pairs > 500 && Math.abs(through / pairs - 0.5) < 0.05,
    `${through} of ${pairs} pairs rain on through midnight`,
  )
})

test("plan: across a clock jump the chain runs on as many days, so a long jump forgets yesterday: wet at the month's odds, the air mass at its full spread", () => {
  providePlace(PLACES[1]!)
  try {
    const wet = { ...plans(1, 1)[0]!, drawn: true, wet: true, airMass: 6 }
    let wets = 0,
      sum = 0,
      squares = 0
    const n = 20000,
      day = daysFromCivil(2003, 1, 20)
    for (let seed = 0; seed < n; seed++) {
      const plan = planFor({ ...wet, day: day - 40 }, midnight(day), seed)
      wets += plan.wet ? 1 : 0
      sum += plan.airMass
      squares += plan.airMass ** 2
    }
    const f = oddsAt(midnight(day), 42).rain,
      spread = Math.sqrt(squares / n - (sum / n) ** 2)
    assert.ok(Math.abs(wets / n - f) < 0.015, `${wets / n} wet after 40 days, against ${f}`)
    assert.ok(
      Math.abs(sum / n) < 0.06 && Math.abs(spread - AIR_MASS.spread) < 0.06,
      `air mass ${sum / n} ± ${spread}`,
    )
    // The next day instead: wet again at the month's persistence, the air mass 0.8 of yesterday's.
    let again = 0,
      mass = 0
    for (let seed = 0; seed < n; seed++) {
      const plan = planFor({ ...wet, day: day - 1 }, midnight(day), seed)
      again += plan.wet ? 1 : 0
      mass += plan.airMass
    }
    assert.ok(
      Math.abs(again / n - WET_PERSISTENCE[0]) < 0.015 && Math.abs(mass / n - 0.8 * 6) < 0.05,
      `${again / n} wet, air mass ${mass / n}`,
    )
  } finally {
    providePlace(REFERENCE_PLACE)
  }
})

// Regression: a new game's first plan took its calm start for a dry yesterday with no air mass, so the first day was wet 0.19 of the
// time against October's 0.27, its air mass spread 1.5 °C against 2.5.
test("plan: a new game's first day, with no day known before it, is wet at the month's odds and its air mass at its full spread", () => {
  const start = 1792648800,
    n = 20000
  let wets = 0,
    sum = 0,
    squares = 0
  for (let seed = 0; seed < n; seed++) {
    const plan = planFor(calmPlan(start), start + 1, seed)
    wets += plan.wet ? 1 : 0
    sum += plan.airMass
    squares += plan.airMass ** 2
  }
  const f = oddsAt(start).rain,
    spread = Math.sqrt(squares / n - (sum / n) ** 2),
    error = Math.sqrt((f * (1 - f)) / n)
  assert.ok(Math.abs(wets / n - f) < 4 * error, `${wets / n} wet, against ${f}`)
  assert.ok(Math.abs(spread - AIR_MASS.spread) < 0.06, `air mass ± ${spread}`)
})

// Regression: a jump into another day planned it only from the jump's hour: the hours before it read Clear whatever the day's sky, and
// a jump late in the day was almost never wet (Jan at 42 N: 0.17 wet from 16:00, 0.01 from 20:00, against 0.25).
test("plan: a clock jump into another day draws the whole day, the same at whatever hour it lands, wet at the month's odds", () => {
  providePlace(PLACES[1]!)
  try {
    const day = daysFromCivil(2027, 1, 15),
      n = 4000
    let wets = 0
    for (let seed = 0; seed < n; seed++) {
      const whole = planFor(dryBefore(day), midnight(day), seed)
      for (const hour of [9, 16, 20])
        assert.deepEqual(
          planFor(dryBefore(day), midnight(day) + hour * HOUR, seed),
          whole,
          `seed ${seed}, a jump to ${hour}:00`,
        )
      assert.equal(whole.from, 0)
      wets += whole.wet ? 1 : 0
    }
    const f = oddsAt(midnight(day), 42).rain,
      p01 = (f * (1 - WET_PERSISTENCE[0])) / (1 - f),
      error = Math.sqrt((p01 * (1 - p01)) / n)
    assert.ok(
      Math.abs(wets / n - p01) < 4 * error,
      `${wets / n} wet after a dry day, against ${p01}`,
    )
  } finally {
    providePlace(REFERENCE_PLACE)
  }
})

// Regression: a plan's window was counted on the wall clock, so on the day summer time starts a window over 02:00 rained an hour less
// than drawn, and on the day it ends an hour more: a total could leave its class.
test("plan: on the days the clocks change a day's rain falls as long as drawn", () => {
  for (const [year, month, date, hours] of [
    [2027, 3, 28, 23],
    [2027, 10, 31, 25],
  ] as const) {
    // After a day of frontal rain (an overcast evening) the rain may start at midnight; the clocks change at 01:00 UTC.
    const day = daysFromCivil(year, month, date),
      yesterday = {
        ...dryBefore(day),
        wet: true,
        sky: "overcast",
        start: 10 * HOUR,
        end: 12 * HOUR,
        precip: 1,
      } as const
    const change = day * DAY + HOUR - midnight(day)
    assert.equal(lengthOf(day), hours * HOUR)
    let checked = 0
    for (let seed = 0; checked < 40 && seed < 20000; seed++) {
      const plan = planFor(yesterday, midnight(day), seed)
      if (!plan.wet || plan.start >= change || plan.end <= change) continue
      checked++
      let raining = 0
      for (let t = midnight(day); t < midnight(day + 1); t += 60)
        raining += rainingAt(plan, t) ? 60 : 0
      assert.ok(
        Math.abs(raining - (plan.end - plan.start)) <= 60,
        `${year}-${month}-${date}: ${raining} s of rain, against ${plan.end - plan.start}`,
      )
    }
    assert.ok(checked === 40, `${checked} windows over the switch`)
  }
})
