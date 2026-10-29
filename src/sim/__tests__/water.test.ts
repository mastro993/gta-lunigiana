import assert from "node:assert/strict"
import { test } from "node:test"

import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Determinism } from "@typeonce/ritmo-devtools"
import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { rigFor } from "../chassis.ts"
import { integrate } from "../dynamics.ts"
import { REAL_HANDLING } from "../handling.ts"
import {
  bindings,
  Game,
  KeyboardInput,
  makeRuntime,
  Roam,
  SetClock,
  SetWeather,
  setup,
  SkyView,
  update,
} from "../index.ts"
import { deckNear, terrainZ } from "../map/ground.ts"
import { MAP } from "../map/index.ts"
import { walkIndex } from "../route.ts"
import { animal, parkedCar, pedestrian } from "../spawning.ts"
import { stalled } from "../systems/physics.ts"
import { flood, jsonSave, LOOK, press, stage, start, type Timeline } from "../testing.ts"
import { WALK_SPEED } from "../tuning.ts"
import { VEHICLES } from "../vehicles.ts"
import { screenAxes } from "../view.ts"
import { waterUnder } from "../water/rivers.ts"

/**
 * The Torrente Lucido below Monzone station, found by geometry: the vertex of its river part nearest the station with no bridge
 * within 30 m, the way it flows there, and the way across from its north bank to its south one.
 */
const LUCIDO = (() => {
  let best: { d: number; x: number; y: number; ux: number; uy: number } | undefined
  for (const w of MAP.water.filter((o) => o.name === "Torrente Lucido" && o.kind === "river"))
    for (let i = 1; i + 1 < w.pts.length / 2; i++) {
      const x = w.pts[2 * i]!,
        y = w.pts[2 * i + 1]!,
        d = Ops.hypot(x + 493.8, y - 436.9)
      if (best !== undefined && d >= best.d) continue
      let bridge = false
      for (let k = -30; k <= 30 && !bridge; k += 2)
        for (let j = -30; j <= 30 && !bridge; j += 2)
          bridge = deckNear(x + k, y + j, 1) !== undefined
      if (bridge) continue
      const ex = w.pts[2 * i + 2]! - w.pts[2 * i - 2]!,
        ey = w.pts[2 * i + 3]! - w.pts[2 * i - 1]!,
        l = Ops.hypot(ex, ey)
      best = { d, x, y, ux: ex / l, uy: ey / l }
    }
  assert.ok(best !== undefined)
  // Across: square to the flow, toward whichever bank the home view's up key walks to.
  const { up } = screenAxes(0),
    side = up.x * -best.uy + up.y * best.ux > 0 ? 1 : -1
  return { ...best, ax: -best.uy * side, ay: best.ux * side }
})()
/** `across` m from the Lucido's middle toward the bank the up key walks to (negative: the far side), and `down` m downstream. */
const atLucido = (across: number, down = 0, angle = 0) => ({
  x: LUCIDO.x + LUCIDO.ax * across + LUCIDO.ux * down,
  y: LUCIDO.y + LUCIDO.ay * across + LUCIDO.uy * down,
  angle,
})
const acrossOf = (p: Vec2.Vec2) => (p.x - LUCIDO.x) * LUCIDO.ax + (p.y - LUCIDO.y) * LUCIDO.ay
const downOf = (p: Vec2.Vec2) => (p.x - LUCIDO.x) * LUCIDO.ux + (p.y - LUCIDO.y) * LUCIDO.uy

/** The rivers at about their mean (the Soliera gauge's 8.5 m³/s over 208 km²), and in a spate (125 m³/s there). */
const MEAN = 0.041,
  SPATE = 0.6

