/**
 * The weather's day plan. At each Rome midnight (and when the clock jumps into another day) the weather
 * draws the day ahead from Italy's odds at the map's latitude (odds.ts): whether it is wet, by a two-state
 * Markov chain that keeps both the month's rain days and how rain days follow each other; a wet day's
 * event (a thunderstorm, frontal rain or, in a winter cold outbreak, a cold front), how much it brings and
 * when, under an overcast sky (a summer thunderstorm grows out of a fair one), now and then running on
 * through midnight into a wet tomorrow; a dry day's sky, its strong wind and its fog; and the day's air
 * mass, a daily AR(1). Which regime the weather moves toward at each moment is then a pure function of the
 * plan and the time. Pure and map-free: a day's draws come from the weather seed and the day alone, never
 * from `WeatherRng`, so the same seed plans the same days whatever else the game draws; weather.ts plans
 * through it, and the HUD reads when the regime next changes.
 *
 * @module plan
 */
import { Ops } from "@typeonce/ritmo-math"

import { mix } from "../hash.ts"
import type { PlanValue } from "../schema.ts"
import { civilFromDays, DAY, romeDay, utcFromRome } from "./calendar.ts"
import { AIR_MASS, CLEAR_OF_CLEARISH, rainChance, WET_OFFSET } from "./climate.ts"
import { COLD_OUTBREAK, HEAVY_SHARE, oddsAt, RAINSTORM_SHARE, WET_PERSISTENCE } from "./odds.ts"
import { place } from "./place.ts"
import { RAINS_FROM, type Regime, REGIME_SPECS } from "./regimes.ts"

const HOUR = 3600
/** A new game's weather holds clear and calm this long (game seconds), so the first stretch of play, and every test's first frames, stay calm. */
const CALM_START = 90 * 60
/** A wet day's sky thickens this long before its rain (s) unless it is thick already at midnight; towering cloud before a summer thunderstorm. */
const LEAD = 1.5 * HOUR
/** From March to September thunderstorms grow over land in the afternoon, starting between 13:00 and 18:00; the rest come off the sea at any hour. */
const CONVECTIVE = { months: [2, 3, 4, 5, 6, 7, 8], from: 13 * HOUR, to: 18 * HOUR } as const
/**
 * A rain day's total at sea level, mm, from a draw `u` (0…1) within its intensity: ordinary 1.5–9 mm, two thirds of them under 5 (of
 * ISPRA's national median rain days under 10 mm, a third reach 5 mm); heavy 11–18.5 mm; a rainstorm from 22 mm with an exponential tail
 * (34 mm on average, at most 80). Design values, clear of the class edges by more than an overcast day's drizzle (0.7 mm).
 */
const AMOUNT = {
  ordinary: (u: number) => 1.5 + 7.5 * u * u,
  heavy: (u: number) => 11 + 7.5 * u,
  rainstorm: (u: number) => Math.min(80, 22 - 12 * Ops.log(1 - u)),
} as const
/** How long a wet day's rain lasts, game hours (shortest, longest), by its event and intensity: thunderstorms are short, fronts long. Design values. */
const HOURS = {
  storm: { ordinary: [1, 3], heavy: [1, 3], rainstorm: [2, 4] },
  rain: { ordinary: [2, 6], heavy: [4, 9], rainstorm: [6, 12] },
} as const
/** The heaviest a day's rain falls, mm/h at sea level: a bigger total lasts longer. */
const HEAVIEST = 15
/** Of two days of steady rain in a row (frontal rain or a cold front, no thunderstorm), the share whose rain runs on through the midnight between them (a design value). */
const RUNS_ON = 0.5
/** A strong wind blows this many game hours of its day (shortest, longest). */
const WINDY_HOURS = [6, 14] as const
/** Radiation fog forms from 01:00: a plan that takes over later (a new game's) brings no fog morning. */
const FOG_FORMS = HOUR
/** A low stratus lifts between 10:00 and 14:00; from November to February this share of them holds all day. Design values. */
const STRATUS = { lifts: [10 * HOUR, 14 * HOUR], allDay: 0.3, winter: [10, 11, 0, 1] } as const
/** How many numbers a day's draws take. */
const NUMBERS = 17

