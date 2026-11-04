/**
 * The debug menu's Time and Weather areas, through the sky store (`hud/sky.ts`) that `gta.sky` shares:
 * the clock's rate, the time of day, the date, sunrise and sunset; a regime held or left to the day's
 * plan (Auto) and "Settle now"; and live readouts of the sun, the moon, the weather at the player, the
 * weather seed and this month's odds (the sim's `oddsAt`, which each day's plan is drawn from),
 * refreshed each frame while the menu is open and never announced (no live region). Every regime's
 * name and description comes from `REGIME_SPECS` (src/sim/sky/regimes.ts).
 *
 * @module hud/debug-sky
 */
import type { SkyViewModel } from "../sim/index.ts"
import { moonAt, moonPhase } from "../sim/sky/astro.ts"
import { civilFromDays, DAY, romeTime } from "../sim/sky/calendar.ts"
import { NO_SNOW } from "../sim/sky/climate.ts"
import { SECONDS_RANGE } from "../sim/sky/clock.ts"
import { sunOver, sunTimes } from "../sim/sky/day.ts"
import { conditionsAt, windAt } from "../sim/sky/local.ts"
import { type DayOdds, oddsAt, romeMonth } from "../sim/sky/odds.ts"
import { place } from "../sim/sky/place.ts"
import { untilChange } from "../sim/sky/plan.ts"
import { describeWeather } from "../sim/sky/readout.ts"
import { type Regime, REGIME_SPECS, REGIMES } from "../sim/sky/regimes.ts"
import { clockText } from "./clock.ts"
import type { Area, Make } from "./debug.ts"
import { dateText, parseDate, type SkyStore } from "./sky.ts"
import { set } from "./title.ts"

/** The clock's rates the menu offers, game seconds per step (60 steps a real second), with their names and what they do. */
export const RATES = [
  {
    rate: 0,
    label: "Stopped",
    description:
      "The clock stands still, and with it the sun, the moon and the weather's changes; a storm still flashes.",
  },
  {
    rate: 1,
    label: "Normal (1 min/s)",
    description: "A game minute each real second: a day in 24 real minutes.",
  },
  {
    rate: 10,
    label: "×10",
    description: "Ten game minutes each real second: a day in 2.4 real minutes.",
  },
  {
    rate: 60,
    label: "×60",
    description: "A game hour each real second: a day in 24 real seconds.",
  },
] as const

/** The compass points, clockwise from north. */
const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const

/** The compass point the wind of velocity (x east, y north) blows from: the air moving toward the north-east comes from the south-west. */
export const compass = (x: number, y: number): (typeof POINTS)[number] => {
  const bearing = (Math.atan2(-x, -y) * 180) / Math.PI
  return POINTS[(Math.round(bearing / 45) + 8) % 8]!
}

/** The wind of velocity `wind` (m/s, x east, y north) and gust factor `gust` as the menu reads it: "from SW 5.0 m/s, gusts 8.5". */
export const windText = (
  wind: { readonly x: number; readonly y: number },
  gust: number,
): string => {
  const speed = Math.hypot(wind.x, wind.y)
  return speed < 0.05
    ? "calm"
    : `from ${compass(wind.x, wind.y)} ${speed.toFixed(1)} m/s, gusts ${(speed * gust).toFixed(1)}`
}

/** `seconds` of game time as hours and minutes: "1 h 20 min", "45 min". */
export const spanText = (seconds: number): string => {
  const minutes = Math.max(0, Math.round(seconds / 60)),
    hours = Math.floor(minutes / 60)
  return hours === 0 ? `${minutes} min` : `${hours} h ${minutes % 60} min`
}

/** Whether the HUD's weather word names `mm` mm/h falling, as drizzle or more: the sim's own `describeWeather` asked, so the two never part. */
const named = (mm: number): boolean =>
  describeWeather({ cloud: 0, storm: 0, wind: 0 }, { rain: mm, snow: 0, fog: 0 }) !== "Clear"

/**
 * Rain and snow falling (mm/h, liquid-equivalent) as the menu reads them, from the HUD's drizzle on: "rain 3.0 mm/h", "rain 0.4 +
 * snow 1.2 mm/h", "rain 0.03 mm/h" (to the hundredth under 0.1), or "" when too little falls for the HUD to name it.
 */
