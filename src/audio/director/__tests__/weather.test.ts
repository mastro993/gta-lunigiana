import assert from "node:assert/strict"
import { test } from "node:test"

import { groundZ } from "../../../sim/map/ground.ts"
import type { WeatherValue } from "../../../sim/schema.ts"
import { DAY, daysFromCivil, utcFromRome } from "../../../sim/sky/calendar.ts"
import { conditionsAt } from "../../../sim/sky/local.ts"
import { place, providePlace } from "../../../sim/sky/place.ts"
import { REGIME_SPECS } from "../../../sim/sky/regimes.ts"
import { advanceWeather, initialWeather } from "../../../sim/sky/weather.ts"
import { CABIN, dbToGain, gainToDb, mixGain, NIGHT_DB, SPEED_OF_SOUND } from "../../acoustics.ts"
import { smoothstep } from "../../buffers.ts"
import { skyAt } from "../../index.ts"
import { ambienceAt, bells, owlsNear, streetAt } from "../../places.ts"
import { thunderRender } from "../../synth/thunder.ts"
import { residentAround } from "../../testing.ts"
import type { Happening, Heard, OneShot } from "../../types.ts"
import { BEDS, GALE_DB, MOST_DB, windDb } from "../levels.ts"
import { birdActivity, floorDb, USUAL_WIND } from "../sky.ts"
import {
  at,
  away,
  BELFRY,
  CALM,
  car,
  FRAME,
  FULL,
  GRAGNOLA,
  HILLSIDE,
  MEADOW,
  MORNING,
  person,
  RIDGE,
  rig,
  SOUTH,
  SPAWN,
  STREET,
  WEST_FLANK,
  world,
} from "../testing.ts"

/** The night: 02:00, the sun 55° under. */
const NIGHT = skyAt(at(2))
/** `CALM` raining `precip` mm/h at sea level (more uphill). */
const raining = (precip: number): WeatherValue => ({ ...CALM, cloud: 1, precip })
/** Fresh snow on the whole map. */
const SNOWY: WeatherValue = { ...CALM, snowLine: 0 }

type Thunder = Extract<OneShot, { readonly kind: "thunder" }>
/** A lightning flash at `where`: a bolt unless said, at full power. */
const flash = (
  where: { readonly x: number; readonly y: number },
  more: Partial<Extract<Happening, { readonly kind: "lightning" }>> = {},
): Happening => ({
  kind: "lightning",
  x: where.x,
  y: where.y,
  bolt: true,
  power: 1,
  seed: 3,
  ...more,
})

test("rain plays a bed at the ears while it falls, at the rate falling there; dry, or falling as snow, none", () => {
  const rain = (weather: WeatherValue) => {
    const director = rig()
    director.hear(world(MEADOW, { weather }))
    return director.held().get("rain")
  }
  assert.equal(rain(CALM), undefined)
  const light = rain(raining(1)),
    heavy = rain(raining(20))
  assert.ok(
    light?.sound.kind === "rain" &&
      heavy?.sound.kind === "rain" &&
      heavy.sound.rate > light.sound.rate &&
      light.sound.rate > 1,
    JSON.stringify([light, heavy]),
  )
  assert.ok(
    heavy.sound.forest === 0 && heavy.at.pan === 0 && heavy.at.wet === 0,
    "the meadow's open ground, all around, dry of reverb",
  )
  // 15 °C colder than the normal: about −2 °C on the meadow, where everything falls as snow.
  assert.equal(rain({ ...raining(20), anomaly: -15 }), undefined)
})

test("heavy rain raises the masking floor: a car at full load 300 m across the meadow, heard in the dry, is lost in a downpour", () => {
  const engine = (weather: WeatherValue) => {
    const director = rig()
    director.hear(
      world(MEADOW, { vehicles: [car(1, "panda", away(MEADOW, 300, SOUTH), FULL)], weather }),
    )
    return director.held().has("engine:1")
  }
  assert.deepEqual([engine(CALM), engine(raining(40))], [true, false])
})