test("the Lucido below Monzone at its mean flow is a third of a metre deep and slow; in a spate a metre, too fast to stand in", () => {
  const mean = waterUnder(LUCIDO.x, LUCIDO.y, true, MEAN)!,
    spate = waterUnder(LUCIDO.x, LUCIDO.y, true, SPATE)!
  assert.ok(mean.depth > 0.1 && mean.depth < 0.4, `${mean.depth.toFixed(2)} m at the mean`)
  assert.ok(Vec2.length({ x: mean.vx, y: mean.vy }) < 0.7)
  assert.ok(spate.depth > 0.8 && spate.depth < 1.5, `${spate.depth.toFixed(2)} m in the spate`)
  // An adult's footing goes at a depth × speed of 1.2 m²/s (Cox et al. 2010).
  assert.ok(spate.depth * Vec2.length({ x: spate.vx, y: spate.vy }) > 1.2)
  // Downstream, and slower toward the banks.
  assert.ok(mean.vx * LUCIDO.ux + mean.vy * LUCIDO.uy > 0)
  const edge = waterUnder(atLucido(5).x, atLucido(5).y, true, SPATE)!
  assert.ok(Vec2.length({ x: edge.vx, y: edge.vy }) < Vec2.length({ x: spate.vx, y: spate.vy }))
})

test("wading: at the mean flow the player walks across the Lucido on his feet, slower than on land", () => {
  const timeline: Timeline = [{ frame: 0, press: ["up"] }]
  const game = start(timeline, [atLucido(-10)], { alone: true })
  assert.ok(game.runtime.tick(flood(MEAN)).ok)
  const speeds: Array<number> = [],
    modes = new Set<string | undefined>()
  game.run(900, () => {
    const view = game.view()!,
      water = game.world().water
    modes.add(water)
    if (water === "wading") speeds.push(Vec2.length(view.velocity))
  })
  assert.ok(modes.has("wading") && !modes.has("swimming"), "wading, never swimming")
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length
  assert.ok(mean < 0.8 * WALK_SPEED && mean > 0.3 * WALK_SPEED, `${mean.toFixed(2)} m/s wading`)
  assert.ok(acrossOf(game.view()!.pose) > 7, "and out on the far bank")
})

test("swept: in a spate the current takes the player off his feet and downstream; he swims, never drowns, and swims out", () => {
  // Carried for 4 s, then he swims for the bank the up key heads to.
  const timeline: Timeline = [{ frame: 240, press: ["up"] }]
  const game = start(timeline, [atLucido(0)], { alone: true })
  assert.ok(game.runtime.tick(flood(SPATE)).ok)
  game.run(240)
  const carried = game.view()!
  assert.equal(game.world().water, "swimming")
  assert.ok(downOf(carried.pose) > 3, `${downOf(carried.pose).toFixed(1)} m downstream in 4 s`)
  let out = -1
  game.run(1800, (frame) => {
    assert.notEqual(game.view()!.mode, "dead")
    if (out < 0 && game.world().water === undefined) out = frame
  })
  assert.ok(out > 0, "out of the water")
  assert.ok(acrossOf(game.view()!.pose) > 5, "on the bank he swam for")
})

// Regression: Wade skipped drivers, so a player who got into a car while wading kept InWater, and got out on a bridge into the river.
test("getting into a car in the water leaves the player dry while he drives", () => {
  const game = start(
    press(30, "action"),
    [atLucido(-2.2), { cars: [parkedCar("panda", 0xb8312b, atLucido(0, 0, 0))] }],
    { alone: true },
  )
  assert.ok(game.runtime.tick(flood(MEAN)).ok)
  game.run(20)
  assert.equal(game.world().water, "wading")
  game.run(40)
  assert.equal(game.view()!.mode, "driving")
  assert.equal(game.world().water, undefined)
})

/** The first dry point on the Lucido's far bank in a spate, `across` m (negative) from its middle. */
const farBank = (() => {
  let across = -20
  while (waterUnder(atLucido(across + 0.5).x, atLucido(across + 0.5).y, false, SPATE) === undefined)
    across += 0.5
  return across
})()

