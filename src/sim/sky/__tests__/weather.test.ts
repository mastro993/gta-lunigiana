import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Random } from "@typeonce/ritmo-math"

import { wholeMap } from "../../../tools/map-file.ts"
import { MAP } from "../../map/index.ts"
import type { LightningValue, WeatherValue } from "../../schema.ts"
import { screenAxes } from "../../view.ts"
import { DAY, daysFromCivil, romeDay, utcFromRome } from "../calendar.ts"
import {
  airAt,
  celsiusAt,
  dailyMean,
  freezingLevel,
  normalsAt,
  NO_SNOW,
  rainCooling,
} from "../climate.ts"
import { MAX_RATE, SECONDS_RANGE, setClock } from "../clock.ts"
import { conditionsAt, DRY, fogAt, fogLayers, groundAt, snowCoverAt, windAt } from "../local.ts"
import { place, placeFrom } from "../place.ts"
import { calmPlan, dayWarmth, planFor, rainingAt, regimeAt } from "../plan.ts"
import { describeWeather } from "../readout.ts"
import { EVENTS, isRegime, REGIME_SPECS, REGIMES, SKIES } from "../regimes.ts"
import { advanceWeather, initialWeather, setWeather, stormStep } from "../weather.ts"

/** UTC second of `year`-`month`-`day` `hour`:`minute` UTC. */
const utc = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  daysFromCivil(year, month, day) * DAY + hour * 3600 + minute * 60
const OCTOBER = 1792648800
const JANUARY = utc(2027, 1, 15, 13)
/** Draws that fail the test: a step that should draw nothing. */
const never: Random.Random = { ...Random.make(0), next: () => assert.fail("drew a number") }
/** The map's low ground, m a.s.l. */
const FLOOR = place().floor
/** A new game at `t` whose day is already drawn, dry and clear: nothing is drawn until the next midnight. */
const fresh = (t: number): WeatherValue => {
  const weather = initialWeather(t, 1)
  return { ...weather, plan: { ...weather.plan, drawn: true, from: 0 } }
}
/** `weather` forced to `regime` and settled at `t`. */
const settledAt = (weather: WeatherValue, regime: (typeof REGIMES)[number], t: number) =>
  setWeather(weather, { regime, settle: true }, t)!
/** `weather` run `seconds` game seconds from `t` in steps of `rate`. */
const run = (weather: WeatherValue, t: number, seconds: number, rate: number) => {
  let w = weather
  for (let s = rate; s <= seconds; s += rate) w = advanceWeather(w, t + s, rate)
  return w
}

test("regimes: each has a name, a description and targets in range, in words that fit any map; a plan's events and skies are regimes", () => {
  for (const id of REGIMES) {
    const spec = REGIME_SPECS[id]
    assert.ok(
      spec.label.length > 0 && spec.description.length >= 60 && spec.description.endsWith("."),
      id,
    )
    assert.ok(
      spec.cloud >= 0 &&
        spec.cloud <= 1 &&
        spec.fog >= 0 &&
        spec.fog <= 1 &&
        spec.storm >= 0 &&
        spec.storm <= 1 &&
        spec.gust >= 1,
      id,
    )
    assert.ok(
      !/Libeccio|Tramontana|\bBora\b|Lucido|Lunigiana|Apuan|valley|ridge/i.test(
        spec.label + spec.description,
      ),
      `${id}: no place's names`,
    )
  }
  assert.ok([...EVENTS, ...SKIES].every(isRegime))
})

test("a new game: clear and calm at the clear regime's targets with its weather seed, dry, the season's snow line, a calm plan the first step draws", () => {
  const october = initialWeather(OCTOBER, 0x1a2b3c4d)
  assert.deepEqual(
    [
      october.seed,
      october.regime,
      october.forced,
      october.cloud,
      october.precip,
      october.storm,
      october.wet,
      october.anomaly,
      october.snowLine,
    ],
    [0x1a2b3c4d, "clear", false, REGIME_SPECS.clear.cloud, 0, 0, 0, 0, NO_SNOW],
  )
  assert.deepEqual(october.plan, calmPlan(OCTOBER))
  // January: snow down to where the day's mean normal is 0 °C, about 1490 m at the map's latitude.
  const normals = normalsAt(JANUARY),
    line = initialWeather(JANUARY, 1).snowLine
  assert.ok(
    Math.abs(line - (1000 * dailyMean(normals, 0)) / normals.lapse) < 1e-9 &&
      line > 1300 &&
      line < 1700,
    `January starts with snow on the high ground from ${line} m`,
  )
  assert.ok(Ops.hypot(october.cellX, october.cellY) > 50000, "no storm near")
})

