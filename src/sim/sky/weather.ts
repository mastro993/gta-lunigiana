/**
 * The weather: each Rome day the `Weather` resource draws a plan of the day from Italy's odds at the
 * map's latitude (plan.ts), and moves toward the regime the plan sets for each hour, every value easing
 * toward the regime's targets over game time; the ground's wetness and snow line under it; and the
 * thunderstorm cell that drifts over the map and throws lightning, in real time. Pure functions: the
 * systems in `systems/sky.ts` call them with the world's values and its `WeatherRng`, and the dev menu's
 * weather requests are checked here (`setWeather`; the clock's in clock.ts). It reads the map (its heights
 * and bounds); the regimes (regimes.ts), the plan (plan.ts) and the clock (clock.ts) do not.
 *
 * @module weather
 */
import { Ops, type Random } from "@typeonce/ritmo-math"

import { MAP } from "../map/index.ts"
import type { LightningValue, WeatherValue } from "../schema.ts"
import type { SunPlace } from "./astro.ts"
import { romeDay } from "./calendar.ts"
import {
  airAt,
  celsiusAt,
  dailyMean,
  freezingLevel,
  normalsAt,
  NO_SNOW,
  orographic,
  rainCooling,
} from "./climate.ts"
import { sunOver } from "./day.ts"
import { place } from "./place.ts"
import { calmPlan, dayWarmth, planFor, rainingAt, regimeAt } from "./plan.ts"
import { isRegime, RAINS_FROM, type Regime, REGIME_SPECS } from "./regimes.ts"

/** Where the synoptic flows blow toward, rad: a south-westerly off the sea toward the north-east, a cold northerly or north-easterly toward the south-west. */
const TOWARD = { northeast: Math.PI / 4, southwest: (-3 * Math.PI) / 4 } as const

/** The sun's elevation above which the breeze blows up the map's slope (down it below), degrees. */
const BREEZE_TURNS = 0

/** Where the air moves in `regime` with the sun at `elevation` degrees, rad counter-clockwise from east: a breeze up the map's slope by day and down it at night (`place().downslope`), else its flow. */
const windToward = (regime: Regime, elevation: number): number => {
  const { flow } = REGIME_SPECS[regime],
    { downslope } = place()
  return flow === "breeze"
    ? elevation > BREEZE_TURNS
      ? downslope - Math.PI
      : downslope
    : TOWARD[flow]
}

/** Game seconds over which each value eases toward its target (a time constant). */
const EASE = {
  cloud: 1800,
  precip: 1200,
  storm: 900,
  wind: 1200,
  fog: 1800,
  anomaly: 3600,
} as const

/** The map's lowest and highest ground, m a.s.l. (its tiles' lowest and highest nodes, in decimetres). */
const BOTTOM = Math.min(...MAP.tiles.map((t) => t.zmin)) / 10,
  TOP = Math.max(...MAP.tiles.map((t) => t.zmax)) / 10
/** The snow line never falls below this, m a.s.l.: just under the lowest ground, so all of it can lie white. */
const LOWEST_SNOW = BOTTOM - 50

/**
 * Ground wetness: rain reaching the ground wets it with τ 10 game minutes from 2 mm/h, proportionally slower in less; it dries
 * with τ between 2 and 6 game hours (faster warm, sunny and windy), less while it drizzles and not at all from `DRIZZLE` mm/h. Where
 * the two balance it settles: overcast drizzle (0.03 mm/h) slowly damps the roads, to about 0.3 in six game hours, toward 0.35–0.45
 * (weather.test.ts). Snowmelt wets only the band just under the snow (`groundAt`, local.ts), not the map's wetness.
 */