/** The calendar month (0–11) of Rome day `day`. */
const monthOfDay = (day: number): number => civilFromDays(day).month - 1
/** Whether `month` (0–11) is one of `months`. */
const among = (months: ReadonlyArray<number>, month: number): boolean => months.includes(month)
/** The UTC second of the midnight that starts Rome day `day`. */
const midnight = (day: number): number => utcFromRome(day * DAY)
/** How long Rome day `day` lasts, s: 23 hours the day summer time starts, 25 the day it ends, else 24. */
const lengthOf = (day: number): number => midnight(day + 1) - midnight(day)
/**
 * The Rome day at UTC second `t` and the seconds gone since its midnight. A plan's times count these, so on the days the clocks change
 * its rain lasts as long as drawn (its hours then read one off the wall clock's after the switch).
 */
const clockOf = (t: number): { readonly day: number; readonly second: number } => {
  const { day } = romeDay(t)
  return { day, second: t - midnight(day) }
}

/** What a day's draws need, at one latitude in one month: each event's chance given what was drawn before it. */
interface Chances {
  /** A rain day, and one after a rain day (the chain's persistence). */
  readonly wet: number
  readonly persistence: number
  /** Given a rain day: a thunderstorm, heavy rain (10 mm or more), a rainstorm (20 mm or more). */
  readonly thunder: number
  readonly heavy: number
  readonly rainstorm: number
  /** Given a dry day: a clear-ish sky (at most 4/8). */
  readonly clear: number
  /** Given a clear-ish dry day: a strong wind. */
  readonly windy: number
  /** Given a dry day without a strong wind: fog. */
  readonly fog: number
  /** Given a dry day that is not clear-ish: an overcast sky. */
  readonly overcast: number
}

/**
 * The chances behind Rome day `day` at latitude `lat`, solved so the days come out as `oddsAt`'s table with the skies counted as the
 * Aeronautica Militare counts them, at 06 and 18 UTC (an overcast sky seen, not hidden by a stratus: fog is its own row). A wet day is
 * overcast or raining at both, but a summer thunderstorm's, fair at 06 and cloudy at 18; so the dry days carry the rest of the
 * clear-ish share, and the overcast days the wet ones leave, less the hours a stratus hides (06 UTC; 18 UTC too when it holds all
 * day). Strong winds come on clear-ish dry days only, fog on dry days without one (a radiation-fog morning under a clear-ish sky, a
 * stratus under a cloudy or overcast one).
 */
const chancesOn = (day: number, lat: number): Chances => {
  const odds = oddsAt(midnight(day), lat),
    month = monthOfDay(day),
    wet = odds.rain,
    dry = 1 - wet
  const share = (part: number, of: number) => (of > 0 ? Math.max(0, Math.min(1, part / of)) : 0)
  const thunder = share(odds.thunder, wet),
    summer = among(CONVECTIVE.months, month) ? thunder : 0
  const clear = share(odds.clear - (wet * summer) / 2, dry),
    cloudy = dry * (1 - clear),
    fog = share(odds.fog, dry - odds.windy)
  const stratus = (fog * (1 + (among(STRATUS.winter, month) ? STRATUS.allDay : 0))) / 2
  return {
    wet,
    persistence: WET_PERSISTENCE[month]!,
    thunder,
    heavy: HEAVY_SHARE[month]!,
    rainstorm: RAINSTORM_SHARE[month]!,
    clear,
    windy: share(odds.windy, dry * clear),
    fog,
    overcast: share(odds.overcast - wet * (1 - summer), cloudy * (1 - stratus)),
  }
}

