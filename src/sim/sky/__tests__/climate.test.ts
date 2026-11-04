import assert from "node:assert/strict"
import { test } from "node:test"

import { DAY, daysFromCivil, utcFromRome } from "../calendar.ts"
import {
  type Air,
  airAt,
  celsiusAt,
  freezingLevel,
  dailyMean,
  NO_SNOW,
  normalsAt,
  orographic,
  rainCooling,
  seasonSnowLine,
  snowShare,
} from "../climate.ts"
import { place, REFERENCE_PLACE } from "../place.ts"

/** UTC second of `year`-`month`-`day` `hour`:00 UTC. */
const utc = (year: number, month: number, day: number, hour = 0) =>
  daysFromCivil(year, month, day) * DAY + hour * 3600
/** The middle of `month` (1–12) of 2026, UTC: where the monthly normals hold exactly. */
const middle = (month: number) => {
  const first = daysFromCivil(2026, month, 1),
    next = month === 12 ? daysFromCivil(2027, 1, 1) : daysFromCivil(2026, month + 1, 1)
  return (first + (next - first) / 2) * DAY
}

// The national normals (ISPRA SCIA 1991–2020): the sea-level means at the five band latitudes, the monthly lapse rates and the daily
// range's fit, as generic-climate.md §1.1–1.2 give them; January, April, July and October.
const SEA_LEVEL = [
  [38.13, [11.3, 15.8, 26.7, 20.3]],
  [40.08, [10.1, 15.5, 26.9, 19.2]],
  [41.87, [8.8, 14.8, 26.0, 18.0]],
  [43.87, [6.4, 14.0, 25.0, 16.2]],
  [45.58, [3.9, 13.7, 24.3, 14.6]],
] as const
const LAPSE = [4.03, 5.67, 5.81, 5.03]
const RANGE = [
  [7.16, 0.25, -0.36],
  [9.68, 0.36, -1.07],
  [11.12, 0.34, -0.87],
  [8.69, 0.2, -0.85],
] as const

test("temperature: mid-month normals give back the national table: the sea-level mean at each band latitude, held beyond them, the month's lapse rate and the daily range's fit", () => {
  for (const [k, month] of [1, 4, 7, 10].entries()) {
    for (const [lat, means] of SEA_LEVEL) {
      const normals = normalsAt(middle(month), lat)
      assert.ok(
        Math.abs(normals.sea - means[k]!) < 1e-9 && Math.abs(normals.lapse - LAPSE[k]!) < 1e-9,
        `${month} at ${lat} N: ${JSON.stringify(normals)}`,
      )
      const [at42, perDegree, perKm] = RANGE[k]!
      assert.ok(
        Math.abs(normals.range - (at42 + perDegree * (lat - 42))) < 1e-9 &&
          Math.abs(normals.rangePerKm - perKm) < 1e-9,
        `${month} at ${lat} N: range`,
      )
    }
    assert.equal(
      normalsAt(middle(month), 36.6).sea,
      normalsAt(middle(month), 38.13).sea,
      "held south of the southernmost band",
    )
    assert.equal(
      normalsAt(middle(month), 47).sea,
      normalsAt(middle(month), 45.58).sea,
      "held north of the northernmost",
    )
  }
  // Halfway between two bands, halfway between their means; at 1000 m a daily mean one lapse rate lower and a narrower range.
  const between = normalsAt(middle(1), (41.87 + 43.87) / 2)
  assert.ok(Math.abs(between.sea - 7.6) < 1e-9)
  const january = { normals: normalsAt(middle(1), 42), swing: 0, anomaly: 0 } satisfies Air
  assert.ok(Math.abs(celsiusAt(january, 0) - celsiusAt(january, 1000) - 4.03) < 1e-9)
  assert.ok(
    Math.abs(
      celsiusAt({ ...january, swing: 0.5 }, 1000) - celsiusAt(january, 1000) - (7.16 - 0.36) / 2,
    ) < 1e-9,
  )
})