const WETTING = 600
const PRECIP_FULL = 2
const DRYING = { slow: 21600, fast: 7200 } as const
/** Precipitation (mm/h) beyond drizzle: from it the ground no longer dries, and falling snow settles and brings the snow line down (a few flakes do not). */
const DRIZZLE = 0.05
/** Long enough for any wetness to reach its balance, game seconds (finite: no Infinity in the simulation). */
const SETTLED = 1e9
/**
 * The snow line: falling toward the freezing level at this many m per game second for each mm/h of
 * precipitation (150 m an hour), and rising by a degree-day melt at this many m per game second for
 * each °C above 0 at the line (1 m an hour), twice that under rain. Design values: Capozzi et al.
 * (2025, The Cryosphere 19:565, CC BY 4.0) count 12.9, 22.0, 33.4 and 59.4 snow-cover days from
 * November to April at 648, 815, 1000 and 1290 m in the central and southern Apennines; near 42 N
 * the snow lies on 0.6–0.9 of them (calibration.test.ts), as many as its snowfall days reach of theirs.
 */
const SNOWING = 150 / 3600
const MELTING = 1 / 3600

/** A storm cell far off the map: no storm near. */
const FAR = 100000

/** The snow line a new game starts with at UTC second `t`: where the day's mean normal is 0 °C, none when that lies above the map. */
const startingSnowLine = (t: number): number => {
  const normals = normalsAt(t),
    zero = (1000 * dailyMean(normals, 0)) / normals.lapse
  return zero >= TOP ? NO_SNOW : Math.max(LOWEST_SNOW, zero)
}

/**
 * The weather a new game starts with at UTC second `t`, from the weather seed `seed` (`WeatherRng`'s first state): clear and calm, at
 * the clear regime's targets with no anomaly, dry ground under the season's snow line, no storm near, and a plan the first step draws
 * that keeps the calm for 90 game minutes.
 */
export const initialWeather = (t: number, seed: number): WeatherValue => {
  const spec = REGIME_SPECS.clear
  return {
    seed,
    regime: "clear",
    forced: false,
    cloud: spec.cloud,
    precip: 0,
    storm: 0,
    wind: spec.wind,
    windAngle: windToward("clear", sunOver(t).elevation),
    gust: spec.gust,
    fog: spec.fog,
    anomaly: 0,
    wet: 0,
    snowLine: startingSnowLine(t),
    cellX: FAR,
    cellY: FAR,
    plan: calmPlan(t),
  }
}

/** `value` eased toward `target` over `seconds` with time constant `tau` (exact for any step). */
const ease = (value: number, target: number, seconds: number, tau: number): number =>
  value + (target - value) * (1 - Ops.exp(-seconds / tau))

/** `angle` turned toward `target` the short way round, eased like `ease`, kept in [−π, π). */
const easeAngle = (angle: number, target: number, seconds: number, tau: number): number => {
  const gap = target - angle - 2 * Math.PI * Math.floor((target - angle + Math.PI) / (2 * Math.PI))
  const next = angle + gap * (1 - Ops.exp(-seconds / tau))
  return next - 2 * Math.PI * Math.floor((next + Math.PI) / (2 * Math.PI))
}

/**
 * What `weather`'s regime eases toward at UTC second `t` under `cloud`: its targets, the day's rain at the plan's rate while it falls in
 * its own regime (none until the cloud passes `RAINS_FROM`), and the air at the day's air mass, warmed or cooled by the day
 * (`dayWarmth`) and the regime, and cooled by what falls.
 */
const targetsOf = (weather: Pick<WeatherValue, "regime" | "plan">, t: number, cloud: number) => {
  const { regime, plan } = weather,
    spec = REGIME_SPECS[regime],
    raining = cloud > RAINS_FROM
  const precip = raining
    ? regime === plan.event && rainingAt(plan, t)
      ? plan.precip
      : spec.precip
    : 0
  return {
    ...spec,
    precip,
    storm: raining ? spec.storm : 0,
    anomaly: plan.airMass + dayWarmth(plan) + spec.anomaly - rainCooling(precip),
  }
}

/**
 * The plan in force for `weather` at UTC second `t`: its own while its Rome day lasts (a new game's calm plan too, until its first step),
 * else the day the clock is on, the clock stopped or not, so a dev request or a stopped clock's sky reads that day's plan.
 */
