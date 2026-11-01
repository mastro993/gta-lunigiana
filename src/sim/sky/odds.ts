/**
 * Italy's weather as odds: for each calendar month, the chance that a day brings rain, heavy rain, a
 * rainstorm, a thunderstorm, fog, a clear-ish or an overcast sky or a strong wind, from national
 * statistics, the ones that vary with latitude interpolated at the map's; and the chance of snowfall at a
 * height, from the temperature model. The weather's daily plan (plan.ts) draws from these same rows and
 * the dev menu shows them (`oddsAt`). Pure and map-free.
 *
 * @module odds
 */
import { Ops } from "@typeonce/ritmo-math"

import { civilFromDays, romeDay } from "./calendar.ts"
import {
  AIR_MASS,
  type Anchors,
  atLatitude,
  CLEAR_SHARE,
  dailyMean,
  DAYS_IN,
  HALF_SNOW,
  type Months,
  normalsAt,
  overcastChance,
  rainCooling,
  rainChance,
  rangeAt,
  WET_OFFSET,
} from "./climate.ts"
import { place } from "./place.ts"
import { REGIME_SPECS } from "./regimes.ts"

/**
 * The share of rain days bringing at least 10 mm (heavy rain) and at least 20 mm (a rainstorm): ISPRA's national medians over 577
 * stations, 1991–2020 (*I normali climatici 1991-2020*, Table 4), national constants (the latitudes differ by less than the sites).
 */
export const HEAVY_SHARE: Months = [
  0.28, 0.27, 0.31, 0.29, 0.3, 0.32, 0.31, 0.33, 0.38, 0.37, 0.39, 0.33,
]
/** See `HEAVY_SHARE`. */
export const RAINSTORM_SHARE: Months = [
  0.11, 0.1, 0.11, 0.1, 0.11, 0.12, 0.11, 0.15, 0.17, 0.17, 0.18, 0.12,
]
/** Thunderstorm days a year: 40, a design value (the user's choice; Europe's lowlands have 20–40, Morgenstern et al. 2023, CC BY 4.0). */
const THUNDER_YEAR = 40
/**
 * How the year's thunder falls over the months, by latitude: the Aeronautica Militare's share of observations with cumulonimbus,
 * 1973–2000, averaged over 31 lowland airports in four bands, placed at January, April, July and October and straight between
 * (as thunder days at 30 a year). The north's storms peak in July, the south's in October–January off the sea, as lightning shows
 * (Anderson and Klugmann 2014, CC BY 3.0).
 */
const THUNDER_SHAPE: Anchors = [
  [38.47, [2.6, 2.4, 2.2, 1.9, 1.7, 1.5, 1.3, 2.3, 3.2, 4.1, 3.6, 3.1]],
  [40.98, [1.8, 1.9, 2.0, 2.1, 2.2, 2.2, 2.3, 2.8, 3.3, 3.8, 3.1, 2.5]],
  [43.5, [1.0, 1.4, 1.9, 2.4, 2.8, 3.2, 3.6, 3.4, 3.2, 3.0, 2.3, 1.6]],
  [45.47, [0.1, 1.0, 1.9, 2.8, 3.7, 4.7, 5.6, 4.2, 2.9, 1.5, 1.0, 0.6]],
]
/** Days with fog (visibility under 1 km at an observation) a month: the Aeronautica Militare's lowland airports, 1971–2000, by band. */
const FOG_DAYS: Anchors = [
  [38.3, [0.9, 0.84, 0.9, 0.62, 1.08, 0.24, 0.3, 0.16, 0.22, 0.7, 0.7, 1.02]],
  [40.9, [4.01, 2.76, 3.1, 2.49, 2.27, 1.11, 0.84, 1.54, 2.0, 3.53, 3.41, 3.63]],
  [43.3, [5.34, 3.41, 2.4, 1.51, 1.29, 0.83, 0.43, 0.5, 1.0, 3.06, 4.24, 5.03]],
  [45.4, [14.42, 8.83, 4.31, 1.88, 0.97, 0.47, 0.33, 0.44, 1.97, 6.85, 10.53, 12.17]],
]
/**
 * The share of observations (%) with a wind over 20 knots: the mean of the Aeronautica Militare's four lowland groups, 1971–2000, one
 * national row, as exposure, not latitude, sets it (the Po plain is calm, the southern airports stand on windy coasts).
 */
const STRONG_WIND: Months = [3.05, 2.83, 2.94, 2.42, 1.14, 0.95, 0.75, 0.61, 0.86, 1.38, 2.18, 3.03]
/** A day with a strong wind for each share of observations: a one-day gale blows over 20 knots at about 2 of the 4 synoptic hours (a design value). */
const WINDY_DAY = 2
/**
 * The chance that a day is wet given that yesterday was (p11), a design value a month, national: about 0.5 from October to March,
 * 0.45 in spring and September, 0.4 in June and August and 0.3 in July (docs/weather.md, the climate sources record).
 */