test("people and animals in a spate swim for the bank and walk out; the current takes the dead downstream", () => {
  const route = { edge: walkIndex.nearest(LUCIDO.x, LUCIDO.y), forward: true, side: 1 }
  const walking = { mood: "walk", until: 0, fx: 0, fy: 0 } as const
  // The dog was swept in from its home on the far bank, so its walks there take it out once it is back in its depth; the player
  // stands out of its barking range (it would stand in the water barking at him).
  const home = atLucido(farBank - 3)
  const swept = Game.Command.extend(
    animal({ species: "dog", coat: 0xc49a6c, patch: 0xc49a6c, size: 1 }, atLucido(-1, 2)),
    [Roam, { mood: "idle", until: 0, hx: home.x, hy: home.y, tx: home.x, ty: home.y }],
  )
  const game = start(
    [],
    [
      atLucido(-30),
      {
        peds: [pedestrian(LOOK, atLucido(1), route, walking)],
        bodies: [pedestrian(LOOK, atLucido(0, 4), route, walking)],
        animals: [swept],
      },
    ],
    { alone: true },
  )
  assert.ok(game.runtime.tick(flood(SPATE)).ok)
  game.run(60)
  const wet = game.world()
  assert.ok(
    wet.peds.every((p) => p.wet !== undefined) && wet.animals.every((a) => a.wet !== undefined),
  )
  const body = wet.peds.find((p) => p.dead !== undefined)!
  game.run(1800)
  const after = game.world()
  const swimmer = after.peds.find((p) => p.dead === undefined)!,
    dog = after.animals[0]!,
    drifted = after.peds.find((p) => p.id === body.id)!
  assert.equal(swimmer.wet, undefined, "the walker is out")
  assert.equal(dog.wet, undefined, "the dog is out")
  assert.ok(downOf(drifted) > downOf(body) + 5, "the body drifted downstream")
})

// Regression: people and animals kept out only by the shore walls, which ring the water's cells, walked into a spate spread past them.
test("a calm dog walking for the river in a spate stops at the water's edge and stays dry", () => {
  // The first dry point coming in from the far bank, then a step short of it.
  const across = farBank
  const dog = Game.Command.extend(
    animal({ species: "dog", coat: 0xc49a6c, patch: 0xc49a6c, size: 1 }, atLucido(across - 1)),
    [Roam, { mood: "walk", until: 600, hx: LUCIDO.x, hy: LUCIDO.y, tx: LUCIDO.x, ty: LUCIDO.y }],
  )
  const game = start([], [atLucido(-30), { animals: [dog] }], { alone: true })
  assert.ok(game.runtime.tick(flood(SPATE)).ok)
  let nearest = -Infinity
  game.run(300, () => {
    const at = game.world().animals[0]!
    assert.equal(at.wet, undefined, "dry")
    nearest = Math.max(nearest, acrossOf(at))
  })
  assert.ok(
    nearest > across - 0.5,
    `it went as far as the edge: ${nearest.toFixed(2)} against ${across}`,
  )
})

test("cars in the river: a Panda stands in the Lucido at its mean flow; in a spate it floats off downstream", () => {
  const panda = (q: number) => {
    const game = start([], [atLucido(-14), { cars: [parkedCar("panda", 0xb8312b, atLucido(0))] }], {
      alone: true,
    })
    assert.ok(game.runtime.tick(flood(q)).ok)
    game.run(600)
    return game.world().vehicles[0]!
  }
  const shallow = panda(MEAN)
  assert.ok(Vec2.distance(shallow, atLucido(0)) < 0.3, "it holds on its tyres")
  const spate = panda(SPATE)
  assert.ok(downOf(spate) > 3, `carried ${downOf(spate).toFixed(1)} m downstream`)
})

test("buoyancy: a Panda in still water keeps its wheels down at 0.3 m and floats at 0.7 m, as a 1 t Yaris did at 0.6 m", () => {
  const rig = rigFor("panda", REAL_HANDLING),
    spec = VEHICLES.panda
  const after = (depth: number) => {
    const body = {
      x: 0,
      y: 0,
      angle: 0,
      vx: 0,
      vy: 0,
      spin: 0,
      z: 100 + spec.cg,
      vz: 0,
      pitch: 0,
      pitchRate: 0,
      roll: 0,
      rollRate: 0,
    }
    let grounded = 4
    for (let k = 0; k < 600; k++)
      grounded = integrate(
        rig,
        body,
        {
          steer: 0,
          drive: 0,
          brake: 1,
          handbrake: true,
          surfaces: ["asphalt", "asphalt", "asphalt", "asphalt"],
          weather: [],
          water: { level: 100 + depth, vx: 0, vy: 0 },
        },
        1 / 60,
        () => 100,
      ).grounded
    return { grounded, lift: body.z - 100 - spec.cg }
  }
  assert.equal(after(0.3).grounded, 4)
  const afloat = after(0.7)
  assert.equal(afloat.grounded, 0)
  assert.ok(afloat.lift > 0.05, `lifted ${afloat.lift.toFixed(2)} m`)
})