test("in the Panda the rain drums on the roof, centred and open; the bed outside comes through the cabin", () => {
  const director = rig()
  director.hear(
    world(MEADOW, { vehicles: [car(5, "panda", MEADOW, { mine: true })], weather: raining(10) }, 5),
  )
  const roof = director.held().get("roof"),
    rain = director.held().get("rain")
  assert.ok(
    roof?.sound.kind === "roof" &&
      rain?.sound.kind === "rain" &&
      roof.sound.rate === rain.sound.rate,
    JSON.stringify(roof),
  )
  assert.ok(roof.at.pan === 0 && roof.at.cutoff === 20000 && roof.at.wet === 0)
  assert.equal(rain.at.cutoff, CABIN.panda.cutoff)
  const outside = rig()
  outside.hear(world(MEADOW, { weather: raining(10) }))
  assert.equal(outside.held().has("roof"), false)
})

test("thunder waits its travel time: a bolt 3.4 km away is first heard about 10 s after the flash, its render's lead before its strike point's sound", () => {
  const director = rig(),
    strike = away(MEADOW, 3400, SOUTH)
  // The strike point's tile in memory too: the thunder starts on its exact ground.
  residentAround([strike], 0)
  director.hear(world(MEADOW, { happenings: [flash(strike)] }))
  const flashed = director.now()
  director.hear(world(MEADOW), 12 * 60)
  const [played, ...more] = director.take("thunder")
  assert.ok(played !== undefined && more.length === 0, `${director.plays.length} plays`)
  const sound = played.sound as Thunder,
    ears = groundZ(MEADOW.x, MEADOW.y) + 1.6
  const range = Math.hypot(
    strike.x - MEADOW.x,
    strike.y - MEADOW.y,
    groundZ(strike.x, strike.y) - ears,
  )
  const first = flashed + range / SPEED_OF_SOUND - thunderRender(sound).lead
  assert.ok(
    Math.abs(played.t + played.delay - first) < 1e-6 && played.delay <= 0.1 + FRAME,
    `${played.t + played.delay} s against ${first} s`,
  )
  assert.ok(first - flashed > 9.5 && first - flashed < 10.5, `${first - flashed} s`)
  assert.ok(Math.abs(sound.distance - 3400) < 1e-6 && sound.bolt && sound.seed === 3)
})

test("a thunder renders on a frame after its flash's, where the bolt is drawn, one render a frame: two within 40 m play a frame apart", () => {
  // Regression: it rendered in the flash's frame, a long task beside the bolt's drawing every few seconds of a storm.
  const director = rig(),
    near = away(MEADOW, 30, SOUTH)
  director.hear(world(MEADOW, { happenings: [flash(near, { seed: 1 }), flash(near, { seed: 2 })] }))
  const flashed = director.now()
  assert.equal(director.take("thunder").length, 0)
  const next = () => {
    director.hear(world(MEADOW))
    return director.take("thunder")
  }
  const [first, ...more] = next(),
    [second] = next()
  assert.ok(
    first !== undefined &&
      more.length === 0 &&
      Math.abs(first.t - flashed - FRAME) < 1e-9 &&
      first.delay === 0,
    JSON.stringify(first),
  )
  assert.ok(
    second !== undefined && Math.abs(second.t - flashed - 2 * FRAME) < 1e-9 && second.delay === 0,
    JSON.stringify(second),
  )
})

test("on a ridge a bolt in the valley below is heard as high as the ears stand over it, from the trunk passing at their height", () => {
  // The lowest ground 500 m from the ridge, found by looking around it.
  const below = Array.from({ length: 64 }, (_, k) =>
    away(RIDGE, 500, { x: Math.cos((k * Math.PI) / 32), y: Math.sin((k * Math.PI) / 32) }),
  ).reduce((a, b) => (groundZ(b.x, b.y) < groundZ(a.x, a.y) ? b : a))
  const ears = groundZ(RIDGE.x, RIDGE.y) + 1.6,
    drop = ears - groundZ(below.x, below.y)
  assert.ok(drop > 300, `${drop} m`)
  const director = rig()
  // This flash's trunk leans toward the ridge: heard 0.82 s after it, where its foot is 1.95 s away.
  director.hear(world(RIDGE, { happenings: [flash(below, { seed: 1 })] }))
  const flashed = director.now()
  director.hear(world(RIDGE), 3 * 60)
  const [played] = director.take("thunder"),
    sound = played?.sound as Thunder
  // Regression: the render heard every bolt from 1.6 m over its foot's ground, the director timed it from the foot up here.
  assert.ok(played !== undefined && Math.abs(sound.ears - drop) < 1e-9, JSON.stringify(sound))
  const foot = Math.hypot(500, drop) / SPEED_OF_SOUND,
    first = played.t + played.delay - flashed
  assert.ok(
    Math.abs(first - (foot - thunderRender(sound).lead)) < 1e-6 && first < foot - 0.3,
    `${first} s against the foot's ${foot} s`,
  )
})

