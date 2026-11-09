/**
 * What the weather is at one point of the map: the air's temperature, the rain and snow falling, how wet
 * and how white the ground is, the fog, and the wind. Pure functions of the game time, the `Weather`
 * resource and a position (x east, y north, z m a.s.l.); the physics, the traffic, the render, the audio
 * and the HUD all read the weather through them.
 *
 * @module local
 */
import { Ops } from "@typeonce/ritmo-math"

import type { WeatherValue } from "../schema.ts"
import { romeDay } from "./calendar.ts"
import { type Air, airAt, celsiusAt, NO_SNOW, orographic, snowShare } from "./climate.ts"
import { place } from "./place.ts"

/** The ground under a wheel or a foot: how wet (0…1, where no snow lies) and how snow-covered (0…1). */
export interface GroundWeather {
  readonly wet: number
  readonly snow: number
}
/** Dry, bare ground. */
export const DRY: GroundWeather = { wet: 0, snow: 0 }

/** A whole-number hash of lattice point (i, j) to [−1, 1): 32-bit integer arithmetic only, so a shader with `uint` maths gets the same value. */
const lattice = (i: number, j: number): number => {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 2147483648 - 1
}

/** Smooth value noise in [−1, 1] over a lattice of `cell` m. */
const noise = (x: number, y: number, cell: number): number => {
  const fx = x / cell,
    fy = y / cell,
    i = Math.floor(fx),
    j = Math.floor(fy)
  const tx = fx - i,
    ty = fy - j,
    sx = tx * tx * (3 - 2 * tx),
    sy = ty * ty * (3 - 2 * ty)
  const south = lattice(i, j) + (lattice(i + 1, j) - lattice(i, j)) * sx
  const north = lattice(i, j + 1) + (lattice(i + 1, j + 1) - lattice(i, j + 1)) * sx
  return south + (north - south) * sy
}

/** The snow line's ragged edge: two octaves of value noise, ±45 m over 80 m cells and ±15 m over 20 m cells (render's snow draws the same). */
export const EDGE = [
  { cell: 80, height: 45 },
  { cell: 20, height: 15 },
] as const
/** The snow cover fades in over this many metres of height to either side of its edge. */
export const FEATHER = 10
/** Below the snow's edge meltwater wets a band this many metres deep where the air is above freezing, fully from `MELT_FULL` °C. */
export const MELT_BAND = 100
/** The air's temperature (°C) from which the meltwater band is fully wet; it wets in proportion from 0 °C up. */
export const MELT_FULL = 1
/** How far the snow's edge reaches either side of the snow line, m: its wander (the EDGE heights) and its fade (FEATHER). */
const REACH = EDGE.reduce((sum, { height }) => sum + height, 0) + FEATHER
/**
 * How much lower the snow line stands on a face, m for each unit of its normal's north part (higher on a south face): the fit
 * across slopes of NASA's MODIS snow cover over Lunigiana (climate.ts, `SNOW_SEASON`), one slope with an intercept per half-month,
 * over November to March: −436. It runs from about −850 in December and January, when the low sun leaves north faces in shade all
 * day, to about 0 in March. A 30° north face (its normal 0.5 north) holds snow 220 m lower than level ground.
 */
export const SNOW_ASPECT = 440
/**
 * How far the snow line can stand over ground its edge still reaches, m: on a face looking due north (bare rock included), at the
 * edge's highest reach; a face looking due south has its edge as far over the line. It bounds the meltwater band and the ground
 * the snow line can touch at all.
 */
export const HIGHEST_SNOW = SNOW_ASPECT + REACH
/** Faces steeper than this (their normal's up part below it, about 50°) are bare rock: the terrain paints them so and no snow lies on them. */
export const ROCK_NORMAL_Y = 0.64
/**
 * How far the snow line can stand over ground that still holds snow, m: the steepest face that holds any (its normal's up part at
 * `ROCK_NORMAL_Y`, 0.77 north), at the edge's highest reach. A line this far over the map's top leaves none on it.
 */
export const SNOW_REACH = SNOW_ASPECT * Math.sqrt(1 - ROCK_NORMAL_Y * ROCK_NORMAL_Y) + REACH
/** Snow settles fully on faces whose normal's up part is above this; it thins out down to the bare rock (`ROCK_NORMAL_Y`). */
export const SNOW_SETTLES = 0.8

/** How many metres the snow line's edge stands lower at (x, y) (a fixed, world-locked pattern, the same every game; negative where it stands higher). */
export const snowEdge = (x: number, y: number): number =>
  EDGE.reduce((sum, { cell, height }) => sum + height * noise(x, y, cell), 0)