test("temperature: the day is coldest at sunrise and warmest at 14:30 solar time, and a clear calm day swings wider than an overcast one", () => {
  // No map is loaded: the sky's place is the reference site, 10.13° E.
  assert.deepEqual(place(), REFERENCE_PLACE)
  const day = utc(2026, 10, 22),
    clearCalm = { cloud: 0, wind: 0, anomaly: 0 }
  let coldest = { t: 0, v: 1 },
    warmest = { t: 0, v: -1 }
  for (let t = day; t < day + DAY; t += 60) {
    const v = airAt(t, clearCalm).swing
    if (v < coldest.v) coldest = { t, v }
    if (v > warmest.v) warmest = { t, v }
  }
  // USNO: sunrise 05:43 UTC; 14:30 local solar time at 10.13° E is 13:50 UTC less the equation of time (15.6 min). The swing runs as
  // far below the daily mean at the one as above it at the other.
  assert.ok(
    Math.abs(coldest.t - (day + 5 * 3600 + 43 * 60)) <= 120 &&
      Math.abs(coldest.v + warmest.v) < 1e-3,
    `coldest ${(coldest.t - day) / 3600} h`,
  )
  assert.ok(
    Math.abs(warmest.t - (day + 13 * 3600 + 34 * 60)) <= 120,
    `warmest ${(warmest.t - day) / 3600} h`,
  )
  const swing = (cloud: number, wind: number) => {
    const at = (hour: number) =>
      celsiusAt(airAt(day + hour * 3600, { cloud, wind, anomaly: 0 }), 250)
    return at(13.5) - at(5.7)
  }
  assert.ok(
    swing(0, 0) > swing(0, 8) && swing(0, 8) > swing(1, 3) * 2,
    `${swing(0, 0)}, ${swing(0, 8)}, ${swing(1, 3)} °C`,
  )
})

test("temperature: a clear October evening on low ground cools fast after sunset, then slowly toward the minimum at sunrise, with no jump; cloud and wind flatten the night's fall", () => {
  // 22 October 2026 at the reference site, 209 m (the Monzone spawn): sunrise 07:42 and sunset 18:24 in Rome.
  const day = utcFromRome(daysFromCivil(2026, 10, 22) * DAY),
    sun = {
      rise: utcFromRome(daysFromCivil(2026, 10, 22) * DAY + 7 * 3600 + 42 * 60),
      set: utcFromRome(daysFromCivil(2026, 10, 22) * DAY + 18 * 3600 + 24 * 60),
    }
  const at = (t: number, cloud: number, wind: number) =>
    celsiusAt(airAt(t, { cloud, wind, anomaly: 0 }), 209)
  let max = -Infinity,
    min = Infinity,
    jump = 0
  for (let t = day; t < day + DAY; t += 10) {
    const c = at(t, 0, 2)
    max = Math.max(max, c)
    min = Math.min(min, c)
    jump = Math.max(jump, Math.abs(at(t + 10, 0, 2) - c))
  }
  assert.ok(jump < 0.02, `the steepest 10 s change is ${jump} °C`)
  // The national normals: 13.9 °C mean on 22 October at 209 m and an 8.7 °C range over every sky, half as wide again clear and nearly calm.
  const evening = at(day + 21 * 3600, 0, 2)
  assert.ok(
    max > 20 && max < 21 && min > 6.9 && min < 7.9,
    `the day's max ${max} °C and min ${min} °C`,
  )
  assert.ok(
    evening > 12.2 && evening < 13.2,
    `21:00 at ${evening} °C, the afternoon's max ${max} °C`,
  )
  assert.ok(
    at(day + DAY, 0, 2) - min > 1.5 && at(sun.rise - 3600, 0, 2) - min < 0.3,
    "at midnight still above the minimum, the hour before sunrise just over it",
  )
  // The share of the night's fall gone by 21:00, from sunset to the next sunrise's minimum.
  const gone = (cloud: number, wind: number) => {
    const sunset = at(sun.set, cloud, wind),
      sunrise = at(sun.rise + DAY, cloud, wind)
    return (sunset - at(day + 21 * 3600, cloud, wind)) / (sunset - sunrise)
  }
  assert.ok(
    gone(0, 2) > gone(0, 8) && gone(0, 8) > gone(1, 3) + 0.15,
    `${gone(0, 2)}, ${gone(0, 8)}, ${gone(1, 3)}`,
  )
})