test("thunder within 40 m plays at once, at its cap; one 2 km away to screen-right plays narrower than a point and under it", () => {
  const thunder = (where: { readonly x: number; readonly y: number }, seconds: number) => {
    const director = rig()
    director.hear(world(MEADOW, { happenings: [flash(where)] }))
    director.hear(world(MEADOW), 1 + seconds * 60)
    return director.take("thunder")
  }
  const [near] = thunder(away(MEADOW, 30, SOUTH), 0)
  assert.ok(near?.delay === 0 && near.at.gain === dbToGain(MOST_DB.thunder), JSON.stringify(near))
  const [far] = thunder(away(MEADOW, 2000), 8)
  assert.ok(
    far !== undefined &&
      far.at.gain < near.at.gain &&
      far.at.pan > 0.4 &&
      far.at.pan <= 0.6 * 0.85 + 1e-9,
    JSON.stringify(far?.at),
  )
  assert.ok(far.at.cutoff === 20000 && far.at.wet === 0, "its air is in its render; its roll too")
})

test("thunder is placed when it arrives: get into the Panda meanwhile and it comes through the cabin; drive toward it and it comes sooner", () => {
  const strike = away(MEADOW, 2000, SOUTH)
  const sat = rig()
  sat.hear(
    world(MEADOW, { happenings: [flash(strike)], people: [person(1, MEADOW, { player: true })] }),
  )
  sat.hear(world(MEADOW, { vehicles: [car(5, "panda", MEADOW, { mine: true })] }, 5), 8 * 60)
  const [inside] = sat.take("thunder")
  assert.ok(
    inside !== undefined && inside.at.cutoff === CABIN.panda.cutoff,
    JSON.stringify(inside?.at),
  )
  const arrival = (speed: number) => {
    const director = rig()
    director.hear(world(MEADOW, { happenings: [flash(strike)] }))
    for (let i = 1; i <= 8 * 60 && director.plays.length === 0; i++) {
      const moved = away(MEADOW, speed * i * FRAME, SOUTH)
      director.hear(
        world(moved, {
          listener: { x: moved.x, y: moved.y, vx: 0, vy: -speed, car: undefined, yaw: 0 },
        }),
      )
    }
    const [played] = director.take("thunder")
    return played!.t + played!.delay
  }
  assert.ok(arrival(30) < arrival(0) - 0.3, `${arrival(30)} against ${arrival(0)}`)
})

test("thunder answers off the rock faces in sight, as a crash does: after it, at least 10 dB under it, cut short with it", () => {
  // Under the west flank's face, 40 m off; a bolt 2 km south. The design's thunder echoes off rock; it had none.
  const director = rig(),
    strike = away(WEST_FLANK, 2000, SOUTH)
  director.hear(world(WEST_FLANK, { happenings: [flash(strike)] }))
  director.hear(world(WEST_FLANK), 8 * 60)
  const [direct, ...echoes] = director.take("thunder")
  assert.ok(direct !== undefined && echoes.length > 0, `${echoes.length} echoes`)
  for (const echo of echoes) {
    assert.ok(
      echo.sound === direct.sound &&
        echo.delay > direct.delay + 0.2 &&
        echo.at.gain <= direct.at.gain * dbToGain(-10) * (1 + 1e-9),
      JSON.stringify([direct, echo]),
    )
  }
})

test("before the audio context runs a flash is never thundered, not even once it runs", () => {
  const director = rig(0)
  director.hear(world(MEADOW, { happenings: [flash(away(MEADOW, 500, SOUTH))] }), 1, 0)
  director.hear(world(MEADOW), 5 * 60)
  assert.equal(director.take("thunder").length, 0)
})