test("setClock: seconds rounded and kept in range, the rate a whole number from 0 to an hour a step; a request with no number in it is dropped", () => {
  const clock = { seconds: OCTOBER, rate: 1 }
  /** A request with both numbers, whatever they are. */
  const both = (seconds: number, rate: number) => ({ seconds, rate })
  assert.deepEqual(setClock(clock, { rate: 60.4 }), { seconds: OCTOBER, rate: 60 })
  assert.deepEqual(setClock(clock, { seconds: OCTOBER + 0.6 }), { seconds: OCTOBER + 1, rate: 1 })
  assert.deepEqual(setClock(clock, { seconds: 0, rate: -3 }), {
    seconds: SECONDS_RANGE.min,
    rate: 0,
  })
  assert.deepEqual(setClock(clock, { seconds: 1e12, rate: 1e9 }), {
    seconds: SECONDS_RANGE.max,
    rate: MAX_RATE,
  })
  assert.deepEqual(
    setClock(clock, both(Number.NaN, 10)),
    { seconds: OCTOBER, rate: 10 },
    "the number in it still applies",
  )
  assert.equal(setClock(clock, {}), undefined)
  assert.equal(setClock(clock, both(Infinity, Number.NaN)), undefined)
})

test("setWeather: forces a regime, settles it at once when asked, hands the weather back to its day's plan; a regime that is none is dropped", () => {
  const start = fresh(OCTOBER)
  const forced = setWeather(start, { regime: "rain" }, OCTOBER)!
  assert.deepEqual(
    [forced.regime, forced.forced, forced.cloud, forced.precip],
    ["rain", true, start.cloud, 0],
    "forced: the values still ease",
  )
  const rain = settledAt(start, "rain", OCTOBER),
    { precip } = REGIME_SPECS.rain
  // Its air: the day's air mass, the dry day's warmth, cooled by the rain falling.
  assert.deepEqual(
    [rain.cloud, rain.precip, rain.wet, rain.anomaly],
    [1, precip, 1, start.plan.airMass + dayWarmth(start.plan) - rainCooling(precip)],
  )
  assert.deepEqual(
    setWeather(rain, { regime: null }, OCTOBER),
    { ...rain, forced: false, regime: "clear" },
    "back to the plan's regime now",
  )
  const back = setWeather(rain, { regime: null, settle: true }, OCTOBER)!
  assert.deepEqual(
    [back.forced, back.regime, back.cloud, back.precip],
    [false, "clear", REGIME_SPECS.clear.cloud, 0],
    "and settled on it",
  )
  // @ts-expect-error -- the dev console can send anything
  assert.equal(setWeather(start, { regime: "hail" }, OCTOBER), undefined)
  const snow = settledAt(fresh(JANUARY), "snow", JANUARY)
  assert.ok(
    Math.abs(snow.snowLine - freezingLevel(airAt(JANUARY, snow))) < 1e-6 &&
      snow.snowLine < initialWeather(JANUARY, 1).snowLine,
    `settled snow lies down to the freezing level: ${snow.snowLine} m`,
  )
})

test("setWeather: settling the plan's own rain takes the plan's rate; forcing another regime its usual one", () => {
  // A day drawn wet, in the middle of its rain.
  let plan = calmPlan(OCTOBER),
    seed = 0
  while (!plan.wet || plan.event !== "rain") plan = planFor(calmPlan(OCTOBER), OCTOBER + 1, ++seed)
  const t = utcFromRome(plan.day * DAY) + (plan.start + plan.end) / 2,
    weather = { ...initialWeather(OCTOBER, 1), plan }
  assert.equal(regimeAt(plan, t), "rain")
  assert.equal(settledAt(weather, "rain", t).precip, plan.precip)
  assert.equal(settledAt(weather, "storm", t).precip, REGIME_SPECS.storm.precip)
})

