/**
 * How the time of day and the weather at the ears move the valley's sounds, as plain laws the
 * world part applies: the masking floor falls from the rural day's to the night's as dusk ends;
 * songbirds sing by the sun (a dawn chorus before sunrise, a last round at dusk, nothing at night)
 * and fall quiet in rain; the tawny owl calls once it is dark; the wind blows as much harder as the
 * weather's does, in its gusts; and rain is heard as a bed outside and as the roof's drumming inside
 * a car. Under the defaults the director's tests use (a 10:10 sun 22° up, dry, the usual wind) each
 * law is the identity, so the day sounds as it did before the weather.
 *
 * @module audio/director/sky
 */
import type { WeatherValue } from "../../sim/schema.ts"
import { AMBIENT_DB, CABIN, dbToGain, mixGain, NIGHT_DB, sumDb } from "../acoustics.ts"
import { smoothstep } from "../buffers.ts"
import { unit } from "../synth/graph.ts"
import { rainQuiet } from "../synth/rain.ts"
import type { CabinModel } from "../types.ts"
import type { Hearing } from "./hearing.ts"
import { rainDb, roofDb } from "./levels.ts"

/** The masking floor at its stillest, dB(A), with the sun `sun`° up: the rural day's, down to the night's as dusk ends (0° … −10°). */
export const floorDb = (sun: number): number =>
  NIGHT_DB + (AMBIENT_DB - NIGHT_DB) * smoothstep(-10, 0, sun)

/** The dawn chorus at its fullest (from just before sunrise to 5° up) is this many times the day's song; dusk's last round, `DUSK`. */
const DAWN = 1.5,
  DUSK = 0.3

/**
 * How busy the songbirds are, × the day's: with the sun `sun`° up in the `morning` (or the afternoon), in `rain` mm/h. Robins
 * start at −7°, the rest by −3°, all at their loudest from −1° to +5° and back to the day's by +15° (Thomas et al. 2002); at dusk a
 * last round of calls, all roosting under −6°; heavy rain silences them.
 */
export const birdActivity = (sun: number, morning: boolean, rain: number): number => {
  const awake = morning ? smoothstep(-8, -3, sun) : smoothstep(-6, -1, sun)
  const chorus = morning
    ? DAWN * smoothstep(-5, -1, sun) * (1 - smoothstep(5, 15, sun))
    : DUSK * smoothstep(-3, 1, sun) * (1 - smoothstep(3, 8, sun))
  return awake * (1 + chorus) * (1 - smoothstep(0.5, 8, rain))
}

/** How busy the tawny owls are, 0…1: from 10–20 minutes after sunset (the sun 2–6° under) until as long before sunrise, silent in heavy rain. */
export const owlActivity = (sun: number, rain: number): number =>
  (1 - smoothstep(-6, -2, sun)) * (1 - smoothstep(0.5, 4, rain))

/** The low-ground wind the wind's law was tuned for, m/s at 10 m: a cloudy day's, a little over the weather's mean (2.5 m/s in October on the shipped map, 2.4–2.8 by month). */
export const USUAL_WIND = 3

/** How much harder than usual `weather` blows: its low-ground wind over `USUAL_WIND` (the wind's strength scales with speed, level with its square). */
export const windFactor = (weather: Pick<WeatherValue, "wind">): number =>
  Math.max(0, weather.wind) / USUAL_WIND

/** The wind voice's gustiness from the weather's gust factor (peak over mean): 1.5, open ground's, is the valley's usual (`VALLEY_GUSTS`), 2 and over squalls. */
export const gustsOf = (weather: Pick<WeatherValue, "gust">): number => unit(weather.gust - 1)

/** Rain lighter than this (mm/h) is a drizzle too fine to hear: no bed. */
export const RAINING = 0.1

/** The rain at `rate` mm/h as heard at the ears, dB(A): the bed outside, or the bed through `inside`'s cabin and the drumming on its roof. */
export const rainHeard = (rate: number, inside: CabinModel | undefined): number =>
  rate < RAINING
    ? -Infinity
    : inside === undefined
      ? rainDb(rate)
      : sumDb([rainDb(rate) - CABIN[inside].loss, roofDb(rate)])

/** Rain at `rate` mm/h drumming on the roof of the car the listener sits in: at the seat, centred, through no cabin (the roof radiates inside), like the own engine. */
export const roofHearing = (rate: number): Hearing => ({
  placement: {
    gain: mixGain(roofDb(rate), 0) * dbToGain(rainQuiet(rate)),
    pan: 0,
    cutoff: 20000,
    cents: 0,
    wet: 0,
  },
  level: roofDb(rate),
  audible: true,
  r: 0,
  delay: 0,
})