test("precipitation: rain above 1.5 °C, snow below 0.5 °C, half and half at 1.0 °C; the freezing level is where the air is at 1.0 °C; more falls higher up; falling rain cools the air", () => {
  assert.deepEqual(
    [snowShare(2), snowShare(1.5), snowShare(1), snowShare(0.5), snowShare(-3)],
    [0, 0, 0.5, 1, 1],
  )
  for (const lat of [38, 44.16, 46]) {
    for (const [month, swing, anomaly] of [
      [1, 0, 0],
      [1, -0.5, -2],
      [7, 0.575, 0],
      [7, 0.2, 8],
      [4, -0.2, 2],
      [12, 0, -7],
    ] as const) {
      const air = { normals: normalsAt(utc(2026, month, 15, 12), lat), swing, anomaly },
        level = freezingLevel(air)
      assert.ok(
        Math.abs(celsiusAt(air, level) - 1) < 1e-9,
        `${lat} N, ${month}, ${anomaly} °C: ${level} m`,
      )
    }
  }
  // Kept from 1000 m below sea level, where a deep frost would put it, to above any summer's.
  const frost = { normals: normalsAt(utc(2026, 12, 15, 12), 46), swing: 0, anomaly: -15 }
  assert.ok(freezingLevel(frost) === -1000 && celsiusAt(frost, -1000) < 1)
  // Far above any summit the range holds at its floor and the level is still exact.
  const hot = airAt(utc(2026, 7, 15, 13), { cloud: 0, wind: 0, anomaly: 14 })
  assert.ok(
    freezingLevel(hot) > 6000 && Math.abs(celsiusAt(hot, freezingLevel(hot)) - 1) < 1e-9,
    `${freezingLevel(hot)} m`,
  )
  // 0.6 more a km from sea level, held at 2 from about 1670 m (a national design value).
  assert.deepEqual(
    [orographic(-50), orographic(0), orographic(1000), orographic(5000)],
    [1, 1, 1.6, 2],
  )
  const cooling = [
    rainCooling(0),
    rainCooling(0.03),
    rainCooling(1),
    rainCooling(5),
    rainCooling(20),
  ]
  assert.ok(
    [0, 0, 1.8, 3, 3.5].every((c, k) => Math.abs(cooling[k]! - c) < 1e-12),
    `${cooling}`,
  )
})

test("the season's snow line: MODIS's over Lunigiana at mid-month where it was measured, straight between, moved with the 0 °C line elsewhere; none in summer", () => {
  // Level ground, m a.s.l., January to December (the source's half-months averaged; NO_SNOW from June to September).
  const MODIS = [926, 1333, 1407, 1870, 2600, NO_SNOW, NO_SNOW, NO_SNOW, NO_SNOW, 2400, 1357, 859]
  MODIS.forEach((line, k) =>
    assert.ok(Math.abs(seasonSnowLine(middle(k + 1), 44.24) - line) < 1e-9, `month ${k + 1}`),
  )
  // Early November's 1601 m on the 8th, late November's 1113 m on the 23rd, early April's 1762 m on the 8th: within the halves.
  assert.ok(Math.abs(seasonSnowLine(utc(2026, 11, 8, 12), 44.24) - 1601) < 40)
  assert.ok(Math.abs(seasonSnowLine(utc(2026, 11, 23, 12), 44.24) - 1113) < 150)
  assert.ok(Math.abs(seasonSnowLine(utc(2026, 4, 8, 12), 44.24) - 1762) < 20)
  // Another latitude moves it as far as the 0 °C line: Sicily's (38 N) stands about 1.3 km higher in January.
  const zero = (t: number, lat: number) =>
    (1000 * dailyMean(normalsAt(t, lat), 0)) / normalsAt(t, lat).lapse
  for (const t of [middle(1), utc(2026, 3, 3, 9), utc(2026, 11, 20, 18)])
    for (const lat of [38, 42, 44.16, 46])
      assert.ok(
        Math.abs(
          seasonSnowLine(t, lat) - seasonSnowLine(t, 44.24) - (zero(t, lat) - zero(t, 44.24)),
        ) < 1e-9,
      )
  const sicily = seasonSnowLine(middle(1), 38) - seasonSnowLine(middle(1), 44.24)
  assert.ok(sicily > 1200 && sicily < 1500, `${sicily} m`)
  // The map's own latitude defaults; the summer lays none on any Italian summit (4808 m).
  assert.equal(seasonSnowLine(middle(2)), seasonSnowLine(middle(2), place().lat))
  for (const month of [6, 7, 8, 9]) assert.ok(seasonSnowLine(middle(month), 38) > 4808)
})