/**
 * Rome day `day`'s numbers in [0, 1) under the weather seed `seed`: a SplitMix32 sequence (the golden-ratio step and `mix`) from the
 * seed and the day hashed together. The plan draws from nothing else: sharing `WeatherRng` with the storm, whose draws follow where the
 * player stands and how long a storm lasts in real time, the days after a thunderstorm followed the play, not the seed.
 */
const dayNumbers = (seed: number, day: number): ReadonlyArray<number> => {
  let x = mix(seed ^ mix(day))
  return Array.from({ length: NUMBERS }, () => {
    x = (x + 0x9e3779b9) | 0
    return mix(x) / 0x100000000
  })
}

/** What a day's chain and draws give before its hours are placed: wet or dry, its air mass, and a wet day's event and total. */
interface Kind {
  readonly numbers: ReadonlyArray<number>
  readonly chances: Chances
  readonly wet: boolean
  readonly airMass: number
  readonly event: PlanValue["event"]
  readonly intensity: PlanValue["intensity"]
  /** A thunderstorm growing over land in the afternoon (March to September). */
  readonly convective: boolean
  readonly amount: number
}

/**
 * Rome day `day` under the weather seed `seed` at latitude `lat`, `days` days after a day `wet` with `airMass` (0: no day known before
 * it): wet with the chain's odds that many days on (an exact n-step chain, so a clock jump keeps the statistics; with no day known, the
 * month's own odds), the air mass an AR(1) as many days on (with none known, at its full spread). A pure function of its arguments, so
 * tomorrow drawn ahead is the day it turns out to be.
 */
const kindOf = (
  seed: number,
  day: number,
  lat: number,
  wet: boolean,
  airMass: number,
  days: number,
): Kind => {
  const numbers = dayNumbers(seed, day),
    chances = chancesOn(day, lat),
    month = monthOfDay(day)
  const [uWet = 0, uGauss = 0, uTurn = 0, uThunder = 0, uClass = 0, uAmount = 0] = numbers
  // Wet or dry: a two-state chain whose long-run share of wet days is the month's, p01 = f(1 − p11)/(1 − f).
  const f = chances.wet,
    p11 = chances.persistence,
    fade = days > 0 ? Ops.pow(p11 - (f * (1 - p11)) / (1 - f), days) : 0
  // The air mass: φⁿ of the last plus a Gaussian (Box–Muller) keeping the long-run spread.
  const keep = days > 0 ? Ops.pow(AIR_MASS.persistence, days) : 0
  const mass =
    keep * airMass +
    AIR_MASS.spread *
      Math.sqrt(1 - keep * keep) *
      Math.sqrt(-2 * Ops.log(1 - uGauss)) *
      Ops.cos(2 * Math.PI * uTurn)
  const thunder = uThunder < chances.thunder,
    intensity =
      uClass < chances.rainstorm ? "rainstorm" : uClass < chances.heavy ? "heavy" : "ordinary"
  const event = thunder
    ? "storm"
    : among(COLD_OUTBREAK.months, month) && mass <= COLD_OUTBREAK.below
      ? "snow"
      : "rain"
  return {
    numbers,
    chances,
    wet: uWet < (wet ? f + (1 - f) * fade : f * (1 - fade)),
    airMass: mass,
    event,
    intensity,
    convective: thunder && among(CONVECTIVE.months, month),
    amount: AMOUNT[intensity](uAmount),
  }
}

/**
 * The plan for Rome day `day` under the weather seed `seed`, taking over at second `from` of it (0 but in a new game), after
 * `previous`. A wet day's rain falls in one window inside the day, so its total is the day's: a summer thunderstorm's starts between
 * 13:00 and 18:00, any other from `LEAD` after midnight, or from midnight when yesterday ended under a thick sky. On days of steady rain
 * in a row (tomorrow drawn ahead) the rain may run on to midnight and go on from it the next day, so a spell rains on across days.
 */