test("advance: the clock standing still changes nothing while its day lasts; a forced regime keeps its day's plan; a new game's first step draws its day", () => {
  const start = fresh(OCTOBER)
  assert.equal(advanceWeather(start, OCTOBER + 3600, 0), start)
  const forced = settledAt(start, "storm", OCTOBER)
  const later = advanceWeather(forced, OCTOBER + 600, 600)
  assert.deepEqual([later.regime, later.forced, later.plan], ["storm", true, forced.plan])
  const first = advanceWeather(initialWeather(OCTOBER, 1), OCTOBER + 1, 1)
  assert.ok(first.plan.drawn && first.regime === "clear", "drawn, still in the calm start")
})

// Regression: with the clock stopped, a time set later the same day kept the regime of the hour it left, so the dev menu read "Clear"
// while the day's plan said "Overcast", until the clock ran again.
test("advance: with the clock stopped, a clock moved within its day takes the plan's regime at the new hour, easing nothing", () => {
  let moved = 0
  for (let seed = 1; seed <= 40; seed++) {
    const plan = planFor(calmPlan(OCTOBER), OCTOBER + 1, seed),
      midnight = utcFromRome(plan.day * DAY)
    const morning = midnight + 6 * 3600,
      evening = midnight + 21 * 3600
    const before = { ...fresh(OCTOBER), seed, plan, regime: regimeAt(plan, morning) }
    const after = advanceWeather(before, evening, 0)
    assert.deepEqual(
      [after.plan, after.regime, after.cloud],
      [plan, regimeAt(plan, evening), before.cloud],
      `seed ${seed}: the evening's regime, nothing eased`,
    )
    if (after.regime !== before.regime) moved++
    assert.equal(
      advanceWeather({ ...before, forced: true }, evening, 0).regime,
      before.regime,
      `seed ${seed}: a forced regime stays`,
    )
  }
  assert.ok(moved > 0, "some days change regime between 06:00 and 21:00")
})

// Regression: with the clock stopped, a date set in the dev menu kept the old day's plan, so Auto and Settle settled on what it held at
// that hour (its rain rate included), and the menu counted down to its changes, until the clock ran again.
test("advance and setWeather: with the clock stopped, a clock moved to another day takes that day's plan, easing nothing; Auto and Settle settle on it", () => {
  for (let seed = 1; seed <= 40; seed++) {
    // A rainy day, in the middle of its rain, then the clock stopped and set nine days on at the same hour.
    let plan = calmPlan(OCTOBER),
      tries = seed * 1000
    while (!plan.wet || plan.event !== "rain")
      plan = planFor(calmPlan(OCTOBER), OCTOBER + 1, ++tries)
    const t = utcFromRome(plan.day * DAY) + (plan.start + plan.end) / 2,
      rainy = settledAt({ ...fresh(OCTOBER), seed: tries, plan }, "rain", t)
    const later = t + 9 * DAY,
      today = planFor(plan, later, tries)
    const stopped = advanceWeather({ ...rainy, forced: false }, later, 0)
    assert.deepEqual(
      [stopped.plan, stopped.regime, stopped.cloud, stopped.precip],
      [today, regimeAt(today, later), rainy.cloud, rainy.precip],
      `seed ${tries}: the new day's plan, nothing eased`,
    )
    assert.equal(advanceWeather(stopped, later, 0), stopped, "and nothing more while the day lasts")
    const auto = setWeather(rainy, { regime: null, settle: true }, later)!,
      rain = settledAt(rainy, "rain", later)
    assert.deepEqual(
      [auto.plan, auto.regime, auto.cloud],
      [today, regimeAt(today, later), REGIME_SPECS[regimeAt(today, later)].cloud],
      `seed ${tries}: Auto settles on the new day`,
    )
    assert.deepEqual(
      [rain.plan, rain.precip],
      [
        today,
        today.event === "rain" && rainingAt(today, later) ? today.precip : REGIME_SPECS.rain.precip,
      ],
      `seed ${tries}: forced rain at the new day's rate`,
    )
  }
})