export const fallingText = (rain: number, snow: number): string => {
  if (!named(rain + snow)) return ""
  // A part that would print as 0.00 is left out.
  const parts = (
    [
      [rain, "rain"],
      [snow, "snow"],
    ] as const
  ).filter(([mm]) => mm >= 0.005)
  return `${parts.map(([mm, kind]) => `${kind} ${mm.toFixed(mm < 0.1 ? 2 : 1)}`).join(" + ")} mm/h`
}

/** The snow line as the menu reads it: its height, or none while it stands above the map. */
export const snowLineText = (snowLine: number): string =>
  snowLine >= NO_SNOW ? "none" : `${Math.round(snowLine)} m`

/** The weather seed as the menu reads it, the 32-bit state it is, in hex: "0x9e3779b8". */
export const seedText = (seed: number): string => `0x${(seed >>> 0).toString(16).padStart(8, "0")}`

/** A day's chance as the menu reads it: whole from 10 %, to the tenth under it, and one too small to show not as none: "27 %", "4.6 %", "< 0.1 %". */
const percentText = (chance: number): string => {
  const tenths = Math.round(chance * 1000) / 10
  if (tenths >= 10) return `${Math.round(chance * 100)} %`
  if (tenths > 0) return `${tenths.toFixed(1)} %`
  return chance > 0 ? "< 0.1 %" : "0 %"
}

/** The events the odds list, each by its name in the menu, in the menu's order. */
const ODDS = {
  rain: "Rain",
  heavy: "Heavy rain",
  rainstorm: "Rainstorm",
  thunder: "Thunder",
  snow: "Snowfall",
  fog: "Fog",
  clear: "Clear-ish",
  overcast: "Overcast",
  windy: "Windy",
} as const satisfies Record<keyof DayOdds, string>

/** Each event's chance in `odds` as the menu reads it, with what it counts; snowfall at `z` m a.s.l., the height it was worked out for: "27 %, 1 mm or more". */
export const oddsText = (odds: DayOdds, z: number): Readonly<Record<keyof DayOdds, string>> => {
  const p = (key: keyof DayOdds) => percentText(odds[key])
  return {
    rain: `${p("rain")}, 1 mm or more`,
    heavy: `${p("heavy")}, 10 mm or more`,
    rainstorm: `${p("rainstorm")}, 20 mm or more`,
    thunder: p("thunder"),
    snow: `${p("snow")} at ${Math.round(z)} m`,
    fog: `${p("fog")}, on the low ground`,
    clear: `${p("clear")}, 4/8 cloud or less`,
    overcast: `${p("overcast")}, rain days included`,
    windy: `${p("windy")}, over 20 knots`,
  }
}

/** The month names, January first. */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

/**
 * The odds as the menu shows them at UTC second `t` with the player at `z` m a.s.l.: headed by Rome's month (the one a day's plan
 * belongs to), what they are, and each event's chance from the sim's `oddsAt` at the map's latitude, snowfall at `z`.
 */
export const oddsReadout = (t: number, z: number) => {
  const { lat } = place()
  return {
    title: `Odds (${MONTHS[romeMonth(t)]})`,
    about: `A day's chances this month at the map's latitude, ${lat.toFixed(2)}° N, snowfall at the player's height. Auto draws each day from them.`,
    rows: oddsText(oddsAt(t, lat, z), z),
  }
}

/** A list of readouts named by `names`: the list and the value cell of each. */
const readouts = <K extends string>(make: Make, names: Readonly<Record<K, string>>) => {
  const list = make("dl", { className: "debug-readouts" }),
    values = {} as Record<K, HTMLElement>
  for (const key of Object.keys(names) as Array<K>) {
    values[key] = make("dd", { textContent: "—" })
    list.append(make("div", {}, make("dt", { textContent: names[key] }), values[key]))
  }
  return { list, values }
}

/** The first and last dates the clock can show (`SECONDS_RANGE`), as date input bounds. */
const FIRST = dateText(civilFromDays(SECONDS_RANGE.min / DAY)),
  LAST = dateText(civilFromDays(SECONDS_RANGE.max / DAY - 1))

