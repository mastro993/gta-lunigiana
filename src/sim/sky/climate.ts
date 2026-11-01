/**
 * Italy's climate at the map's latitude and height, as a small model: the temperature normals each
 * month (from the latitude, falling with height), the day's cycle (a sine by day, a decay through the
 * night), the weather's part in them, the day-to-day air mass, the share of falling precipitation that
 * is snow, and how precipitation grows with height. National, not fitted to one valley: the place enters
 * only through its latitude (`place()`) and the height asked about. Pure functions of the game time, a
 * height and the `Weather` resource; render, audio and the HUD call them too.
 *
 * @module climate
 */
import { Ops } from "@typeonce/ritmo-math"

import type { WeatherValue } from "../schema.ts"
import type { SunPlace } from "./astro.ts"
import { civilFromDays, DAY, daysFromCivil } from "./calendar.ts"
import { SUNRISE_ELEVATION, sunOver } from "./day.ts"
import { place } from "./place.ts"
import { type Regime, REGIME_SPECS } from "./regimes.ts"

/** Twelve monthly values, January first. */
export type Months = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]
/** A monthly row at each of several latitudes (degrees north, ascending): straight between them, held beyond the outermost. */
export type Anchors = ReadonlyArray<readonly [number, Months]>

/**
 * The daily mean at sea level (°C), 1991–2020: ISPRA SCIA's station normals (CC BY 4.0) at or below 800 m, each brought to sea level
 * down the monthly lapse rate (`LAPSE`), averaged in five latitude bands (37–39, 39–41, 41–43, 43–44.5 and 44.5–47 N) and placed at the
 * bands' mean latitudes. It keeps the winter's bend with latitude that a straight line misses (the centre up to 0.9 °C warmer in
 * January).
 */
const SEA_LEVEL: Anchors = [
  [38.13, [11.3, 11.3, 13.2, 15.8, 19.8, 24.0, 26.7, 27.3, 23.9, 20.3, 16.2, 12.7]],
  [40.08, [10.1, 10.4, 12.7, 15.5, 19.8, 24.2, 26.9, 27.2, 23.2, 19.2, 14.9, 11.2]],
  [41.87, [8.8, 9.3, 11.8, 14.8, 19.1, 23.4, 26.0, 26.3, 22.1, 18.0, 13.6, 9.8]],
  [43.87, [6.4, 7.4, 10.7, 14.0, 18.3, 22.5, 25.0, 25.1, 20.6, 16.2, 11.2, 7.2]],
  [45.58, [3.9, 5.6, 9.7, 13.7, 18.3, 22.3, 24.3, 24.1, 19.6, 14.6, 9.2, 4.6]],
]
/**
 * The fall of the daily mean with height, K/km: the least-squares fit over the 296 SCIA stations with a complete 1991–2020 normal
 * (36.8–46.9 N, 0–2210 m), one rate a month and no knee. Gentler in winter (4.0 in December and January), when valley inversions
 * keep cold air low, than from April to September (5.7–5.8); Zandonai et al. (2025, CC BY 4.0) find the same seasons in the Alps.
 */
const LAPSE: Months = [4.03, 4.68, 5.19, 5.67, 5.84, 5.83, 5.81, 5.77, 5.68, 5.03, 4.74, 4.08]
/**
 * The daily range (mean maximum less mean minimum, °C) as `RANGE.at42 + RANGE.perDegree·(lat − 42) + RANGE.perKm·z/1000`: the
 * least-squares fit over the 328 SCIA stations with both normals, 1991–2020. It narrows by 0.4–1.3 °C per km of height.
 */
const RANGE = {
  at42: [7.16, 8.21, 9.21, 9.68, 10.2, 10.69, 11.12, 11.09, 10.04, 8.69, 7.37, 6.97],
  perDegree: [0.25, 0.39, 0.43, 0.36, 0.31, 0.3, 0.34, 0.34, 0.36, 0.2, 0.12, 0.18],
  perKm: [-0.36, -0.66, -1.0, -1.07, -0.99, -0.82, -0.87, -1.08, -1.28, -0.85, -0.65, -0.6],
} as const satisfies Record<string, Months>
/** The narrowest daily range the height may leave, °C (only far above any Italian summit). */
const RANGE_MIN = 1

/** The tables' days in each month (February 28.25): a row of days a month over these is the chance of a day. */
export const DAYS_IN: Months = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
/**
 * Days with at least 1 mm of rain a month: ISPRA SCIA's 1991–2020 normals (CC BY 4.0) at the stations at or below 500 m, averaged in
 * five latitude bands. Latitude turns the year round: July has 1.2 rain days in the south and 6.7 in the north, while the Po plain has
 * the fewest in winter.
 */