test("ploughing: a Panda coasting into ankle-deep still water at 10 m/s loses a third of its speed in a second; the laden truck hardly any", () => {
  const coast = (model: "panda" | "truck", depth: number) => {
    const rig = rigFor(model, REAL_HANDLING),
      spec = VEHICLES[model]
    const body = {
      x: 0,
      y: 0,
      angle: 0,
      vx: 10,
      vy: 0,
      spin: 0,
      z: 100 + spec.cg,
      vz: 0,
      pitch: 0,
      pitchRate: 0,
      roll: 0,
      rollRate: 0,
    }
    for (let k = 0; k < 60; k++)
      integrate(
        rig,
        body,
        {
          steer: 0,
          drive: 0,
          brake: 0,
          handbrake: false,
          surfaces: spec.wheels.map(() => "asphalt" as const),
          weather: [],
          ...(depth > 0 ? { water: { level: 100 + depth, vx: 0, vy: 0 } } : {}),
        },
        1 / 60,
        () => 100,
      )
    return body.vx
  }
  assert.ok(coast("panda", 0) > 9.7, "dry, it rolls on")
  assert.ok(coast("panda", 0.15) < 7, `${coast("panda", 0.15).toFixed(2)} m/s after 1 s in 0.15 m`)
  assert.ok(coast("truck", 0.15) > 9.3, "the truck ploughs on")
})

test("stalling: water over a car's air intake stalls its engine; the truck breathes high", () => {
  const at = (model: keyof typeof VEHICLES) => ({ z: 100 + VEHICLES[model].cg })
  const water = (depth: number) => ({ level: 100 + depth, vx: 0, vy: 0 })
  assert.ok(!stalled(VEHICLES.panda, at("panda"), water(0.4)))
  assert.ok(stalled(VEHICLES.panda, at("panda"), water(0.7)))
  assert.ok(!stalled(VEHICLES.truck, at("truck"), water(1.5)))
  assert.ok(!stalled(VEHICLES.panda, at("panda"), undefined))
})

test("bridges: a walker on a bridge over the Lucido stays dry in a spate; a swimmer under it is in the water", () => {
  const crossing = (() => {
    for (const road of MAP.roads.filter((r) => r.bridge === true))
      for (let k = 0; k + 1 < road.pts.length / 2; k++)
        for (let t = 0; t <= 1; t += 0.05) {
          const x = road.pts[2 * k]! + (road.pts[2 * k + 2]! - road.pts[2 * k]!) * t,
            y = road.pts[2 * k + 1]! + (road.pts[2 * k + 3]! - road.pts[2 * k + 1]!) * t,
            under = waterUnder(x, y, true, SPATE)
          if (under !== undefined && under.depth > 0.5) return { x, y }
        }
    return undefined
  })()
  assert.ok(crossing !== undefined, "a bridge over deep water")
  assert.equal(waterUnder(crossing.x, crossing.y, false, SPATE), undefined)
  assert.ok(waterUnder(crossing.x, crossing.y, true, SPATE) !== undefined)
})

// Regression: the deck lookup skipped a bridge by its first vertex's height and read one 16 m bucket, putting verge walkers in the river.
test("bridges: every walker's verge over the water in a spate is on the deck", () => {
  let checked = 0
  for (const road of MAP.roads.filter((r) => r.bridge === true))
    for (let k = 0; k + 1 < road.pts.length / 2; k++) {
      const ax = road.pts[2 * k]!,
        ay = road.pts[2 * k + 1]!,
        dx = road.pts[2 * k + 2]! - ax,
        dy = road.pts[2 * k + 3]! - ay,
        l = Ops.hypot(dx, dy)
      for (let t = 0; t <= 1; t += 0.05)
        for (const off of [-1.2, -0.9, -0.6, 0.6, 0.9, 1.2].map(
          (e) => Math.sign(e) * (road.w / 2) + e,
        )) {
          // About the verge pedestrians walk, w/2 + 0.8 m off the centreline.
          const x = ax + dx * t - (dy / l) * off,
            y = ay + dy * t + (dx / l) * off,
            under = waterUnder(x, y, true, SPATE),
            deck = road.z[k]! + (road.z[k + 1]! - road.z[k]!) * t
          // Where the deck stands clear of the ground: at a bridge's foot the flood may reach the path.
          if (under === undefined || deck < terrainZ(x, y) + 0.5) continue
          checked++
          assert.equal(
            waterUnder(x, y, false, SPATE),
            undefined,
            `bridge ${road.id} verge at ${x}, ${y}`,
          )
        }
    }
  assert.ok(checked > 20, `${checked} verge points over deep water`)
})