/** The Time area: the rate, the time of day and the date the store shows, sunrise and sunset, and the sun and the moon now. */
export const timeArea = (make: Make, sky: SkyStore): Area => {
  const rates = RATES.map(({ rate, label, description }) => {
    const button = make("button", {
      type: "button",
      id: `debug-time-rate-${rate}`,
      textContent: label,
      title: description,
    })
    button.addEventListener("click", () => sky.setRate(rate))
    return { rate, button }
  })
  // On every change the store makes, and each frame: the host sets the rate too (it holds the clock behind the title card).
  const showRate = () => {
    const now = sky.rate()
    for (const { rate, button } of rates)
      if (button.ariaPressed !== String(rate === now)) button.ariaPressed = String(rate === now)
  }
  sky.subscribe(showRate)
  showRate()
  const slider = make("input", {
    id: "debug-time-of-day",
    type: "range",
    min: "0",
    max: String(DAY / 60 - 1),
    step: "1",
  })
  // Not a live region: it changes every game minute.
  const shown = make("output", { ariaLive: "off" })
  const about = make("p", {
    id: "debug-time-of-day-about",
    textContent: "Rome's wall clock on the date below, in minutes.",
  })
  slider.setAttribute("aria-describedby", about.id)
  slider.addEventListener("input", () => {
    slider.ariaValueText = clockText(Number(slider.value) * 60)
    sky.setTime(Number(slider.value) * 60)
  })
  const date = make("input", {
    id: "debug-time-date",
    type: "date",
    min: FIRST,
    max: LAST,
    required: true,
  })
  date.addEventListener("change", () => {
    const day = parseDate(date.value)
    if (day !== undefined) sky.setDate(day)
  })
  const sunrise = make("button", { type: "button", id: "debug-time-sunrise" }),
    sunset = make("button", { type: "button", id: "debug-time-sunset" })
  // The sim's own sunrise and sunset (`sunTimes`), which move with the date.
  const goTo = (which: "sunrise" | "sunset") => {
    const times = sunTimes(sky.now().seconds)
    if (times !== undefined) sky.setSeconds(times[which])
  }
  sunrise.addEventListener("click", () => goTo("sunrise"))
  sunset.addEventListener("click", () => goTo("sunset"))
  const { list, values } = readouts(make, { sun: "Sun", moon: "Moon" })
  let day = ""
  const live = () => {
    showRate()
    const { seconds, local } = sky.now(),
      minute = local.hour * 60 + local.minute,
      focused = slider.ownerDocument.activeElement
    set(shown, clockText(minute * 60))
    // A focused control is the player's: moved under a drag or the arrow keys, it would fight them.
    if (focused !== slider && slider.value !== String(minute)) {
      slider.value = String(minute)
      slider.ariaValueText = clockText(minute * 60)
    }
    if (dateText(local) !== day) {
      day = dateText(local)
      const times = sunTimes(seconds),
        at = (t: number | undefined) => {
          if (t === undefined) return "—"
          const rome = romeTime(t)
          return clockText(rome.hour * 3600 + rome.minute * 60)
        }
      set(sunrise, `Sunrise ${at(times?.sunrise)}`)
      set(sunset, `Sunset ${at(times?.sunset)}`)
    }
    if (focused !== date && date.value !== day) date.value = day
    const sun = sunOver(seconds),
      moon = moonAt(seconds, place().lat, place().lon),
      phase = moonPhase(sun, moon)
    set(values.sun, `elevation ${sun.elevation.toFixed(1)}°, azimuth ${Math.round(sun.azimuth)}°`)
    set(
      values.moon,
      `elevation ${moon.elevation.toFixed(1)}°, ${Math.round(phase.illuminated * 100)} % lit, ${phase.waxing ? "waxing" : "waning"}`,
    )
  }
  const knob = (...nodes: Array<Node>) => make("div", { className: "debug-knob" }, ...nodes)
  return {
    title: "Time",
    nodes: [
      make("div", { className: "debug-choices" }, ...rates.map(({ button }) => button)),
      knob(make("label", { htmlFor: slider.id, textContent: "Time of day" }), shown, slider, about),
      knob(make("label", { htmlFor: date.id, textContent: "Date" }), date),
      make("div", { className: "debug-choices" }, sunrise, sunset),
      list,
    ],
    first: rates[0]!.button,
    live,
  }
}

/**
 * The Weather area's regime line for the game's `weather` at UTC second `seconds`, the regime the store holds it at (null: Auto) and
 * the one it moves toward (`SkyStore.heading`): the regime and when the day's plan may next change it, or its hold, or, while the game
 * has not taken what the store sent (the full map or the settings pause it), what it takes on resume.
 */