test("advance: every value eases toward its regime's targets over game time, in one long step as in many short ones; rain waits for the clouds", () => {
  const rain = { ...fresh(OCTOBER), regime: "rain" as const, forced: true }
  const once = advanceWeather(rain, OCTOBER + 1800, 1800),
    steps = run(rain, OCTOBER, 1800, 1)
  for (const key of ["cloud", "wind", "fog", "anomaly"] as const)
    assert.ok(Math.abs(once[key] - steps[key]) < 1e-9, key)
  // Cloud eases with a 30-minute time constant: 63% of the way in half an hour.
  assert.ok(Math.abs((once.cloud - rain.cloud) / (1 - rain.cloud) - (1 - Ops.exp(-1))) < 1e-9)
  const early = run(rain, OCTOBER, 600, 60)
  assert.ok(early.cloud < 0.7 && early.precip === 0, "no rain from a clear sky in ten minutes")
  const hour = run(rain, OCTOBER, 7200, 60)
  assert.ok(
    hour.precip > 0.75 * REGIME_SPECS.rain.precip && hour.wet > 0.5,
    `after two hours: ${hour.precip} mm/h, wet ${hour.wet}`,
  )
})

test("ground: rain soaks the road within half an hour, and it dries over hours in the sun", () => {
  const rain = settledAt({ ...fresh(OCTOBER), wet: 0 }, "rain", OCTOBER)
  const soaked = run({ ...rain, wet: 0 }, OCTOBER, 1800, 60)
  assert.ok(soaked.wet > 0.9, `${soaked.wet}`)
  const sun = settledAt({ ...fresh(OCTOBER), wet: 1 }, "clear", OCTOBER)
  const hour = run({ ...sun, wet: 1 }, utc(2026, 10, 22, 9), 3600, 60)
  assert.ok(hour.wet > 0.6 && hour.wet < 0.85, `an hour of October sun: ${hour.wet}`)
  assert.ok(run({ ...sun, wet: 1 }, utc(2026, 10, 22, 9), 6 * 3600, 60).wet < 0.2, "six hours")
})

test("ground: overcast drizzle damps a dry road slowly, over hours, and never soaks it", () => {
  for (const t of [OCTOBER, JANUARY]) {
    const drizzle = { ...settledAt(fresh(t), "overcast", t), wet: 0 }
    const hour = run(drizzle, t, 3600, 60).wet,
      six = run(drizzle, t, 6 * 3600, 60).wet
    assert.ok(
      hour > 0.03 && hour < 0.15 && six > 0.2 && six < 0.5,
      `${t}: an hour ${hour}, six hours ${six}`,
    )
    assert.ok(
      settledAt(fresh(t), "overcast", t).wet > six && settledAt(fresh(t), "overcast", t).wet < 0.6,
      "settled: the balance",
    )
  }
})

// Regression: snowmelt on the ridges wet the whole map in the share of its ground under the snow, sunny valley roads 1000 m below
// it too.
test("ground: snow melting on a mild day wets only the band under its edge, the low ground below stays dry; in a frost nothing gets wet", () => {
  // A new game on 15 January (the season's snow line, about 1490 m), clear all day: it thaws from 08:00 to 14:00.
  const morning = utc(2027, 1, 15, 7),
    afternoon = morning + 6 * 3600,
    start = fresh(morning).snowLine
  const january = run(settledAt(fresh(morning), "clear", morning), morning, 6 * 3600, 60),
    air = airAt(afternoon, january)
  assert.ok(
    january.snowLine > start && january.wet === 0,
    `a thaw from ${start} m: line ${january.snowLine} m, wet ${january.wet}`,
  )
  const band = Array.from({ length: 200 }, (_, k) =>
    groundAt(january, k * 7, 0, january.snowLine - 40, air),
  )
  assert.ok(
    celsiusAt(air, january.snowLine) > 1 && band.some((g) => g.wet > 0.5),
    "meltwater just under the snow",
  )
  assert.deepEqual(groundAt(january, 0, 0, FLOOR + 100, air), DRY, "the low ground 1000 m below")
  // Snow down to 400 m: the band runs just above the low ground, which stays dry.
  const low = run(
    { ...settledAt(fresh(morning), "clear", morning), snowLine: 400 },
    morning,
    4 * 3600,
    60,
  )
  assert.ok(
    low.snowLine > 400 && low.wet === 0,
    `four hours of a thaw from 400 m: line ${low.snowLine} m, wet ${low.wet}`,
  )
  assert.deepEqual(groundAt(low, 0, 0, FLOOR, airAt(morning + 4 * 3600, low)), DRY)
  const evening = utc(2027, 1, 16, 17),
    windy = settledAt(fresh(evening), "windy", evening)
  const frost = run(
    { ...windy, anomaly: -12, wet: 0, snowLine: 400, plan: { ...windy.plan, airMass: -12 } },
    evening,
    4 * 3600,
    60,
  )
  assert.ok(
    frost.snowLine === 400 && frost.wet === 0,
    `a hard frost at night: line ${frost.snowLine} m, wet ${frost.wet}`,
  )
})