const planOn = (weather: WeatherValue, t: number): WeatherValue["plan"] =>
  romeDay(t).day === weather.plan.day ? weather.plan : planFor(weather.plan, t, weather.seed)

/**
 * The weather after `rate` game seconds ending at UTC second `t`: the day's plan (drawn from the weather seed once a new Rome day begins,
 * or at a new game's first step), the regime it sets for now unless the regime is forced, every value eased toward the regime's targets,
 * then the ground: wetness and the snow line. At rate 0 nothing eases: a clock moved by hand takes its day's plan and, unless forced,
 * the regime that plan sets for the new hour.
 */
export const advanceWeather = (weather: WeatherValue, t: number, rate: number): WeatherValue => {
  if (rate <= 0) {
    const plan = planOn(weather, t),
      regime = weather.forced ? weather.regime : regimeAt(plan, t)
    return plan === weather.plan && regime === weather.regime
      ? weather
      : { ...weather, plan, regime }
  }
  const sun = sunOver(t),
    plan = planFor(weather.plan, t, weather.seed),
    regime = weather.forced ? weather.regime : regimeAt(plan, t)
  const cloud = ease(weather.cloud, REGIME_SPECS[regime].cloud, rate, EASE.cloud),
    target = targetsOf({ regime, plan }, t, cloud)
  const eased: WeatherValue = {
    ...weather,
    regime,
    plan,
    cloud,
    precip: ease(weather.precip, target.precip, rate, EASE.precip),
    storm: ease(weather.storm, target.storm, rate, EASE.storm),
    wind: ease(weather.wind, target.wind, rate, EASE.wind),
    windAngle: easeAngle(weather.windAngle, windToward(regime, sun.elevation), rate, EASE.wind),
    gust: ease(weather.gust, target.gust, rate, EASE.wind),
    fog: ease(weather.fog, target.fog, rate, EASE.fog),
    anomaly: ease(weather.anomaly, target.anomaly, rate, EASE.anomaly),
  }
  return { ...eased, ...groundAfter(eased, t, rate, sun) }
}

/** The time constant (game seconds) the ground dries with under `weather`, the sun at `sun`, the air on the map's low ground at `low` °C: 6 hours cold, grey and calm down to 2 warm, sunny and windy. */
const dryingTime = (
  weather: Pick<WeatherValue, "cloud" | "wind">,
  sun: SunPlace,
  low: number,
): number => {
  const sunny = (1 - weather.cloud) * Math.max(0, Math.min(1, sun.elevation / 30))
  return Math.max(
    DRYING.fast,
    Math.min(
      DRYING.slow,
      DRYING.slow / (1 + 0.08 * Math.max(0, low) + sunny + 0.15 * weather.wind),
    ),
  )
}

/** Wetness `wet` after `seconds` of `rain` mm/h falling, drying with time constant `tau`: exact for any step, the balance after `SETTLED`. */
const wetAfter = (wet: number, rain: number, tau: number, seconds: number): number => {
  const wetting = Math.min(1, rain / PRECIP_FULL) / WETTING,
    drying = Math.max(0, 1 - rain / DRIZZLE) / tau,
    rate = wetting + drying
  const balance = wetting / rate
  return balance + (wet - balance) * Ops.exp(-rate * seconds)
}

/**
 * The ground after `rate` game seconds under `weather` at UTC second `t`, the sun at `sun`: where the snow line lies (coming down as
 * snow settles, going up as it melts) and how wet the precipitation leaves the ground.
 */