export const WET_PERSISTENCE: Months = [
  0.5, 0.5, 0.5, 0.45, 0.45, 0.4, 0.3, 0.4, 0.45, 0.5, 0.5, 0.5,
]
/**
 * A cold outbreak: from December to March a wet day without thunder whose air mass runs this much below the normal (°C) or colder
 * comes as a cold front, the snow regime (design values).
 */
export const COLD_OUTBREAK = { months: [11, 0, 1, 2], below: -1.5 } as const
/**
 * How far the air under a full cover swings about its daily mean over the hours rain may fall: its standard deviation, as a share of
 * the day's range (the daily cycle under the full cover's share of it, 0.14–0.18 by month and latitude).
 */
const RAIN_SWING = 0.17

/** Rome's calendar month (0 January … 11 December) at UTC second `t`: the month a day's plan and its odds belong to. */
export const romeMonth = (t: number): number => civilFromDays(romeDay(t).day).month - 1

/** The standard normal distribution function: Abramowitz and Stegun's 7.1.26 for erf, within 1.5e-7. */
const normal = (x: number): number => {
  const z = Math.abs(x) / Math.SQRT2,
    k = 1 / (1 + 0.3275911 * z)
  const erf =
    1 -
    k *
      (0.254829592 +
        k * (-0.284496736 + k * (1.421413741 + k * (-1.453152027 + k * 1.061405429)))) *
      Ops.exp(-z * z)
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

/** A day's chances in one month at one latitude, each 0…1. */
export interface DayOdds {
  /** At least 1 mm of rain (a rain day). */
  readonly rain: number
  /** At least 10 mm (heavy rain) and at least 20 mm (a rainstorm). */
  readonly heavy: number
  readonly rainstorm: number
  /** A thunderstorm (never more often than a rain day). */
  readonly thunder: number
  /** Snowfall (at least 1 mm of water as snow) at the height asked about. */
  readonly snow: number
  /** Fog on the low ground (mostly a morning's). */
  readonly fog: number
  /**
   * A clear-ish sky (at most 4/8 of cloud) and an overcast one (at least 7/8, the sky seen: a fog is its own row), at 06 and 18 UTC as
   * the Aeronautica Militare counts them; as many overcast days as rain days and some more (`overcastChance`, climate.ts).
   */
  readonly clear: number
  readonly overcast: number
  /** A strong wind (over 20 knots) on the low ground. */
  readonly windy: number
}

/**
 * The chances of a day at UTC second `t` (its Rome calendar month) at latitude `lat`, snowfall at `z` m a.s.l.: the tables
 * interpolated at the latitude; thunder spread over the months by the latitude's shape, 40 a year, never more than the rain days;
 * snowfall as a rain day whose air while it falls is under the phase rule's half point (`HALF_SNOW`): the day's mean normal at z, the
 * wet day's offset, the day's air mass (a Gaussian of `AIR_MASS.spread`) and the hour's swing (`RAIN_SWING`), and its event's own air
 * and cooling at its typical rate (a cold outbreak's cold front, frontal rain or a thunderstorm). How much of it is snow is left out,
 * so it reads the weather's own snowfall days within about a third (calibration.long-test.ts).
 */
export const oddsAt = (t: number, lat: number = place().lat, z = 0): DayOdds => {
  const month = romeMonth(t),
    days = DAYS_IN[month]!,
    rain = rainChance(month, lat)
  let shape = 0
  for (let m = 0; m < 12; m++) shape += atLatitude(THUNDER_SHAPE, lat, m)
  const thunder = Math.min(
    rain,
    (THUNDER_YEAR * atLatitude(THUNDER_SHAPE, lat, month)) / shape / days,
  )
  // How far the air mass may run above the normal and still snow, in each event's air, the hour's swing spreading it; a cold outbreak
  // takes the colder part.
  const normals = normalsAt(t, lat),
    room = HALF_SNOW - dailyMean(normals, z) - WET_OFFSET[month]!
  const spread = Math.sqrt(AIR_MASS.spread ** 2 + (RAIN_SWING * rangeAt(normals, z)) ** 2),
    below = (x: number) => normal(x / spread)
  const air = (event: "rain" | "storm" | "snow") =>
    room - REGIME_SPECS[event].anomaly + rainCooling(REGIME_SPECS[event].precip)
  const cold = (COLD_OUTBREAK.months as ReadonlyArray<number>).includes(month)
  const front = cold
    ? below(Math.min(COLD_OUTBREAK.below, air("snow"))) +
      Math.max(0, below(air("rain")) - below(COLD_OUTBREAK.below))
    : below(air("rain"))
  const storms = rain === 0 ? 0 : thunder / rain
  return {
    rain,
    heavy: rain * HEAVY_SHARE[month]!,
    rainstorm: rain * RAINSTORM_SHARE[month]!,
    thunder,
    snow: rain * (storms * below(air("storm")) + (1 - storms) * front),
    fog: atLatitude(FOG_DAYS, lat, month) / days,
    clear: atLatitude(CLEAR_SHARE, lat, month),
    overcast: overcastChance(month, lat),
    windy: (WINDY_DAY * STRONG_WIND[month]!) / 100,
  }
}
