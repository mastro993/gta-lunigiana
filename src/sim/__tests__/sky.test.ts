import assert from "node:assert/strict"
import { test } from "node:test"

import type { Descriptor } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Ops } from "@typeonce/ritmo-math"

import {
  bindings,
  DEFAULT_START,
  Game,
  type GameClockValue,
  KeyboardInput,
  makeRuntime,
  type PlanValue,
  SetClock,
  SetHandling,
  SetWeather,
  setup,
  Skid,
  SkyView,
  update,
} from "../index.ts"
import { MAP } from "../map/index.ts"
import { noTrains } from "../rail/testing.ts"
import { REGIME_SPECS } from "../sky/regimes.ts"
import { jsonSave, ON_BATTISTI, rolling, start } from "../testing.ts"

/** The player out of the way, in the map's empty south-west corner: Populate brings nobody near. */
const FAR_AWAY = { x: -2800, y: -6000, angle: 0 }

test("game clock: a new game starts at 08:00 in Rome on its start day; each step adds the rate's game seconds, none at rate 0; a save keeps the time", () => {
  const { runtime, run, world } = start()
  assert.deepEqual(world().clock, { seconds: DEFAULT_START, rate: 1 })
  assert.deepEqual(runtime.inspect(SkyView).local, {
    year: 2026,
    month: 10,
    day: 22,
    hour: 8,
    minute: 0,
    second: 0,
  })
  run(60)
  assert.equal(world().clock.seconds, DEFAULT_START + 60, "a game minute a real second")
  runtime.send(SetClock, { rate: 0 })
  run(120)
  assert.deepEqual(world().clock, { seconds: DEFAULT_START + 60, rate: 0 }, "standing still")
  runtime.send(SetClock, { rate: 600, seconds: DEFAULT_START + 0.4 })
  run(60)
  assert.deepEqual(world().clock, { seconds: DEFAULT_START + 600 * 60, rate: 600 })
  assert.equal(runtime.inspect(SkyView).local.hour, 18, "ten game hours later")
  const restored = start()
  assert.ok(restored.runtime.restore(jsonSave(runtime)).ok)
  assert.deepEqual<GameClockValue>(restored.world().clock, world().clock)
})

// Regression pattern (as SetHandling's): the dev menu may send before the first update, with a render tick in between.
test("SetClock and SetWeather: a request sent before the first update still applies after another schedule ticks first", () => {
  const { runtime, run, world } = start()
  runtime.send(SetClock, { rate: 0 })
  runtime.send(SetWeather, { regime: "fog", settle: true })
  assert.ok(runtime.tick(Game.Schedule(Game.System("Test/Draw", {}, () => {}))).ok)
  run(1)
  assert.equal(world().clock.rate, 0)
  assert.deepEqual(
    [world().weather.regime, world().weather.forced, world().weather.fog],
    ["fog", true, REGIME_SPECS.fog.fog],
  )
  runtime.send(SetWeather, { regime: null })
  run(1)
  assert.equal(world().weather.forced, false)
})

test("a forced thunderstorm throws lightning, its bolts on the map, even with the clock stopped; the same game throws the same lightning", () => {
  const storm = () => {
    const game = start([], [FAR_AWAY])
    game.runtime.send(SetClock, { rate: 0 })
    game.runtime.send(SetWeather, { regime: "storm", settle: true })
    game.run(60 * 120)
    return game
  }
  const a = storm(),
    b = storm()
  const { minX, minY, maxX, maxY } = MAP.bounds
  assert.ok(
    a.heard.lightning.length >= 15,
    `${a.heard.lightning.length} flashes in two real minutes`,
  )
  assert.ok(
    a.heard.lightning.every(
      (l) => !l.bolt || (l.x >= minX && l.x <= maxX && l.y >= minY && l.y <= maxY),
    ),
  )
  assert.ok(a.heard.lightning.some((l) => l.bolt) && a.heard.lightning.some((l) => !l.bolt))
  assert.deepEqual(b.heard.lightning, a.heard.lightning)
  assert.equal(a.world().clock.seconds, DEFAULT_START, "the clock stood still")
})

test("the weather seed: a new game keeps WeatherRng's first state as the weather's seed, and a save keeps it; the same seed replays the same days, another seed others", () => {
  /** A new game from `seed`, run 12 game days at a game hour a step: its weather seed and the days it planned. */
  const game = (seed: number) => {
    const made = makeRuntime({
      seed,
      services: Game.Runtime.services(
        Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])),
      ),
    })
    assert.ok(made.ok)
    const runtime = made.value
    assert.ok(runtime.tick(noTrains, setup).ok)
    const first = jsonSave(runtime).resources["Lunigiana/WeatherRng"],
      weatherSeed = runtime.inspect(SkyView).weather.seed
    runtime.send(SetClock, { rate: 3600 })
    const days: Array<PlanValue> = []
    for (let k = 0; k < 24 * 12; k++) {
      assert.ok(runtime.tick(update).ok)
      const { plan } = runtime.inspect(SkyView).weather
      if (days.at(-1)?.day !== plan.day) days.push(plan)
    }
    assert.equal(runtime.inspect(SkyView).weather.seed, weatherSeed, "never changes")
    return { first, weatherSeed, days, runtime }
  }
  const a = game(41),
    b = game(41),
    c = game(42)
  assert.deepEqual([a.weatherSeed, a.first], [(41 ^ 0x9e3779b9) >>> 0, (41 ^ 0x9e3779b9) >>> 0])
  assert.notEqual(c.weatherSeed, a.weatherSeed)
  assert.ok(a.days.length >= 12 && a.days.every((plan) => plan.drawn))
  assert.deepEqual(b.days, a.days)
  assert.notDeepEqual(c.days, a.days)
  const restored = start()
  assert.ok(restored.runtime.restore(jsonSave(a.runtime)).ok)
  assert.deepEqual(restored.world().weather, a.runtime.inspect(SkyView).weather)
})