const groundAfter = (
  weather: WeatherValue,
  t: number,
  rate: number,
  sun: SunPlace,
): Pick<WeatherValue, "wet" | "snowLine"> => {
  const air = airAt(t, weather, sun),
    level = freezingLevel(air),
    low = celsiusAt(air, place().floor)
  let { snowLine } = weather
  if (weather.precip > DRIZZLE && level < Math.min(snowLine, TOP)) {
    // Snow sticks from the top of the map down toward the freezing level, as fast as it falls.
    snowLine = Math.max(
      level,
      Math.min(snowLine, TOP) - SNOWING * weather.precip * orographic(snowLine) * rate,
    )
  } else if (snowLine < NO_SNOW) {
    const thaw = celsiusAt(air, snowLine)
    if (thaw > 0) snowLine += MELTING * thaw * (weather.precip > DRIZZLE ? 2 : 1) * rate
    if (snowLine > TOP) snowLine = NO_SNOW
  }
  return {
    wet: wetAfter(weather.wet, weather.precip, dryingTime(weather, sun, low), rate),
    snowLine: Math.max(LOWEST_SNOW, snowLine),
  }
}

/** Where the player stands and how the camera looks: what places lightning that the player sees. */
export interface Witness {
  readonly x: number
  readonly y: number
  /** The screen's up and right on the ground (`restAxes`: the quarter seat's on foot, the driving view's at the wheel). */
  readonly up: { readonly x: number; readonly y: number }
  readonly right: { readonly x: number; readonly y: number }
}

/** The storm cell: starts this far upwind of the player (m), respawns there once this far past them downwind or this far off, and drifts downwind at this speed (m per real second). */
const UPWIND = 6000
const GONE = 9000
const DRIFT = 90
/** How far to either side of the wind a new cell starts, m. */
const CELL_SPREAD = 1000
/** Flashes per real second at storm 1, the share of them that strike the ground, and how far flashes scatter around the cell (σ, m). */
const FLASHES = 0.25
const BOLTS = 0.4
const SCATTER = 2000
/**
 * Within this distance of the cell (m), this share of ground strikes land in the strip the camera sees: up
 * to `STRIP.across` m to either side of the player, `STRIP.near`–`STRIP.far` m toward the camera (a
 * vertical bolt there crosses the whole screen).
 */
const OVERHEAD = 4000
const IN_VIEW = 0.25
const STRIP = { across: 40, near: 60, far: 600 } as const
/** Seeds for a bolt's shape and its thunder: whole numbers below this. */
const SEEDS = 0x7fffffff
/** A ground strike drawn off the map is drawn again up to this many times, then dropped: bolts strike only the map, never its edge. */
const REDRAWS = 4

/** Whether (x, y) lies on the map. */
const onMap = (x: number, y: number): boolean =>
  x >= MAP.bounds.minX && x <= MAP.bounds.maxX && y >= MAP.bounds.minY && y <= MAP.bounds.maxY

/** Below this storm strength there is no storm: no lightning, and the cell is sent `FAR` off. */
const CALM = 0.01

/**
 * One real-time step of `dt` seconds of the thunderstorm, at sim step `step`, seen by `witness`: the
 * cell drifts downwind (or starts upwind of the player when a storm begins or has passed), and lightning
 * strikes at random with a rate proportional to the storm's strength (a flash in the cloud, or a bolt to
 * the ground, now and then in front of the camera). A flash in the cloud stays where it was drawn, on the
 * map or off it; a bolt drawn off the map is drawn again (`REDRAWS`), then dropped. Once the storm fades
 * the cell is sent off the map, so the next storm starts upwind again; a calm sky is returned unchanged.
 * Draws from `random` only while a storm is active.
 */