/** `x` past `from` toward `to`, smoothed, 0…1 (GLSL's `smoothstep`). */
const smooth = (from: number, to: number, x: number): number => {
  const s = Math.max(0, Math.min(1, (x - from) / (to - from)))
  return s * s * (3 - 2 * s)
}

/** How much snow covers ground `above` m over the snow line's ragged edge: none below it, all of it above, fading over ±`FEATHER` m. */
const coverAbove = (above: number): number => smooth(-FEATHER, FEATHER, above)

/** Which way the ground faces: the north and up parts of its unit normal. */
export interface Facing {
  readonly north: number
  readonly up: number
}
/** Level ground: what a road, a bridge deck, a platform or a tunnel's floor counts as. */
export const LEVEL: Facing = { north: 0, up: 1 }
/** Which way the ground at a point faces (`facingAt` in src/sim/map/ground-model.ts gives the map's; it reads the tiles there). */
export type FacingAt = (x: number, y: number, near: number) => Facing
/** Level ground everywhere: for points off the map's tiles in memory, or where the slope does not matter. */
const levelGround: FacingAt = () => LEVEL

/** How many metres ground at (x, y, z) facing `face` stands over the snow line's edge under a snow line at `snowLine` m a.s.l. */
const overEdge = (snowLine: number, x: number, y: number, z: number, face: Facing): number =>
  z + snowEdge(x, y) + SNOW_ASPECT * face.north - snowLine

/** How much of a face's cover settles on it, by its normal's up part: all of it on gentle ground, none on bare rock. */
const settles = (face: Facing): number => smooth(ROCK_NORMAL_Y, SNOW_SETTLES, face.up)

/**
 * How much snow covers ground at (x, y, z) under a snow line at `snowLine` m a.s.l., the ground facing as `facing` says (level by
 * default): 0 below its ragged edge, which stands lower on north faces, 1 above it, thinning out on faces steep toward bare rock.
 */
export const snowCoverAt = (
  snowLine: number,
  x: number,
  y: number,
  z: number,
  facing: FacingAt = levelGround,
): number => {
  if (snowLine >= NO_SNOW || z < snowLine - HIGHEST_SNOW) return 0
  const face = facing(x, y, z)
  return coverAbove(overEdge(snowLine, x, y, z, face)) * settles(face)
}

/**
 * The ground at (x, y, z) under `weather`, the air `air` (`airAt`), facing as `facing` says (level by default): snow above the snow
 * line's ragged edge, which stands `SNOW_ASPECT` lower on north faces and thins out on faces steep toward bare rock (what the renderer
 * draws, src/render/sky/surface.ts); where none lies, the weather's wetness, and, where the air at z is above freezing, wetter toward
 * the edge from `MELT_BAND` m below it, where meltwater runs (only there: the snowmelt wets no other ground). In a frost the ground
 * below the snow stays as dry as the weather left it.
 */
export const groundAt = (
  weather: Pick<WeatherValue, "wet" | "snowLine">,
  x: number,
  y: number,
  z: number,
  air: Air,
  facing: FacingAt = levelGround,
): GroundWeather => {
  const { snowLine, wet } = weather
  if (snowLine >= NO_SNOW || z < snowLine - HIGHEST_SNOW - MELT_BAND)
    return wet === 0 ? DRY : { wet, snow: 0 }
  const face = facing(x, y, z),
    above = overEdge(snowLine, x, y, z, face),
    cover = coverAbove(above)
  const thaw = Math.max(0, Math.min(1, celsiusAt(air, z) / MELT_FULL)),
    lies = cover * settles(face)
  // The ground the snow leaves bare (a face too steep for it to settle on) takes the weather's wet.
  return {
    wet: Math.max(wet, thaw * Math.max(0, Math.min(1, 1 + above / MELT_BAND))) * (1 - lies),
    snow: lies,
  }
}

/** The fog over the map: the low ground's fog up to `valleyTop` m a.s.l. at `valleyDensity` (0…1), and the cloud down to `cloudBase` m a.s.l. at `cloudDensity` (0…1). */
export interface FogLayers {
  readonly valleyTop: number
  readonly valleyDensity: number
  readonly cloudBase: number
  readonly cloudDensity: number
}

/**
 * The cloud base, m above the map's low ground (`place().floor`): far above the hills under a clear sky, lower as the cover thickens,
 * a thunderstorm's raised again, and down to a low stratus in thick mist. Each regime settles on its own: clear 2325, cloudy 1425,
 * overcast 975, rain 900, storm 1150, fog 350. Design values: they keep the low ground out of the cloud in rain and in a storm, and
 * hills 1500 m above it in the cloud under any full cover (weather.test.ts).
 */