test("ground: in January snow covers the mountains down toward the freezing level and thaws again slowly, never below the map", () => {
  const morning = utc(2027, 1, 15, 9),
    snowing = { ...settledAt(fresh(morning), "snow", morning), snowLine: NO_SNOW }
  const after = run(snowing, morning, 4 * 3600, 60)
  const level = freezingLevel(airAt(morning + 4 * 3600, after))
  // It follows the freezing level down as it falls; the day's warming has barely begun on it.
  assert.ok(
    after.snowLine < 1600 && Math.abs(after.snowLine - level) < 100,
    `four hours of snow: line at ${after.snowLine} m, freezing level ${level} m`,
  )
  const sixteenth = utc(2027, 1, 16, 8),
    thaw = run(
      { ...settledAt(fresh(sixteenth), "clear", sixteenth), snowLine: 900 },
      sixteenth,
      8 * 3600,
      60,
    )
  assert.ok(
    thaw.snowLine > 900 && thaw.snowLine < 1300,
    `a sunny January day: snow line ${thaw.snowLine} m`,
  )
  const lowest =
    Array.from(wholeMap().heightmap.data).reduce((low, z) => Math.min(low, z), Number.MAX_VALUE) /
    10
  const deep = run({ ...snowing, anomaly: -20, snowLine: 200 }, JANUARY, 3600, 60)
  assert.ok(
    deep.snowLine >= lowest - 50 - 1e-9 && deep.snowLine < 200,
    "bounded just under the lowest ground",
  )
})

test("local: snow lies above the snow line's ragged edge only, and wet ground under it is snow, not water", () => {
  assert.equal(snowCoverAt(NO_SNOW, 0, 0, 1700), 0)
  assert.equal(snowCoverAt(1000, 0, 0, 900), 0)
  assert.equal(snowCoverAt(1000, 0, 0, 1100), 1)
  // Along the 1000 m contour the edge wanders by tens of metres: some points white, some bare.
  const along = Array.from({ length: 200 }, (_, k) => snowCoverAt(1000, k * 7, 0, 1000))
  assert.ok(along.some((c) => c === 0) && along.some((c) => c === 1), "a ragged edge")
  // Meltwater: dry weather, but where the air thaws the road just below the snow is wet, drier further down; in a frost it is dry.
  const mild = airAt(JANUARY, { cloud: 0, wind: 2, anomaly: 4 }),
    frost = airAt(JANUARY, { cloud: 0, wind: 2, anomaly: -8 })
  assert.ok(celsiusAt(mild, 920) > 1 && celsiusAt(frost, 1000) < 0)
  assert.deepEqual(groundAt({ wet: 0, snowLine: NO_SNOW }, 0, 0, 300, mild), DRY)
  assert.deepEqual(groundAt({ wet: 0.8, snowLine: 1000 }, 0, 0, 1100, mild), { wet: 0, snow: 1 })
  assert.deepEqual(groundAt({ wet: 0.8, snowLine: 1000 }, 0, 0, 300, mild), { wet: 0.8, snow: 0 })
  const slush = Array.from({ length: 200 }, (_, k) =>
    groundAt({ wet: 0, snowLine: 1000 }, k * 7, 0, 920, mild),
  )
  assert.ok(
    slush.every((g) => g.wet <= 1 && g.snow === 0) &&
      slush.some((g) => g.wet > 0.5) &&
      slush.some((g) => g.wet < 0.5),
    "a wet band below the snow",
  )
  assert.ok(
    Array.from({ length: 200 }, (_, k) =>
      groundAt({ wet: 0, snowLine: 1000 }, k * 7, 0, 920, frost),
    ).every((g) => g.wet === 0),
    "frozen: no meltwater",
  )
  assert.deepEqual(groundAt({ wet: 0, snowLine: 1000 }, 0, 0, 700, mild), DRY)
})