export const stormStep = (
  weather: WeatherValue,
  witness: Witness,
  dt: number,
  step: number,
  random: Random.Random,
): { readonly weather: WeatherValue; readonly lightning: LightningValue | undefined } => {
  if (weather.storm < CALM)
    return {
      weather:
        weather.cellX === FAR && weather.cellY === FAR
          ? weather
          : { ...weather, cellX: FAR, cellY: FAR },
      lightning: undefined,
    }
  const wx = Ops.cos(weather.windAngle),
    wy = Ops.sin(weather.windAngle)
  const rx = weather.cellX - witness.x,
    ry = weather.cellY - witness.y
  let cellX = weather.cellX + wx * DRIFT * dt,
    cellY = weather.cellY + wy * DRIFT * dt
  if (rx * wx + ry * wy > UPWIND || rx * rx + ry * ry > GONE ** 2) {
    const aside = random.range(-CELL_SPREAD, CELL_SPREAD)
    cellX = witness.x - wx * UPWIND - wy * aside
    cellY = witness.y - wy * UPWIND + wx * aside
  }
  const next = { ...weather, cellX, cellY }
  if (random.next() >= weather.storm * FLASHES * dt) return { weather: next, lightning: undefined }
  const bolt = random.next() < BOLTS
  const near = (cellX - witness.x) ** 2 + (cellY - witness.y) ** 2 < OVERHEAD ** 2
  /** Where a flash strikes: in front of the camera now and then (bolts near the cell), else a normal scatter around the cell. */
  const place = (): { readonly x: number; readonly y: number } => {
    if (bolt && near && random.next() < IN_VIEW) {
      const across = random.range(-STRIP.across, STRIP.across),
        toward = random.range(STRIP.near, STRIP.far)
      return {
        x: witness.x - witness.up.x * toward + witness.right.x * across,
        y: witness.y - witness.up.y * toward + witness.right.y * across,
      }
    }
    // Box–Muller.
    const r = SCATTER * Math.sqrt(-2 * Ops.log(1 - random.next())),
      a = 2 * Math.PI * random.next()
    return { x: cellX + r * Ops.cos(a), y: cellY + r * Ops.sin(a) }
  }
  let at = place()
  if (bolt) for (let k = 0; k < REDRAWS && !onMap(at.x, at.y); k++) at = place()
  if (bolt && !onMap(at.x, at.y)) return { weather: next, lightning: undefined }
  return {
    weather: next,
    lightning: {
      x: at.x,
      y: at.y,
      bolt,
      power: random.range(0.3, 1),
      seed: random.integer(0, SEEDS),
      step,
    },
  }
}

/** The weather `weather`'s regime settles into at UTC second `t`: every value at its target (the day's plan's), the ground as wet as its rain and drying balance, and where it snows, the snow lying down to the freezing level. */
const settled = (weather: WeatherValue, t: number): WeatherValue => {
  const target = targetsOf(weather, t, REGIME_SPECS[weather.regime].cloud),
    sun = sunOver(t)
  const at: WeatherValue = {
    ...weather,
    cloud: target.cloud,
    precip: target.precip,
    storm: target.storm,
    wind: target.wind,
    windAngle: windToward(weather.regime, sun.elevation),
    gust: target.gust,
    fog: target.fog,
    anomaly: target.anomaly,
  }
  const air = airAt(t, at, sun),
    level = freezingLevel(air)
  return {
    ...at,
    wet: wetAfter(
      weather.wet,
      at.precip,
      dryingTime(at, sun, celsiusAt(air, place().floor)),
      SETTLED,
    ),
    snowLine:
      at.precip > DRIZZLE && level < Math.min(weather.snowLine, TOP)
        ? Math.max(LOWEST_SNOW, level)
        : weather.snowLine,
  }
}

/** A dev request to force a regime or hand the weather back to its day's plan (`regime` null), `settle` jumping straight to the targets. */
export interface WeatherRequest {
  readonly regime: Regime | null
  readonly settle?: boolean
}

/**
 * `weather` with `request` applied at UTC second `t`, under the plan of the day the clock is on: forced to its regime, or handed back
 * to the day's plan and its regime now, settled at once when asked (`settle`: the plan's own values when the regime is the plan's);
 * undefined when the regime is not one.
 */
export const setWeather = (
  weather: WeatherValue,
  request: WeatherRequest,
  t: number,
): WeatherValue | undefined => {
  if (request.regime !== null && !isRegime(request.regime)) return undefined
  const plan = planOn(weather, t)
  const next =
    request.regime === null
      ? { ...weather, plan, forced: false, regime: regimeAt(plan, t) }
      : { ...weather, plan, regime: request.regime, forced: true }
  return request.settle === true ? settled(next, t) : next
}