const BASE = { clear: 2400, cover: 1500, storm: 250, stratus: 700 } as const
/** Inside the cloud the fog reaches this much of its full thickness, all of it in thick mist (the fog regime). */
const CLOUD_FOG = 0.6
/** Radiation fog stands up to this high over the map's low ground (m), a stratus up to this high for each unit of the regime's mist. */
const FOG_TOP = { radiation: 150, stratus: 450 } as const

/**
 * The fog layers at UTC second `t` under `weather`. Radiation fog fills the low ground up to `FOG_TOP.radiation` over the map's floor
 * on the mornings the day's plan brings it (plan.ts), while the sky stays clear and the air calm: it forms from 01:00, is thickest
 * from 05:00 and burns off from 09:00 to 11:00 local time. The fog regime's low stratus fills it up to `FOG_TOP.stratus` × its mist.
 * Above the cloud base (`BASE`) the hill fog is `CLOUD_FOG` thick under a full cover, thick fog only in the fog regime's mist.
 */
export const fogLayers = (
  t: number,
  weather: Pick<WeatherValue, "cloud" | "storm" | "wind" | "fog" | "plan">,
): FogLayers => {
  const { day, second } = romeDay(t),
    hour = second / 3600,
    { floor } = place(),
    { plan } = weather
  const clear = 1 - smooth(0.25, 0.55, weather.cloud),
    calm = 1 - smooth(2, 3.5, weather.wind)
  const radiation =
    plan.drawn && plan.day === day && plan.fog === "morning"
      ? clear * calm * smooth(1, 5, hour) * (1 - smooth(9, 11, hour))
      : 0
  const valleyTop = floor + Math.max(FOG_TOP.radiation * radiation, FOG_TOP.stratus * weather.fog),
    mist = smooth(0.3, 0.9, weather.fog)
  return {
    valleyTop,
    valleyDensity: Math.max(radiation, weather.fog),
    cloudBase:
      floor +
      BASE.clear -
      BASE.cover * weather.cloud +
      BASE.storm * weather.storm -
      BASE.stratus * mist,
    cloudDensity: smooth(0.5, 0.9, weather.cloud) * (CLOUD_FOG + (1 - CLOUD_FOG) * mist),
  }
}

/** How thick the fog is at `z` m a.s.l. in `layers`, 0…1: the low ground's fog below its top, the cloud's above its base, each fading in over 50 m. */
export const fogAt = (layers: FogLayers, z: number): number =>
  Math.max(
    layers.valleyDensity * (1 - smooth(layers.valleyTop - 50, layers.valleyTop, z)),
    layers.cloudDensity * smooth(layers.cloudBase, layers.cloudBase + 50, z),
  )

/** What the weather is like at one point: air temperature (°C), rain and snow falling (mm/h liquid-equivalent), ground wetness and snow cover (0…1), fog (0…1). */
export interface Conditions {
  readonly celsius: number
  readonly rain: number
  readonly snow: number
  readonly wet: number
  readonly snowCover: number
  readonly fog: number
}

/** The conditions at (x, y, z) at UTC second `t` under `weather`. */
export const conditionsAt = (
  t: number,
  weather: WeatherValue,
  x: number,
  y: number,
  z: number,
): Conditions => {
  const air = airAt(t, weather),
    celsius = celsiusAt(air, z),
    falling = weather.precip * orographic(z),
    share = snowShare(celsius)
  const ground = groundAt(weather, x, y, z, air)
  return {
    celsius,
    rain: falling * (1 - share),
    snow: falling * share,
    wet: ground.wet,
    snowCover: ground.snow,
    fog: fogAt(fogLayers(t, weather), z),
  }
}

/**
 * How much stronger the wind blows on exposed ground than on the map's low ground: ×1 at its floor, rising in a straight line to ×2.5
 * 1550 m above it. A national design value, ×2–2.5 on crests: the Aeronautica Militare's exposed capes, islands and hill stations see a
 * wind over 20 knots about three times as often as its lowland airports (2.7–3.9 by month; Atlante Climatico 1971–2000).
 */
const WIND_UP = { over: 1550, most: 2.5 } as const

/** The wind at `z` m a.s.l. under `weather`, m/s (x east, y north: the way the air moves): the low ground's, stronger on exposed ground (`WIND_UP`). */
export const windAt = (
  weather: Pick<WeatherValue, "wind" | "windAngle">,
  z: number,
): { readonly x: number; readonly y: number } => {
  const speed =
    weather.wind *
    Math.max(
      1,
      Math.min(WIND_UP.most, 1 + ((WIND_UP.most - 1) * (z - place().floor)) / WIND_UP.over),
    )
  return { x: Ops.cos(weather.windAngle) * speed, y: Ops.sin(weather.windAngle) * speed }
}