test("local: a January front rains on the low ground and snows on the high ground; the wind grows to 2.5 times the low ground's 1550 m above it", () => {
  const weather = settledAt(fresh(JANUARY), "rain", JANUARY)
  const low = conditionsAt(JANUARY, weather, 0, 0, FLOOR),
    high = conditionsAt(JANUARY, weather, 0, 0, 1700)
  assert.ok(
    low.rain > low.snow && high.snow > 0 && high.rain === 0,
    `${JSON.stringify(low)} ${JSON.stringify(high)}`,
  )
  assert.ok(high.snow > low.rain, "more falls on the mountains")
  assert.ok(Math.abs(celsiusAt(airAt(JANUARY, weather), FLOOR) - low.celsius) < 1e-12)
  const speed = (z: number) => Ops.hypot(windAt(weather, z).x, windAt(weather, z).y) / weather.wind
  assert.deepEqual(
    [speed(FLOOR - 100), speed(FLOOR), speed(FLOOR + 1550), speed(FLOOR + 3000)].map(
      (v) => Math.round(v * 1e9) / 1e9,
    ),
    [1, 1, 2.5, 2.5],
  )
  assert.ok(
    Math.abs(speed(FLOOR + 790) - (1 + (1.5 * 790) / 1550)) < 1e-9,
    `${speed(FLOOR + 790)} 790 m up`,
  )
})

test("local: radiation fog fills the low ground on the mornings the day's plan brings it, clear and calm, and is gone by the afternoon; a clear sky keeps the hills free", () => {
  const clear = settledAt(fresh(JANUARY), "clear", JANUARY),
    day = romeDay(JANUARY).day
  const at = (hour: number, fog: "none" | "morning") =>
    fogLayers(utc(2027, 1, 15, hour), { ...clear, plan: { ...clear.plan, day, fog } })
  assert.ok(
    fogAt(at(7, "morning"), FLOOR) > 0.5 && fogAt(at(7, "morning"), FLOOR + 400) === 0,
    "on the low ground, not above it",
  )
  assert.equal(at(7, "morning").valleyTop, FLOOR + 150)
  assert.equal(at(13, "morning").valleyDensity, 0, "burnt off by the afternoon")
  assert.equal(at(7, "none").valleyDensity, 0, "a morning the plan brings none")
  assert.equal(
    fogLayers(utc(2027, 1, 15, 7), {
      ...clear,
      wind: 5,
      plan: { ...clear.plan, day, fog: "morning" },
    }).valleyDensity,
    0,
    "a wind keeps it off",
  )
  assert.equal(
    fogLayers(utc(2027, 1, 16, 7), { ...clear, plan: { ...clear.plan, day, fog: "morning" } })
      .valleyDensity,
    0,
    "another day's plan",
  )
  assert.ok(fogLayers(JANUARY, clear).cloudBase > FLOOR + 2000, "clear: no cloud on the hills")
})

test("local: each regime its own cloud base over the low ground: hills 1500 m up in cloud under any full cover, the low ground below it in rain and storms, a thick low stratus in fog", () => {
  const layers = (regime: (typeof REGIMES)[number]) =>
    fogLayers(JANUARY, settledAt(fresh(JANUARY), regime, JANUARY))
  const rain = layers("rain"),
    storm = layers("storm"),
    fog = layers("fog"),
    overcast = layers("overcast")
  assert.deepEqual(
    [rain.cloudBase, storm.cloudBase, overcast.cloudBase].map((base) => Math.round(base - FLOOR)),
    [900, 1150, 975],
  )
  assert.ok(
    [rain, storm, overcast].every(
      (l) => fogAt(l, FLOOR + 50) < 0.5 && fogAt(l, FLOOR + 1500) > 0.5 && l.cloudDensity < 1,
    ),
    "the hills hidden, the low ground clear of the cloud, no thick fog",
  )
  assert.ok(
    fog.cloudBase < FLOOR + 400 && fog.cloudDensity > 0.95 && fogAt(fog, FLOOR) > 0.8,
    `fog: a low stratus at ${fog.cloudBase} m`,
  )
})