const RAIN_DAYS: Anchors = [
  [38.0, [9.2, 8.5, 7.6, 6.1, 3.8, 2.0, 1.2, 1.9, 5.8, 7.0, 8.8, 10.2]],
  [40.1, [8.0, 7.5, 6.9, 7.0, 5.1, 2.6, 1.2, 1.9, 5.1, 6.3, 9.2, 9.0]],
  [41.7, [7.9, 7.3, 7.6, 7.4, 6.3, 4.0, 2.8, 3.1, 6.3, 6.9, 8.7, 8.9]],
  [43.7, [7.7, 7.6, 7.7, 8.6, 7.9, 5.5, 3.7, 4.2, 6.9, 8.7, 10.6, 9.7]],
  [45.5, [5.4, 5.3, 5.9, 8.7, 9.2, 8.0, 6.7, 6.9, 7.3, 7.7, 8.5, 6.6]],
]
/**
 * The share of days with at most 4/8 of cloud (the mean of the counts at 06 and 18 UTC): the Aeronautica Militare's lowland airports,
 * 1971–2000, in four latitude bands.
 */
export const CLEAR_SHARE: Anchors = [
  [38.3, [0.49, 0.49, 0.5, 0.53, 0.62, 0.76, 0.9, 0.87, 0.72, 0.59, 0.54, 0.52]],
  [40.9, [0.49, 0.48, 0.47, 0.47, 0.55, 0.69, 0.82, 0.81, 0.68, 0.55, 0.5, 0.5]],
  [43.3, [0.46, 0.49, 0.48, 0.41, 0.5, 0.59, 0.74, 0.71, 0.61, 0.53, 0.46, 0.46]],
  [45.4, [0.44, 0.52, 0.51, 0.44, 0.46, 0.52, 0.63, 0.63, 0.58, 0.51, 0.45, 0.46]],
]
/** Of the clear-ish days, this share is clear and the rest fair (a design value). */
export const CLEAR_OF_CLEARISH = 0.5
/** The share of days overcast (at least 7/8 at 06 and 18 UTC) beyond the rain days: a design value, as no licensed count exists. */
const OVERCAST_DRY: Months = [
  0.08, 0.08, 0.08, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.08, 0.08, 0.08,
]

/** The chance of a rain day in month `month` (0–11) at latitude `lat`. */
export const rainChance = (month: number, lat: number): number =>
  atLatitude(RAIN_DAYS, lat, month) / DAYS_IN[month]!
/** The chance of an overcast day (at least 7/8 at 06 and 18 UTC) in month `month` (0–11) at latitude `lat`: as many as the rain days and `OVERCAST_DRY` more. */
export const overcastChance = (month: number, lat: number): number =>
  Math.min(1, rainChance(month, lat) + OVERCAST_DRY[month]!)

/**
 * The day-to-day air mass: its departure from the normal follows an AR(1) a game day, `persistence` of yesterday's plus a fresh
 * Gaussian, `spread` °C (its standard deviation) in the long run. Rounded design values (docs/weather.md, the climate sources record).
 */
export const AIR_MASS = { persistence: 0.8, spread: 2.5 } as const
/**
 * How much warmer a wet day runs than the month's normal, °C: rain off the sea in winter is mild, storm outflow in summer cool.
 * Design values, rounded to half a degree (docs/weather.md, the climate sources record).
 */
export const WET_OFFSET: Months = [0.5, 0, -0.5, -1, -1.5, -2, -2, -1.5, -1, -0.5, 0.5, 0.5]

/**
 * Falling precipitation cools the air toward its wet-bulb temperature and, as snow melts in it, toward 0 °C; a thunderstorm's
 * downdraft cools it most. `base` °C from `from` mm/h at sea level, `perMm` more for each mm/h, at most `most`. Design values:
 * without them the phase rule, applied to the day's air, snows on the Apennines' 900–1200 m about a quarter as often as Capozzi et
 * al. (2025) count (calibration.long-test.ts).
 */
const COOLING = { from: 0.1, base: 1.5, perMm: 0.3, most: 3.5 } as const

/** How much colder (°C) the air runs under `precip` mm/h of precipitation at sea level: none under a drizzle. */
export const rainCooling = (precip: number): number =>
  precip < COOLING.from ? 0 : Math.min(COOLING.most, COOLING.base + COOLING.perMm * precip)

/** A snow line above any Italian summit (m a.s.l.): no snow lies anywhere. */
export const NO_SNOW = 6000

/** Month `month` (0–11) of `rows` at latitude `lat`: straight between the two anchors around it, the outermost row's beyond them. */
export const atLatitude = (rows: Anchors, lat: number, month: number): number => {
  const first = rows[0]!,
    last = rows.at(-1)!
  if (lat <= first[0]) return first[1][month]!
  if (lat >= last[0]) return last[1][month]!
  let k = 1
  while (rows[k]![0] < lat) k++
  const [l0, a] = rows[k - 1]!,
    [l1, b] = rows[k]!
  return a[month]! + (b[month]! - a[month]!) * ((lat - l0) / (l1 - l0))
}