test("at most two thunders roll at once, the second 3 dB under; a weaker flash is quieter; a downpour masks a far, weak one", () => {
  const director = rig(),
    strike = away(MEADOW, 2000, SOUTH)
  director.hear(world(MEADOW, { happenings: [1, 2, 3].map((seed) => flash(strike, { seed })) }))
  director.hear(world(MEADOW), 8 * 60)
  const rolled = director.take("thunder")
  assert.equal(rolled.length, 2)
  const loud = (power: number, weather = CALM, where = strike) => {
    const one = rig()
    one.hear(world(MEADOW, { happenings: [flash(where, { power, seed: 9 })], weather }))
    one.hear(world(MEADOW, { weather }), 30 * 60)
    return one.take("thunder")[0]?.at.gain ?? 0
  }
  const alone = loud(1)
  assert.ok(
    rolled.some((p) => Math.abs(p.at.gain - alone) < 1e-9) &&
      rolled.some((p) => Math.abs(p.at.gain - alone * Math.SQRT1_2) < 1e-9),
    JSON.stringify(rolled.map((p) => p.at.gain)),
  )
  assert.ok(loud(0.3) < alone * 0.6, `${loud(0.3)} against ${alone}`)
  // 8.5 km off toward the map's south-east corner.
  const far = { x: MEADOW.x + 0.589 * 8500, y: MEADOW.y - 0.808 * 8500 }
  assert.ok(loud(0.3, CALM, far) > 0 && loud(0.3, raining(80), far) === 0)
})

test("an approaching storm never rolls more than two thunders at once: a louder one takes the quietest's place, whose tail fades out", () => {
  // Regression: a louder third played and was counted, so the strikes of a storm closing in stacked up four rumbles.
  const director = rig()
  let flashed = 0
  for (const [metres, at] of [
    [3000, 0],
    [2000, 6],
    [1000, 10],
    [500, 12],
  ] as const) {
    director.hear(world(MEADOW), (at - flashed) * 60)
    flashed = at
    director.hear(
      world(MEADOW, { happenings: [flash(away(MEADOW, metres, SOUTH), { seed: metres })] }),
    )
  }
  director.hear(world(MEADOW), 20 * 60)
  const played = director.take("thunder"),
    stopped = new Map(director.stops.map((s) => [s.sound, s.t]))
  const rolling = played.map((p) => {
    const start = p.t + p.delay
    return {
      start,
      end: Math.min(
        stopped.get(p.sound) ?? Infinity,
        start + thunderRender(p.sound as Thunder).seconds,
      ),
      distance: (p.sound as Thunder).distance,
    }
  })
  const most = Math.max(
    ...rolling.map((a) => rolling.filter((b) => b.start <= a.start && b.end > a.start).length),
  )
  assert.ok(most <= 2, `${most} at once: ${JSON.stringify(rolling)}`)
  assert.ok(
    rolling.some((r) => r.distance === 500) && director.stops.length > 0,
    JSON.stringify(rolling),
  )
})

/** The wind voice held at `spot` in `weather` (the tests' unless set), and how it is placed. */
const windAt = (
  spot: { readonly x: number; readonly y: number },
  weather: Partial<WeatherValue> = {},
) => {
  const director = rig()
  director.hear(world(spot, { weather: { ...CALM, ...weather } }))
  const held = director.held().get("wind")
  assert.ok(held?.sound.kind === "wind")
  return { ...held.sound, at: held.at }
}

test("in the usual wind the wind voice is the one tuned before the weather, by altitude, open ground and streets", () => {
  // Regression: a law rebased for the gale's headroom ran the usual wind's voice at 0.75 of its strength, 5 dB up: as loud, but
  // duller, and a ridge hardly whistled. The law was tuned on this map from 150 to 1000 m a.s.l.; it now counts from the map's floor
  // (230.3 m here), so it holds to the floor's 0.3 m: under 0.001 of strength, 0.01 dB.
  for (const spot of [RIDGE, MEADOW, STREET, HILLSIDE, SPAWN]) {
    const tuned =
      0.15 +
      0.7 * smoothstep(150, 1000, groundZ(spot.x, spot.y)) +
      0.15 * ambienceAt(spot.x, spot.y).open -
      0.3 * streetAt(spot.x, spot.y)
    const still = 10 ** ((floorDb(MORNING.sun) - BEDS.wind) / 40)
    assert.ok(
      Math.abs(windAt(spot).strength - Math.min(1, Math.max(still, tuned))) < 1e-3,
      `${JSON.stringify(spot)}: ${windAt(spot).strength} against ${tuned}`,
    )
  }
})