const drawPlan = (previous: PlanValue, day: number, from: number, seed: number): PlanValue => {
  const lat = place().lat,
    days = previous.drawn && day > previous.day ? day - previous.day : 0
  const today = kindOf(seed, day, lat, previous.wet, previous.airMass, days),
    { chances } = today,
    length = lengthOf(day)
  const [
    uLength = 0,
    uStart = 0,
    uRuns = 0,
    uSky = 0,
    uKind = 0,
    uWindy = 0,
    uWindyLength = 0,
    uWindyStart = 0,
    uFog = 0,
    uAllDay = 0,
    uLift = 0,
  ] = today.numbers.slice(6)
  // A wet day's window: steady rain (or a cold front's snow) going on from midnight where yesterday's ran on to it, else any rain once
  // the sky has thickened.
  const yesterday = previous.drawn && previous.day === day - 1 ? previous : undefined,
    steady = today.wet && today.event !== "storm"
  const joins =
    steady && yesterday !== undefined && yesterday.wet && yesterday.end >= lengthOf(yesterday.day)
  const ready =
    yesterday !== undefined &&
    REGIME_SPECS[regimeAt(yesterday, midnight(day) - 1)].cloud > RAINS_FROM
  const [shortest, longest] = HOURS[today.event === "storm" ? "storm" : "rain"][today.intensity]
  const hours = Math.max(
    Math.round((shortest + (longest - shortest) * uLength) * HOUR),
    Math.ceil((today.amount / HEAVIEST) * HOUR),
  )
  const earliest = joins
    ? 0
    : Math.max(from + (ready ? 0 : LEAD), today.convective ? CONVECTIVE.from : 0)
  const latest = joins ? 0 : Math.min(length - hours, today.convective ? CONVECTIVE.to : length)
  const wet = today.wet && latest >= earliest
  // Tomorrow, drawn ahead: steady rain before another day of it may run on to midnight.
  const tomorrow = kindOf(seed, day + 1, lat, wet, today.airMass, 1)
  const runs =
    wet &&
    steady &&
    tomorrow.wet &&
    tomorrow.event !== "storm" &&
    uRuns < RUNS_ON &&
    length - hours >= earliest
  if (wet) {
    const start = joins
        ? 0
        : runs
          ? length - hours
          : Math.round(earliest + (latest - earliest) * uStart),
      end = runs ? length : start + hours
    return {
      day,
      drawn: true,
      from,
      wet: true,
      event: today.event,
      intensity: today.intensity,
      start,
      end,
      precip: (today.amount * HOUR) / (end - start),
      sky: today.convective ? "fair" : "overcast",
      fog: "none",
      lift: 0,
      windyFrom: 0,
      windyTo: 0,
      airMass: today.airMass,
    }
  }
  // A dry day's sky, strong wind and fog.
  const clearish = uSky < chances.clear
  const sky = clearish
    ? uKind < CLEAR_OF_CLEARISH
      ? "clear"
      : "fair"
    : uKind < chances.overcast
      ? "overcast"
      : "cloudy"
  const windyLength = Math.round(
    (WINDY_HOURS[0] + (WINDY_HOURS[1] - WINDY_HOURS[0]) * uWindyLength) * HOUR,
  )
  const windy = clearish && uWindy < chances.windy && from + windyLength <= length
  const windyFrom = windy ? Math.round(from + (length - windyLength - from) * uWindyStart) : 0
  const foggy = !windy && uFog < chances.fog
  const fog =
    foggy && clearish ? (from <= FOG_FORMS ? "morning" : "none") : foggy ? "stratus" : "none"
  const allDay = among(STRATUS.winter, monthOfDay(day)) && uAllDay < STRATUS.allDay
  const lift =
    fog === "stratus"
      ? allDay
        ? length
        : Math.round(STRATUS.lifts[0] + (STRATUS.lifts[1] - STRATUS.lifts[0]) * uLift)
      : 0
  return {
    day,
    drawn: true,
    from,
    wet: false,
    event: "rain",
    intensity: "ordinary",
    start: 0,
    end: 0,
    precip: 0,
    sky,
    fog,
    lift,
    windyFrom,
    windyTo: windy ? windyFrom + windyLength : 0,
    airMass: today.airMass,
  }
}