test("the rivers rise under rain and fall back after it", () => {
  const made = makeRuntime({
    seed: 3,
    services: Game.Runtime.services(
      Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])),
    ),
  })
  assert.ok(made.ok && made.value.tick(setup).ok)
  const runtime = made.value,
    before = runtime.inspect(SkyView).flow
  // Ten game minutes a step: six game hours of settled rain, then twelve of a clear sky.
  runtime.send(SetClock, { rate: 600 })
  runtime.send(SetWeather, { regime: "rain", settle: true })
  for (let k = 0; k < 36; k++) assert.ok(runtime.tick(update).ok)
  const peak = runtime.inspect(SkyView).flow
  runtime.send(SetWeather, { regime: "clear", settle: true })
  for (let k = 0; k < 72; k++) assert.ok(runtime.tick(update).ok)
  const after = runtime.inspect(SkyView).flow
  assert.ok(peak > 1.5 * before, `${before.toFixed(3)} rose to ${peak.toFixed(3)} m³/s per km²`)
  assert.ok(after < 0.7 * peak, `and fell back to ${after.toFixed(3)}`)
})

/** A spate scene: the player swimming across the Lucido, a walker and a dog in the water, a parked Panda floating off. */
const SWIM: Timeline = [
  { frame: 30, press: ["up"] },
  { frame: 200, press: ["sprint"] },
  { frame: 400, release: ["up", "sprint"], press: ["left"] },
]
const swimCast = () =>
  [
    atLucido(0, -6),
    {
      cars: [parkedCar("panda", 0xb8312b, atLucido(-2, 6))],
      peds: [
        pedestrian(
          LOOK,
          atLucido(1),
          { edge: walkIndex.nearest(LUCIDO.x, LUCIDO.y), forward: true, side: 1 },
          { mood: "walk", until: 0, fx: 0, fy: 0 },
        ),
      ],
      animals: [
        animal({ species: "dog", coat: 0x1c1a19, patch: 0x1c1a19, size: 1 }, atLucido(-1, 2)),
      ],
    },
  ] as const

test("determinism: swimming, wading and a car afloat in a spate replay bit for bit", () => {
  const result = Determinism.check(
    ({ hostClock }) => {
      const made = makeRuntime({
        seed: 5,
        services: Game.Runtime.services(
          Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, SWIM)),
        ),
        debug: { hostClock },
      })
      if (!made.ok) throw new Error(JSON.stringify(made.error))
      const ready = made.value.tick(setup, stage(...swimCast()), flood(SPATE))
      if (!ready.ok) throw new Error(JSON.stringify(ready.error))
      // A minute a step: the spate drains as it runs.
      made.value.send(SetClock, { rate: 60 })
      return { runtime: made.value, schedules: { update } }
    },
    { schedule: "update", frames: 600, hostClock: HostClock.test() },
  )
  assert.deepEqual(result, { ok: true, frames: 600 })
})

test("saves: a snapshot taken mid-swim restores through JSON and plays on identically", () => {
  const a = start(SWIM, swimCast())
  assert.ok(a.runtime.tick(flood(SPATE)).ok)
  a.run(300)
  assert.equal(a.world().water, "swimming")
  assert.ok(
    a.world().peds.some((p) => p.wet !== undefined),
    "a walker in the water",
  )
  const b = start()
  assert.ok(b.runtime.restore(jsonSave(a.runtime)).ok)
  assert.deepEqual(b.world(), a.world())
  assert.deepEqual(b.view(), a.view())
  a.run(300)
  b.run(300)
  assert.deepEqual(b.world(), a.world())
})