test("the wind rises with the ears' height over the map's floor, not over the sea: where the floor stands above the ridge it blows there as on the floor", () => {
  const shipped = place(),
    { open } = ambienceAt(RIDGE.x, RIDGE.y)
  assert.ok(
    windAt(RIDGE).strength > 0.15 + 0.15 * open + 0.6,
    `${windAt(RIDGE).strength} on the shipped map`,
  )
  // An Alpine map whose floor lies 500 m over the ridge: the ridge's ears stand at its floor's stillness, open ground's share only.
  providePlace({ ...shipped, floor: groundZ(RIDGE.x, RIDGE.y) + 500 })
  try {
    assert.ok(
      Math.abs(windAt(RIDGE).strength - (0.15 + 0.15 * open)) < 1e-9,
      `${windAt(RIDGE).strength} under an Alpine floor`,
    )
  } finally {
    providePlace(shipped)
  }
})

test("the wind blows as the weather does: stiller than usual down to the rural floor, gustier, a gale on the ridge louder than its voice's full strength", () => {
  const usual = windAt(RIDGE),
    gale = windAt(RIDGE, { wind: 4 * USUAL_WIND, gust: 2.3 }),
    still = windAt(RIDGE, { wind: 0 })
  assert.ok(
    gale.strength === 1 && usual.strength < 1 && gale.gusts === 1 && usual.gusts === 0.5,
    JSON.stringify([usual, gale]),
  )
  // The gale's bed plays at `GALE_DB`, 5 dB over the voice at full strength: its gain gives what the voice cannot.
  assert.ok(
    Math.abs(gale.at.gain - mixGain(GALE_DB, 0)) < 1e-9 && GALE_DB > windDb(1),
    JSON.stringify(gale.at),
  )
  assert.ok(
    Math.abs(windDb(still.strength) - floorDb(MORNING.sun)) < 1e-9,
    `${windDb(still.strength)} dB(A)`,
  )
  // Twice the usual wind is twice the strength: 12 dB louder, until the gale's.
  const breeze = windAt(MEADOW),
    windy = windAt(MEADOW, { wind: 2 * USUAL_WIND })
  assert.ok(Math.abs(windy.strength / breeze.strength - 2) < 1e-9 && windDb(1) === BEDS.wind)
})

test("the usual wind the law was tuned for is a cloudy day's, a little over the weather's own mean: 2.5 m/s over 30 Octobers on this map", () => {
  const step = 600
  let sum = 0,
    n = 0
  for (let year = 2001; year < 2031; year++) {
    const from = utcFromRome(daysFromCivil(year, 10, 1) * DAY)
    let weather = initialWeather(from, year)
    for (let t = from + step; t < from + 31 * DAY; t += step) {
      weather = advanceWeather(weather, t, step)
      sum += weather.wind
      n++
    }
  }
  assert.ok(
    USUAL_WIND === REGIME_SPECS.cloudy.wind && sum / n > 2.3 && sum / n < USUAL_WIND,
    `${sum / n} m/s`,
  )
})

// Regression: the floor counted the wind outside, 15 dB over the wind the cabin lets through, so from a car in the windy
// regime's 8 m/s a car 20 m off was culled, though on foot it was heard 12 dB under its full gain.
test("in a car the wind masks as it plays there, through the cabin: a car across the meadow is heard as on foot less the cabin's loss, in any wind", () => {
  for (const wind of [USUAL_WIND, 6, 8]) {
    for (const metres of [10, 20, 40]) {
      const engine = (inside: boolean) => {
        const director = rig(),
          other = car(2, "panda", away(MEADOW, metres, SOUTH), { rpm: 3000, load: 0.5 }),
          mine = car(5, "panda", MEADOW, { mine: true })
        director.hear(
          world(
            MEADOW,
            { vehicles: inside ? [other, mine] : [other], weather: { ...CALM, wind } },
            inside ? 5 : undefined,
          ),
          2,
        )
        return director.held().get("engine:2")?.at.gain ?? 0
      }
      const lost = gainToDb(engine(false) / engine(true))
      assert.ok(Math.abs(lost - CABIN.panda.loss) < 0.1, `${wind} m/s, ${metres} m: ${lost} dB`)
    }
  }
})