test("storm: the cell starts 6 km upwind of the player, drifts downwind 90 m a real second, and draws nothing without a storm", () => {
  const witness = { x: 100, y: -200, ...screenAxes(0) }
  const calm = fresh(OCTOBER)
  assert.deepEqual(stormStep(calm, witness, 1 / 60, 1, never), {
    weather: calm,
    lightning: undefined,
  })
  const storm = settledAt(calm, "storm", OCTOBER),
    wind = { x: Ops.cos(storm.windAngle), y: Ops.sin(storm.windAngle) }
  const first = stormStep(storm, witness, 1 / 60, 1, Random.make(5)).weather
  const upwind = (first.cellX - witness.x) * wind.x + (first.cellY - witness.y) * wind.y
  assert.ok(
    Math.abs(upwind + 6000) < 1e-6 &&
      Ops.hypot(first.cellX - witness.x, first.cellY - witness.y) < 6100,
    `${first.cellX}, ${first.cellY}`,
  )
  const next = stormStep(first, witness, 1 / 60, 2, Random.make(6)).weather
  assert.ok(
    Math.abs((next.cellX - first.cellX) * wind.x + (next.cellY - first.cellY) * wind.y - 1.5) <
      1e-9,
    "1.5 m a step",
  )
})

// Regression: a storm after the first began where the last one had faded, overhead or already past the player.
test("storm: a later storm starts 6 km upwind too, not where the last one faded; a calm sky is left unchanged", () => {
  const witness = { x: -1000, y: -2000, ...screenAxes(0) },
    random = Random.make(9)
  let w = settledAt(fresh(OCTOBER), "storm", OCTOBER),
    t = OCTOBER,
    step = 0
  /** One step as AdvanceWeather takes it: a game second of weather, then a sixtieth of a real second of the storm. */
  const tick = () => {
    t++
    w = stormStep(advanceWeather(w, t, 1), witness, 1 / 60, ++step, random).weather
  }
  // Half a minute of storm, then cloud: it fades with its cell about 3 km past the player, short of where a new cell would start.
  for (let k = 0; k < 60 * 30; k++) tick()
  w = setWeather(w, { regime: "cloudy" }, t)!
  while (w.storm >= 0.01) tick()
  for (let k = 0; k < 60 * 120; k++) tick()
  assert.equal(
    stormStep(w, witness, 1 / 60, step, never).weather,
    w,
    "calm: nothing to write, nothing drawn",
  )
  w = setWeather(w, { regime: "storm" }, t)!
  while (w.storm < 0.01) tick()
  const wind = { x: Ops.cos(w.windAngle), y: Ops.sin(w.windAngle) }
  const upwind = (w.cellX - witness.x) * wind.x + (w.cellY - witness.y) * wind.y
  assert.ok(
    Math.abs(upwind + 6000) < 1e-6,
    `the next storm starts ${upwind} m along the wind from the player`,
  )
})

test("storm: lightning about 0.25 times a real second at full strength, 60% of it in the cloud, bolts on the map; near the cell a quarter of the bolts strike in front of the camera", () => {
  const { up, right } = screenAxes(1),
    witness = { x: -412, y: 438, up, right }
  const storm = settledAt(fresh(OCTOBER), "storm", OCTOBER)
  const flashes = (seed: number, steps: number, overhead: boolean) => {
    const random = Random.make(seed),
      list = []
    let w = storm
    for (let step = 0; step < steps; step++) {
      // Held over the player (or far off) to measure the placement there.
      w = overhead ? { ...w, cellX: witness.x, cellY: witness.y } : w
      const out = stormStep(w, witness, 1 / 60, step, random)
      w = out.weather
      if (out.lightning !== undefined) list.push(out.lightning)
    }
    return list
  }
  const all = flashes(7, 60 * 1800, false)
  assert.ok(
    all.length > 0.25 * 1800 * 0.9 && all.length < 0.25 * 1800 * 1.1,
    `${all.length} flashes in 30 real minutes`,
  )
  const bolts = all.filter((l) => l.bolt).length / all.length
  assert.ok(bolts > 0.33 && bolts < 0.47, `${bolts} of them bolts`)
  assert.ok(
    all.every(
      (l) =>
        (!l.bolt || onMap(l)) &&
        l.power >= 0.3 &&
        l.power <= 1 &&
        Number.isSafeInteger(l.seed) &&
        Number.isFinite(l.x) &&
        Number.isFinite(l.y),
    ),
  )
  assert.deepEqual(
    flashes(7, 600, false),
    all.filter((l) => l.step < 600),
    "the same draws give the same lightning",
  )
  const near = flashes(8, 60 * 1200, true).filter((l) => l.bolt)
  const inView = near.filter((l) => {
    const dx = l.x - witness.x,
      dy = l.y - witness.y,
      toward = -(dx * up.x + dy * up.y),
      across = dx * right.x + dy * right.y
    return toward >= 60 && toward <= 600 && Math.abs(across) <= 40
  })
  assert.ok(
    inView.length / near.length > 0.17 && inView.length / near.length < 0.33,
    `${inView.length} of ${near.length} bolts in view`,
  )
})