/** Where `t` falls between two months' middles: the month before (0–11), the month after, and how far from the first to the second (0…1). */
const between = (
  t: number,
): { readonly from: number; readonly to: number; readonly share: number } => {
  const days = Math.floor(t / DAY),
    { year, month, day } = civilFromDays(days)
  const length =
    daysFromCivil(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) -
    daysFromCivil(year, month, 1)
  const position = month - 1 + (day - 1 + (t - days * DAY) / DAY) / length - 0.5
  const from = Math.floor(position)
  return { from: (from + 12) % 12, to: (from + 13) % 12, share: position - from }
}

/** A monthly value (`at(month)`, 0–11) at UTC second `t`: straight between the middles of the months. */
const inTime = (at: (month: number) => number, t: number): number => {
  const { from, to, share } = between(t),
    a = at(from)
  return a + (at(to) - a) * share
}

/** The temperature normals at one latitude and instant: the daily mean at sea level (°C), its fall with height (K/km), and the daily range at sea level (°C) with its change per km. */
export interface Normals {
  readonly sea: number
  readonly lapse: number
  readonly range: number
  readonly rangePerKm: number
}

/** The temperature normals at UTC second `t` and latitude `lat`: each month's values straight between the months' middles. */
export const normalsAt = (t: number, lat: number = place().lat): Normals => ({
  sea: inTime((m) => atLatitude(SEA_LEVEL, lat, m), t),
  lapse: inTime((m) => LAPSE[m]!, t),
  range: inTime((m) => RANGE.at42[m]! + RANGE.perDegree[m]! * (lat - 42), t),
  rangePerKm: inTime((m) => RANGE.perKm[m]!, t),
})

/** The daily mean normal at `z` m a.s.l. under `normals`, °C. */
export const dailyMean = (normals: Normals, z: number): number =>
  normals.sea - (normals.lapse * z) / 1000

/** The hour of local solar time when the day is warmest; the coldest is at sunrise. */
const WARMEST = 14.5

/**
 * How fast the night cools toward the next sunrise's minimum (Parton and Logan's `b`) under a clear sky
 * in a wind: 3.14, the generic value Felber, Stoeckli and Calanca (2017, Int. J. Biometeorol. 62:621,
 * CC BY 4.0) fit to clear-sky days at Swiss stations below 800 m. The weather's share of the range
 * (`rangeShare`) scales it: a still, clear night cools fastest just after sunset, a cloudy or windy one
 * more evenly.
 */
const NIGHT_DECAY = 3.14

/**
 * The day's temperature cycle with the sun at `sun` over the map, −0.5 at the minimum to +0.5 at the
 * maximum: Parton and Logan's (1981, Agric. Meteorol. 23:205) curve, closed as Felber et al. (2017) close
 * it. A sine rises from the minimum at sunrise to the maximum at 14:30 solar time and falls on to sunset;
 * the night then decays toward the next sunrise's minimum as e^(−decay·x) − x·e^(−decay), x the share of
 * the night gone, so it meets the minimum there with no jump. (Felber et al.'s generic fit has the minimum
 * 0.75 h after sunrise and the maximum at 14:43; the game keeps sunrise and 14:30.)
 */
const dailyCycle = (sun: SunPlace, decay: number, lat: number): number => {
  const RAD = Math.PI / 180,
    dec = sun.declination * RAD,
    phi = lat * RAD
  const cosRise =
    (Ops.sin(SUNRISE_ELEVATION * RAD) - Ops.sin(phi) * Ops.sin(dec)) / (Ops.cos(phi) * Ops.cos(dec))
  const rise = 12 - Ops.acos(Math.max(-1, Math.min(1, cosRise))) / RAD / 15,
    set = 24 - rise
  const span = set - rise + 2 * (WARMEST - 12),
    solar = 12 + sun.hourAngle / 15
  if (solar >= rise && solar <= set) return Ops.sin((Math.PI * (solar - rise)) / span) - 0.5
  const x = ((solar - set + 24) % 24) / (24 - (set - rise))
  return (
    Ops.sin((Math.PI * (set - rise)) / span) * (Ops.exp(-decay * x) - x * Ops.exp(-decay)) - 0.5
  )
}

/**
 * How much of a clear, windy day's range the weather lets through: 0.4 under a full cloud cover, 1 under
 * a clear sky in a wind, 1.15 clear and calm (low ground cools most on still, clear nights).
 */
