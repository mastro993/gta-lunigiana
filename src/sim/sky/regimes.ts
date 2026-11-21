/**
 * The weather's closed sets: the regimes and what each is like (the targets the `Weather` resource
 * eases toward under it, with a name and a description for the menus), and the words a day's plan is
 * made of (its event, its sky, its rain's intensity, its fog). Imports no data, so the schema, the HUD
 * and the audio lab read it without decoding the map.
 *
 * @module regimes
 */

/** The weather regimes, in menu order. */
export const REGIMES = [
  "clear",
  "fair",
  "cloudy",
  "overcast",
  "fog",
  "rain",
  "storm",
  "windy",
  "snow",
] as const
/** A weather regime. */
export type Regime = (typeof REGIMES)[number]

/** Where a regime's wind blows: the air moving toward the north-east (a south-westerly off the sea), toward the south-west (a cold northerly or north-easterly), or the breeze along the map's slope. */
type Flow = "northeast" | "southwest" | "breeze"

/** One regime: its name and what it is like in the menus, and the targets its weather eases toward. */
export interface RegimeSpec {
  readonly label: string
  readonly description: string
  /** Sky cover, 0…1. */
  readonly cloud: number
  /** Precipitation at sea level, mm/h liquid-equivalent (`orographic` scales it with height): it starts once the cloud cover passes 0.7. A day's plan sets its own rate for its rain; the wet regimes' are about the plan's mean rates (plan.ts). */
  readonly precip: number
  /** Thunderstorm activity, 0…1: how often lightning strikes. */
  readonly storm: number
  /** Wind at 10 m on low ground (up to 98 m a.s.l.: `WIND_UP` in local.ts), m/s, where it blows, and its gust factor (peak over mean). */
  readonly wind: number
  readonly flow: Flow
  readonly gust: number
  /** Mist and low cloud, 0…1. */
  readonly fog: number
  /** How much colder (negative) or warmer the regime's air runs than the day's air mass, °C. */
  readonly anomaly: number
}

/** Precipitation and thunderstorms start only under more cloud than this: a sky this thick is ready to rain. */
export const RAINS_FROM = 0.7

/** Every regime; the targets are design values. A windy day's wind blows over 20 knots (10.3 m/s) on the low ground, as the strong-wind days the odds count do (odds.ts). */
export const REGIME_SPECS = {
  clear: {
    label: "Clear",
    description:
      "A clear sky and a light breeze, up the slopes by day and down them at night: hot afternoons, cold nights, and fog on the low ground on calm mornings.",
    cloud: 0.05,
    precip: 0,
    storm: 0,
    wind: 1.5,
    flow: "breeze",
    gust: 1.4,
    fog: 0,
    anomaly: 0,
  },
  fair: {
    label: "Fair",
    description:
      "Sunshine between scattered fair-weather clouds and a gentle breeze; on a summer's day the clouds tower into an afternoon thunderstorm.",
    cloud: 0.3,
    precip: 0,
    storm: 0,
    wind: 2.5,
    flow: "breeze",
    gust: 1.5,
    fog: 0,
    anomaly: 0,
  },
  cloudy: {
    label: "Cloudy",
    description:
      "Mostly cloudy with sunny spells and a south-westerly breeze off the sea; a summer thunderstorm towers out of it and leaves it behind.",
    cloud: 0.65,
    precip: 0,
    storm: 0,
    wind: 3,
    flow: "northeast",
    gust: 1.5,
    fog: 0,
    anomaly: 0,
  },
  overcast: {
    label: "Overcast",
    description:
      "A grey, low sky that hides the high ground, with spells of light drizzle that slowly wet the roads; a day of frontal rain stays like this around it.",
    cloud: 0.95,
    precip: 0.03,
    storm: 0,
    wind: 2.5,
    flow: "northeast",
    gust: 1.4,
    fog: 0.15,
    anomaly: 0,
  },
  fog: {
    label: "Fog",
    description:
      "Calm, damp air under a low stratus: thick fog on the low ground and cloud on the hills, until it lifts.",
    cloud: 0.9,
    precip: 0,
    storm: 0,
    wind: 0.6,
    flow: "breeze",
    gust: 1.3,
    fog: 0.9,
    anomaly: 0,
  },
  rain: {
    label: "Rain",
    description:
      "Steady frontal rain on a mild south-westerly wind off the sea, heavier on the mountains; the roads get wet and slippery.",
    cloud: 1,
    precip: 2,
    storm: 0,
    wind: 5,
    flow: "northeast",
    gust: 1.7,
    fog: 0.3,
    anomaly: 0,
  },
  storm: {
    label: "Thunderstorm",
    description:
      "A thunderstorm cell drifting over the map: downpours, gusts and lightning, coming closer, passing overhead and moving away.",
    cloud: 1,
    precip: 5,
    storm: 1,
    wind: 6,
    flow: "northeast",
    gust: 2.3,
    fog: 0.2,
    anomaly: 0,
  },
  windy: {
    label: "Windy",
    description:
      "A dry, gusty northerly or north-easterly wind with a clear, sharp sky and colder air.",
    cloud: 0.2,
    precip: 0,
    storm: 0,
    wind: 11,
    flow: "southwest",
    gust: 1.8,
    fog: 0,
    anomaly: -2,
  },
  snow: {
    label: "Snow",
    description:
      "A cold front: steady precipitation in cold northerly air, snow on the high ground while the low ground gets sleet or rain; out of winter only a cold rain.",
    cloud: 1,
    precip: 1.5,
    storm: 0,
    wind: 4,
    flow: "southwest",
    gust: 1.6,
    fog: 0.4,
    anomaly: -2.5,
  },
} as const satisfies Record<Regime, RegimeSpec>

/** Whether `value` names a regime. */
export const isRegime = (value: unknown): value is Regime =>
  typeof value === "string" && (REGIMES as ReadonlyArray<string>).includes(value)

/** A wet day's event: the regime its rain comes in (frontal rain, a thunderstorm, or a cold front's snow). */
export const EVENTS = ["rain", "storm", "snow"] as const satisfies ReadonlyArray<Regime>
/** A day's sky: a dry day's regime, and a wet day's around its rain. */
export const SKIES = [
  "clear",
  "fair",
  "cloudy",
  "overcast",
] as const satisfies ReadonlyArray<Regime>
/** How much a wet day brings at sea level: ordinary (1–10 mm), heavy rain (10–20 mm) or a rainstorm (20 mm or more). */
export const INTENSITIES = ["ordinary", "heavy", "rainstorm"] as const
/** A dry day's fog: none, a radiation-fog morning (on a clear, calm night), or a low stratus (the fog regime) until it lifts. */
export const FOGS = ["none", "morning", "stratus"] as const