test("night stills the valley: the wind's floor falls to the night's, so steps are heard farther; no songbird sings in the woods all night", () => {
  const director = rig()
  director.hear(world(SPAWN, { sky: NIGHT }), 2)
  const wind = director.held().get("wind")?.sound
  assert.ok(
    wind?.kind === "wind" && Math.abs(windDb(wind.strength) - NIGHT_DB) < 1e-9,
    JSON.stringify(wind),
  )
  // On the meadow on a still day and a still night: someone walking 70 m off.
  const steps = (sky: Heard["sky"]) => {
    const one = rig(),
      start = away(MEADOW, 70, SOUTH)
    for (let i = 0; i <= 180; i++)
      one.hear(
        world(MEADOW, {
          people: [person(9, { x: start.x + 2.2 * i * FRAME, y: start.y }, { vx: 2.2 })],
          sky,
          weather: { ...CALM, wind: 0 },
        }),
      )
    return one.take("step").length
  }
  assert.ok(
    steps(MORNING) === 0 && steps(NIGHT) > 3,
    `${steps(MORNING)} by day, ${steps(NIGHT)} at night`,
  )
  const woods = rig()
  woods.hear(world(HILLSIDE, { sky: NIGHT }), 60 * 60)
  assert.equal(
    woods.take("bird").filter((p) => p.sound.kind === "bird" && p.sound.species !== "owl").length,
    0,
  )
})

test("songbirds sing a dawn chorus, louder than the day's song; at dusk they roost; heavy rain silences them", () => {
  const sunrise = skyAt(at(7, 45))
  assert.ok(
    birdActivity(sunrise.sun, true, 0) > 2 && birdActivity(MORNING.sun, true, 0) === 1,
    `${sunrise.sun}°`,
  )
  assert.equal(birdActivity(-7, false, 0), 0)
  assert.equal(birdActivity(MORNING.sun, true, 10), 0)
  const birds = (sky: Heard["sky"], weather = CALM) => {
    const director = rig()
    director.hear(world(HILLSIDE, { sky, weather }), 120 * 60)
    return director.take("bird").length
  }
  assert.ok(
    birds(sunrise) > 1.5 * birds(MORNING),
    `${birds(sunrise)} at dawn, ${birds(MORNING)} at 10:10`,
  )
  assert.equal(birds(MORNING, raining(10)), 0)
})

test("at night a tawny owl calls from its wood, no owl more than once in 30 s; none by day", () => {
  const owls = owlsNear(HILLSIDE.x, HILLSIDE.y, 600)
  assert.ok(owls.length > 0)
  const calls = (sky: Heard["sky"]) => {
    const director = rig()
    director.hear(world(HILLSIDE, { sky }), 180 * 60)
    return director.take("bird").filter((p) => p.sound.kind === "bird" && p.sound.species === "owl")
  }
  const night = calls(NIGHT)
  assert.ok(night.length > 0, "an owl in three minutes")
  // The listener stands still, so each owl keeps its own place in the stereo image.
  for (const [pan, plays] of Map.groupBy(night, (p) => p.at.pan.toFixed(9))) {
    assert.ok(
      plays.every((p, i) => i === 0 || p.t - plays[i - 1]!.t >= 30),
      `the owl at pan ${pan}: ${plays.map((p) => p.t)}`,
    )
  }
  assert.equal(calls(MORNING).length, 0)
})

// Regression: with no audio context nothing was heard, yet the ring was marked rung, so the 08:00 a new game holds behind its title
// card was used up there and its bells never rang.
test("an hour's ring waits for the audio context: the 08:00 held behind the title card strikes eight times once the context runs", () => {
  const director = rig(0),
    eight = world(BELFRY, { sky: skyAt(at(8)) })
  director.hear(eight, 120, 0)
  assert.equal(director.plays.length, 0)
  director.hear(eight, 30 * 60)
  // Monzone Alto's tower, 50 m off: its loudest strokes (its echoes are fainter).
  const tower = bells.reduce((a, b) =>
    Math.hypot(b.x - BELFRY.x, b.y - BELFRY.y) < Math.hypot(a.x - BELFRY.x, a.y - BELFRY.y) ? b : a,
  )
  const strokes = director
    .take("bell")
    .filter((p) => p.sound.kind === "bell" && p.sound.pitch === tower.pitch)
  assert.equal(
    strokes.filter((p) => p.at.gain === Math.max(...strokes.map((s) => s.at.gain))).length,
    8,
  )
})