/** A new game's plan at UTC second `t`: not drawn yet (the first step draws it), clear and calm until `CALM_START` from now. */
export const calmPlan = (t: number): PlanValue => {
  const { day, second } = clockOf(t)
  return {
    day,
    drawn: false,
    from: second + CALM_START,
    wet: false,
    event: "rain",
    intensity: "ordinary",
    start: 0,
    end: 0,
    precip: 0,
    sky: "clear",
    fog: "none",
    lift: 0,
    windyFrom: 0,
    windyTo: 0,
    airMass: 0,
  }
}

/**
 * The plan in force at UTC second `t` after `plan`, under the weather seed `seed`: the same while its Rome day lasts; once the clock is
 * on another day (at midnight in play, or by a jump), that day's, the whole of it; a new game's drawn at its first step, after its calm
 * start.
 */
export const planFor = (plan: PlanValue, t: number, seed: number): PlanValue => {
  const { day } = romeDay(t)
  if (day !== plan.day) return drawPlan(plan, day, 0, seed)
  return plan.drawn ? plan : drawPlan(plan, day, plan.from, seed)
}

/** Whether a wet day's rain is falling in `plan` at UTC second `t` (the window between its start and end). */
export const rainingAt = (plan: PlanValue, t: number): boolean => {
  const { second } = clockOf(t)
  return plan.drawn && plan.wet && second >= plan.start && second < plan.end
}

/**
 * The regime `plan` moves the weather toward at UTC second `t`: clear before the plan takes over (a new game's calm start); on a wet
 * day the event while it falls, else the day's sky (before a summer thunderstorm fair, towering cloud from `LEAD` before it and cloudy
 * after); on a dry day the sky, a stratus until it lifts, the strong wind while it blows.
 */
export const regimeAt = (plan: PlanValue, t: number): Regime => {
  const { second } = clockOf(t)
  if (!plan.drawn || second < plan.from) return "clear"
  if (plan.wet) {
    if (second >= plan.start && second < plan.end) return plan.event
    if (plan.sky !== "fair") return plan.sky
    return second >= plan.start - LEAD ? "cloudy" : "fair"
  }
  if (plan.fog === "stratus" && second < plan.lift) return "fog"
  if (second >= plan.windyFrom && second < plan.windyTo) return "windy"
  return plan.sky
}

/**
 * Game seconds from UTC second `t` until `plan`'s regime may next change: when the plan takes over, before it does (a time drawn before
 * then, a stratus lifting before a new game's plan, passes unseen); after, the next of its times at which the regime changes, else the
 * next midnight's plan.
 */
export const untilChange = (plan: PlanValue, t: number): number => {
  const { day, second } = clockOf(t),
    length = lengthOf(day),
    start = t - second
  if (second < plan.from) return Math.min(plan.from, length) - second
  const times = plan.wet
    ? [plan.start - LEAD, plan.start, plan.end]
    : [plan.lift, plan.windyFrom, plan.windyTo]
  const changes = (at: number) =>
    at > second && at < length && regimeAt(plan, start + at) !== regimeAt(plan, start + at - 1)
  return times.reduce((next, at) => (changes(at) && at < next ? at : next), length) - second
}

/**
 * How much warmer than its air mass `plan`'s day runs at latitude `lat`, °C: a wet day by its month's `WET_OFFSET`, a dry day by as
 * much the other way as keeps the month's mean on the normal (f × offset / (1 − f) colder, f the month's rain-day chance).
 */
export const dayWarmth = (plan: PlanValue, lat: number = place().lat): number => {
  const month = monthOfDay(plan.day),
    offset = WET_OFFSET[month]!
  if (plan.wet) return offset
  const f = rainChance(month, lat)
  return (-f * offset) / (1 - f)
}