// Regression: the day plan drew from WeatherRng after the storm, whose draws follow where the player stands, so after a thunderstorm two
// games from one seed planned other days.
test("the weather seed alone plans the days: two games from one seed plan the same days, though their players stood apart in a storm", () => {
  /** A game from seed 1 with its player at `at`: a forced storm for half a real minute, handed back to the plan, then six game days. */
  const game = (at: { readonly x: number; readonly y: number; readonly angle: number }) => {
    const played = start([], [at])
    played.runtime.send(SetWeather, { regime: "storm", settle: true })
    played.run(60 * 30)
    played.runtime.send(SetWeather, { regime: null })
    played.runtime.send(SetClock, { rate: 3600 })
    const days: Array<PlanValue> = []
    played.run(24 * 6, () => {
      const { plan } = played.world().weather
      if (days.at(-1)?.day !== plan.day) days.push(plan)
    })
    return {
      days,
      lightning: played.heard.lightning,
      rng: jsonSave(played.runtime).resources["Lunigiana/WeatherRng"],
    }
  }
  const a = game(FAR_AWAY),
    b = game({ x: -412, y: 438, angle: 0 })
  assert.ok(
    a.lightning.length > 0 && b.lightning.length > 0 && a.rng !== b.rng,
    "the storms drew differently",
  )
  assert.ok(a.days.length >= 6)
  assert.deepEqual(b.days, a.days)
})

test("the weather's own random stream never reaches traffic or pedestrians: other weather draws, the same streets", () => {
  // Gragnola's busy streets in a forced storm; the second game differs only in the weather's random state.
  const gragnola = { x: -1751.2, y: 3360.4, angle: 0 }
  const a = start([], [gragnola])
  a.runtime.send(SetWeather, { regime: "storm", settle: true })
  a.run(1)
  const saved = jsonSave(a.runtime) as {
    readonly resources: Record<string, number>
  }
  saved.resources["Lunigiana/WeatherRng"] = (saved.resources["Lunigiana/WeatherRng"]! + 12345) >>> 0
  const b = start()
  assert.ok(b.runtime.restore(saved).ok)
  a.run(600)
  b.run(600)
  assert.ok(a.heard.lightning.length > 0 && b.heard.lightning.length > 0)
  assert.notDeepEqual(b.heard.lightning, a.heard.lightning, "the lightning differs")
  assert.ok(
    a.world().vehicles.some((v) => v.traffic) && a.world().peds.length > 0,
    "traffic and walkers about",
  )
  assert.deepEqual(b.world().vehicles, a.world().vehicles)
  assert.deepEqual(b.world().peds, a.world().peds)
  assert.equal(b.world().rng, a.world().rng)
})

test("rain: a car braking from 15 m/s on Via Cesare Battisti stops further on the wet road, its skids on bare ground, not snow", () => {
  const stops = (regime: "clear" | "rain") => {
    const game = start([], [ON_BATTISTI, { cars: [rolling("panda", ON_BATTISTI, 15, -1)] }])
    const skids = new Array<Descriptor.Descriptor.Value<typeof Skid>>()
    game.runtime.send(SetHandling, { key: "abs", value: 0 })
    game.runtime.send(SetHandling, { key: "weatherGrip", value: 1 })
    game.runtime.send(SetWeather, { regime, settle: true })
    for (let frame = 0; frame < 120; frame++) {
      game.run(1)
      assert.ok(
        game.runtime.tick(
          Game.Schedule(
            Game.System(
              "Test/Skids",
              { events: { skids: Game.System.readEvent(Skid) } },
              ({ events }) => {
                skids.push(...events.skids.all())
              },
            ),
          ),
        ).ok,
      )
    }
    const car = game.world().vehicles[0]!
    return { travelled: Ops.hypot(car.x - ON_BATTISTI.x, car.y - ON_BATTISTI.y), skids }
  }
  const dry = stops("clear"),
    wet = stops("rain")
  assert.ok(
    wet.travelled > dry.travelled * 1.15,
    `${wet.travelled} m wet against ${dry.travelled} m dry`,
  )
  assert.ok(wet.skids.length > 0 && wet.skids.every((s) => s.snow === 0), "no snow on the road")
})