// Regression: the ridge's silence was its wind's masking, not its air: in still air it sang at 11 °C.
test("crickets sing in warm, dry air at the ears: on the meadow at 11 °C, not on the ridge 580 m higher in the same air, nor in the cold or the rain", () => {
  const crickets = (spot: { readonly x: number; readonly y: number }, weather: WeatherValue) => {
    const director = rig()
    director.hear(world(spot, { weather }))
    return director.held().get("crickets")?.sound
  }
  // Still air, so no wind masks them; the air mass that brings `spot` to 11 °C this morning.
  const still = { ...CALM, wind: 0 }
  const at11 = (spot: { readonly x: number; readonly y: number }): WeatherValue => ({
    ...still,
    anomaly:
      11 - conditionsAt(MORNING.seconds, still, spot.x, spot.y, groundZ(spot.x, spot.y)).celsius,
  })
  const sung = crickets(MEADOW, at11(MEADOW)),
    ridge = crickets(RIDGE, at11(RIDGE))
  assert.ok(
    sung?.kind === "crickets" && Math.abs(sung.celsius - 11) < 1e-9 && ridge?.kind === "crickets",
    JSON.stringify([sung, ridge]),
  )
  assert.equal(crickets(RIDGE, at11(MEADOW)), undefined)
  // A cold air mass: 6 °C under the normal leaves a clear late-October morning under the crickets' 10 °C (7 °C on the meadow).
  assert.equal(crickets(MEADOW, { ...CALM, anomaly: -6 }), undefined)
  assert.equal(crickets(MEADOW, { ...raining(2), anomaly: 1 }), undefined)
})

test("snow hushes the valley: a car farther off is fainter, a street's reverb drier, the leaves stiller, and steps crunch in it", () => {
  const gain = (weather: WeatherValue) => {
    const director = rig()
    director.hear(
      world(MEADOW, { vehicles: [car(1, "panda", away(MEADOW, 100, SOUTH), FULL)], weather }),
    )
    return director.held().get("engine:1")!.at.gain
  }
  assert.ok(gain(SNOWY) < gain(CALM) * dbToGain(-10), `${gain(SNOWY)} against ${gain(CALM)}`)
  const honk = (weather: WeatherValue) => {
    const director = rig(),
      there = away(GRAGNOLA, 10, SOUTH)
    director.hear(
      world(GRAGNOLA, {
        happenings: [{ kind: "honk", car: 1, model: "panda", x: there.x, y: there.y }],
        weather,
      }),
    )
    return director.take("honk")[0]!.at.wet
  }
  assert.ok(Math.abs(honk(SNOWY) / honk(CALM) - 0.5) < 1e-9)
  const leaves = (weather: WeatherValue) => {
    const director = rig()
    director.hear(world(HILLSIDE, { weather }))
    const wind = director.held().get("wind")?.sound
    return wind?.kind === "wind" ? wind.forest : -1
  }
  assert.ok(Math.abs(leaves(SNOWY) - 0.3 * leaves(CALM)) < 1e-9 && leaves(CALM) > 0.5)
  const steps = (weather: WeatherValue) => {
    const director = rig(),
      start = away(MEADOW, 5, SOUTH)
    for (let i = 0; i <= 60; i++)
      director.hear(
        world(MEADOW, {
          people: [person(9, { x: start.x + 2.2 * i * FRAME, y: start.y }, { vx: 2.2 })],
          weather,
        }),
      )
    return director.take("step").map((p) => (p.sound.kind === "step" ? p.sound.snow : undefined))
  }
  assert.ok(
    steps(SNOWY).length > 0 &&
      steps(SNOWY).every((snow) => snow === true) &&
      steps(CALM).every((snow) => snow === false),
  )
})