/** Whether a flash lies on the map, and whether exactly on its edge (where clamping once piled them). */
const onMap = (l: Pick<LightningValue, "x" | "y">) =>
  l.x >= MAP.bounds.minX &&
  l.x <= MAP.bounds.maxX &&
  l.y >= MAP.bounds.minY &&
  l.y <= MAP.bounds.maxY
const onEdge = (l: Pick<LightningValue, "x" | "y">) =>
  l.x === MAP.bounds.minX ||
  l.x === MAP.bounds.maxX ||
  l.y === MAP.bounds.minY ||
  l.y === MAP.bounds.maxY

test("storm: near the map's edge bolts strike only the map and none lie on its edge; flashes in the cloud stay where they were drawn, off the map too", () => {
  for (const [x, y] of [
    [-1751, 3360],
    [-412, 438],
    [1700, 800],
  ] as const) {
    const witness = { x, y, ...screenAxes(0) },
      list: Array<LightningValue> = []
    for (const seed of [1, 2, 3, 4]) {
      const random = Random.make(seed)
      let w = settledAt(fresh(OCTOBER), "storm", OCTOBER)
      for (let step = 0; step < 60 * 180; step++) {
        const out = stormStep(w, witness, 1 / 60, step, random)
        w = out.weather
        if (out.lightning !== undefined) list.push(out.lightning)
      }
    }
    const bolts = list.filter((l) => l.bolt)
    assert.ok(
      bolts.length > 20 && bolts.every(onMap) && !list.some(onEdge),
      `(${x}, ${y}): ${bolts.length} bolts`,
    )
    if (x < -1000)
      assert.ok(
        list.some((l) => !l.bolt && !onMap(l)),
        "by the edge some flashes light the cloud off the map",
      )
  }
})

test("readout: one word for the weather where the player stands, from what falls and the fog there before the regime's sky", () => {
  const at = (t: number, regime: (typeof REGIMES)[number], z: number) => {
    const weather = settledAt(fresh(t), regime, t)
    return describeWeather(weather, conditionsAt(t, weather, 0, 0, z))
  }
  assert.deepEqual(
    REGIMES.map((r) => at(OCTOBER, r, 300)),
    ["Clear", "Fair", "Cloudy", "Drizzle", "Fog", "Rain", "Storm", "Windy", "Rain"],
  )
  assert.equal(at(JANUARY, "snow", 1700), "Snow", "snow on the high ground")
  assert.equal(
    at(OCTOBER, "rain", FLOOR + 1000),
    "Rain",
    "in the cloud, but the rain is what one sees",
  )
  assert.equal(
    describeWeather({ cloud: 1, storm: 0, wind: 2 }, { rain: 0.3, snow: 0.3, fog: 0 }),
    "Sleet",
  )
  assert.equal(
    describeWeather({ cloud: 0.6, storm: 0, wind: 2 }, { rain: 0, snow: 0, fog: 0.8 }),
    "Fog",
  )
})

test("place: the sky's place is the map's, its low ground about 230 m and its slope falling west-north-west", () => {
  assert.deepEqual(place(), placeFrom(MAP.origin, wholeMap().heightmap))
  assert.ok(
    FLOOR > 220 && FLOOR < 240 && place().downslope > 2 && place().downslope < 2.3,
    JSON.stringify(place()),
  )
})