export const regimeText = (
  weather: Pick<SkyViewModel["weather"], "regime" | "forced" | "plan">,
  pinned: Regime | null,
  heading: Regime,
  seconds: number,
): string => {
  const label = REGIME_SPECS[heading].label
  if (pinned !== (weather.forced ? weather.regime : null) || heading !== weather.regime)
    return `${label}, ${pinned === null ? "left to chance" : "held"} (on resume)`
  return weather.forced
    ? `${label}, held`
    : `${label}, next change in ${spanText(untilChange(weather.plan, seconds))}`
}

/** What "Auto" does. */
const AUTO =
  "The weather left to chance: each day is drawn from the month's odds with the weather seed, and its plan sets the regime hour by hour."

/**
 * The Weather area: the regime held (or Auto), "Settle now", the weather now at the player (where `here` stands, z m a.s.l., when there
 * is a player), the weather seed, and this month's odds, snowfall at the player's height (the map's low ground before there is one).
 */
export const weatherArea = (
  make: Make,
  sky: SkyStore,
  here: () => { readonly x: number; readonly y: number; readonly z: number } | undefined,
): Area => {
  const choices = [null, ...REGIMES].map((regime) => {
    const button = make("button", {
      type: "button",
      id: `debug-weather-${regime ?? "auto"}`,
      textContent: regime === null ? "Auto" : REGIME_SPECS[regime].label,
      title: regime === null ? AUTO : REGIME_SPECS[regime].description,
    })
    button.addEventListener("click", () => sky.force(regime))
    return { regime, button }
  })
  const showRegime = () => {
    for (const { regime, button } of choices) button.ariaPressed = String(regime === sky.regime())
  }
  sky.subscribe(showRegime)
  showRegime()
  const settle = make("button", {
    type: "button",
    id: "debug-weather-settle",
    textContent: "Settle now",
  })
  const about = make("p", {
    id: "debug-weather-settle-about",
    textContent:
      "Jumps the weather to where its regime settles: every value at its target, the roads soaked or dry, the season's snow line for the date, or snow down to the freezing level where it falls.",
  })
  settle.setAttribute("aria-describedby", about.id)
  settle.addEventListener("click", () => sky.settle())
  const { list, values } = readouts(make, {
    regime: "Regime",
    air: "Air here",
    ground: "Ground",
    snowLine: "Snow line",
    wind: "Wind here",
    sky: "Sky",
    seed: "Weather seed",
  })
  const odds = readouts(make, ODDS),
    oddsTitle = make("h4", { textContent: "Odds" }),
    oddsAbout = make("p")
  const live = () => {
    const { seconds, weather } = sky.now(),
      at = here()
    set(values.regime, regimeText(weather, sky.regime(), sky.heading(), seconds))
    set(values.snowLine, snowLineText(weather.snowLine))
    set(values.seed, seedText(weather.seed))
    const shown = oddsReadout(seconds, at?.z ?? place().floor)
    set(oddsTitle, shown.title)
    set(oddsAbout, shown.about)
    for (const key of Object.keys(ODDS) as Array<keyof DayOdds>)
      set(odds.values[key], shown.rows[key])
    if (at === undefined) return
    const { x, y, z } = at,
      conditions = conditionsAt(seconds, weather, x, y, z)
    const falling = fallingText(conditions.rain, conditions.snow)
    set(
      values.air,
      `${conditions.celsius.toFixed(1)} °C at ${Math.round(z)} m${falling === "" ? "" : `, ${falling}`}`,
    )
    set(values.ground, `wet ${conditions.wet.toFixed(2)}, snow ${conditions.snowCover.toFixed(2)}`)
    set(values.wind, windText(windAt(weather, z), weather.gust))
    set(
      values.sky,
      `cloud ${weather.cloud.toFixed(2)}, fog here ${conditions.fog.toFixed(2)}, storm ${weather.storm.toFixed(2)}`,
    )
  }
  return {
    title: "Weather",
    nodes: [
      make("div", { className: "debug-choices" }, ...choices.map(({ button }) => button)),
      make("div", { className: "debug-settle" }, settle, about),
      list,
      oddsTitle,
      oddsAbout,
      odds.list,
    ],
    first: choices[0]!.button,
    live,
  }
}