const rangeShare = (cloud: number, wind: number): number => {
  const calm = Math.max(0, Math.min(1, (6 - wind) / 4))
  return 0.4 + (1 - cloud) * (0.6 + 0.15 * calm)
}

/**
 * The share of the range (`rangeShare`) month `month`'s skies let through on average at latitude `lat`: its clear-ish days clear or
 * fair, its overcast days (the rain days among them) and the rest cloudy, each under its regime's cloud and wind. SCIA's range is the
 * mean over every sky, so the day's swing is the weather's share over this: wider than the mean under a clear sky, narrower under cloud.
 */
const usualShare = (month: number, lat: number): number => {
  const clear = atLatitude(CLEAR_SHARE, lat, month),
    overcast = Math.min(1 - clear, overcastChance(month, lat))
  const under = (regime: Regime) =>
    rangeShare(REGIME_SPECS[regime].cloud, REGIME_SPECS[regime].wind)
  const clearish = CLEAR_OF_CLEARISH * under("clear") + (1 - CLEAR_OF_CLEARISH) * under("fair")
  return clear * clearish + overcast * under("overcast") + (1 - clear - overcast) * under("cloudy")
}

/** The air over the map at one instant, before height: today's normals at the map's latitude, where the day stands in its cycle (× the weather's share of the range over the month's usual share), and the weather's anomaly (°C). */
export interface Air {
  readonly normals: Normals
  readonly swing: number
  readonly anomaly: number
}

/** The air at UTC second `t` under `weather` (pass `sun`, `sunOver(t)`, when it is already worked out). */
export const airAt = (
  t: number,
  weather: Pick<WeatherValue, "cloud" | "wind" | "anomaly">,
  sun: SunPlace = sunOver(t),
): Air => {
  const share = rangeShare(weather.cloud, weather.wind),
    { lat } = place(),
    usual = inTime((month) => usualShare(month, lat), t)
  return {
    normals: normalsAt(t, lat),
    swing: (dailyCycle(sun, NIGHT_DECAY * share, lat) * share) / usual,
    anomaly: weather.anomaly,
  }
}

/** The daily range at `z` m a.s.l. under `normals`, °C. */
export const rangeAt = (normals: Normals, z: number): number =>
  Math.max(RANGE_MIN, normals.range + (normals.rangePerKm * z) / 1000)

/** The air's temperature at `z` m a.s.l., °C: the daily mean down its lapse rate, the day's swing of the range at that height, and the anomaly. */
export const celsiusAt = (air: Air, z: number): number =>
  dailyMean(air.normals, z) + rangeAt(air.normals, z) * air.swing + air.anomaly

/**
 * The share of precipitation falling as snow at `celsius`: all of it at or below 0.5 °C, none at or above
 * 1.5 °C, half at 1.0 °C, where Jennings et al. (2018, Nat. Commun. 9:1148, CC BY 4.0) find the rain–snow
 * threshold of the Northern Hemisphere's air temperature on average (a temperature-only phase rule).
 */
export const snowShare = (celsius: number): number => Math.max(0, Math.min(1, 1.5 - celsius))

/** Where `snowShare` is a half: 1.0 °C. */
export const HALF_SNOW = 1
/** The heights `freezingLevel` keeps to, m a.s.l.: from below any ground to above any freezing level a summer can bring. */
const LEVELS = { low: -1000, high: 8000 } as const

/**
 * The height (m a.s.l.) where the air of `air` is at 1.0 °C, so half the precipitation falls as snow, kept between −1000 and 8000 m.
 * `celsiusAt` falls in a straight line with height (the range's floor bends it only far above any summit), so it is solved, not searched.
 */
export const freezingLevel = (air: Air): number => {
  const { lapse, range, rangePerKm } = air.normals
  // Where the range reaches its floor, and the line's slope (°C per m) below it; above it the mean's lapse alone.
  const knee = rangePerKm < 0 ? (1000 * (RANGE_MIN - range)) / rangePerKm : LEVELS.high
  let level = (HALF_SNOW - celsiusAt(air, 0)) / (-lapse / 1000 + (rangePerKm / 1000) * air.swing)
  if (level > knee) level = knee + (HALF_SNOW - celsiusAt(air, knee)) / (-lapse / 1000)
  return Math.max(LEVELS.low, Math.min(LEVELS.high, level))
}

/**
 * How much more precipitation falls at `z` m a.s.l. than at sea level: 0.6 more per km, held at 2 from about 1670 m up. A national
 * design value: Italy's gauges gain from about +0.3 to over +1 per km (the Apuan Alps' line through ISPRA SCIA's 1991–2020 gauges is
 * +0.95 from 250 m), and the regimes' precipitation is set at sea level.
 */
export const orographic = (z: number): number => Math.max(1, Math.min(2, 1 + (0.6 * z) / 1000))
