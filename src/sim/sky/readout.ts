/**
 * The weather in one word, for the HUD's readout beside the clock: what a person standing at a point
 * sees (the rain or snow falling there, the fog around them), not just the regime the weather is moving
 * toward. Pure and map-free.
 *
 * @module readout
 */
import type { WeatherValue } from "../schema.ts"
import type { Conditions } from "./local.ts"

/** The readout's words. */
const WEATHER_WORDS = [
  "Clear",
  "Fair",
  "Cloudy",
  "Overcast",
  "Fog",
  "Drizzle",
  "Rain",
  "Sleet",
  "Snow",
  "Storm",
  "Windy",
] as const
/** A readout word. */
export type WeatherWord = (typeof WEATHER_WORDS)[number]

/**
 * Thresholds: a thunderstorm needs this activity and this much falling (mm/h); rain or snow from this much, drizzle (or a few flakes)
 * from this; snow when this share of what falls is snow, sleet between the two shares; fog from this thickness; windy from this
 * wind on low ground, up to 98 m a.s.l. (m/s); and the sky's cover (0…1) up to which it reads clear, fair or cloudy.
 */
const STORM = { activity: 0.3, falling: 0.5 } as const
const FALLING = { steady: 0.2, drizzle: 0.02 } as const
const SNOWY = { snow: 0.7, sleet: 0.3 } as const
const FOGGY = 0.5
const WINDY = 7
const COVER = { clear: 0.2, fair: 0.5, cloudy: 0.85 } as const

/**
 * The word for the weather where the conditions `here` hold (`conditionsAt` at the player) under `weather`: a thunderstorm, then
 * what falls (rain, sleet or snow), then fog, then drizzle, then a strong wind, else the sky's cover.
 */
export const describeWeather = (
  weather: Pick<WeatherValue, "cloud" | "storm" | "wind">,
  here: Pick<Conditions, "rain" | "snow" | "fog">,
): WeatherWord => {
  const falling = here.rain + here.snow,
    snowy = falling > 0 ? here.snow / falling : 0
  if (weather.storm >= STORM.activity && falling >= STORM.falling) return "Storm"
  if (falling >= FALLING.steady)
    return snowy >= SNOWY.snow ? "Snow" : snowy > SNOWY.sleet ? "Sleet" : "Rain"
  if (here.fog >= FOGGY) return "Fog"
  if (falling >= FALLING.drizzle) return snowy >= SNOWY.snow ? "Snow" : "Drizzle"
  if (weather.wind >= WINDY) return "Windy"
  return weather.cloud < COVER.clear
    ? "Clear"
    : weather.cloud < COVER.fair
      ? "Fair"
      : weather.cloud < COVER.cloudy
        ? "Cloudy"
        : "Overcast"
}
