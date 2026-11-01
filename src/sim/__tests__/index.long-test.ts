import assert from "node:assert/strict"
import { test } from "node:test"

import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Determinism } from "@typeonce/ritmo-devtools"
import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { carClear } from "../body.ts"
import { STAGE_FROM } from "../damage.ts"
import {
  bindings,
  Game,
  KeyboardInput,
  makeRuntime,
  type PoseValue,
  SetClock,
  SetHandling,
  SetWeather,
  setup,
  update,
} from "../index.ts"
import { MAP } from "../map/index.ts"
import {
  distanceToEdge,
  laneOf,
  lanePoint,
  laneSide,
  roadOf,
  trafficIndex,
  walkSide,
} from "../route.ts"
import { pedestrian } from "../spawning.ts"
import {
  BATTISTI,
  battistiTraffic,
  door,
  jsonSave,
  LOOK,
  ON_BATTISTI,
  stage,
  start,
  walkClear,
} from "../testing.ts"
import { joyride, joyrideCast, WRECKED } from "./joyride.ts"

test("traffic: a car follows the roads for 30 s, never inside walls", () => {
  const { run, world } = start([], [MAP.spawns.player, { traffic: [battistiTraffic(0x74746f)] }])
  const id = world().vehicles[0]!.id
  let travelled = 0
  let last: PoseValue = ON_BATTISTI
  run(1800, () => {
    const car = world().vehicles.find((v) => v.id === id)!
    // Within a metre of a traffic road's carriageway (corners get cut): measured from every edge near it (an edge is at
    // most 25.5 m, a carriageway 12 m), so a car turning out of a lane into a wider road is judged by the wider road.
    let off = Infinity
    for (const e of trafficIndex.around(car.x, car.y, [0, 40]))
      off = Math.min(off, distanceToEdge(e, car.x, car.y) - roadOf(e).w / 2)
    assert.ok(off < 1, `${off} m beyond the carriageway at (${car.x}, ${car.y})`)
    assert.ok(carClear("panda", car, 0.02), "never inside a wall")
    travelled += Vec2.distance(car, last)
    last = car
  })
  assert.ok(travelled > 60, `travelled ${travelled} m`)
})

// Regression: waiting for a person never counted as stuck, so one who stood still in the lane (or beside the cab, or on
// the verge inside the braking cone) held the car for good, and the cars queued behind it wedged turning round.
test("traffic: a person who never moves holds a car ~12 s in its lane, and beside its cab no longer than a parked car would", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const side = laneSide(BATTISTI, "panda")
  const along = (p: PoseValue) => (p.x - lane.x) * lane.dx + (p.y - lane.y) * lane.dy
  for (const [at, from, to] of [
    [12, 8, 20],
    [0.5, 2.5, 6],
  ] as const) {
    // In the lane 12 m ahead; or 1.3 m right of the standing car's axis, beside its cab (on the carriageway, clear of the body).
    const me = { ...lanePoint(lane, at, at === 12 ? side : side + 1.3), angle: 0 }
    assert.ok(
      walkClear(me) && distanceToEdge(BATTISTI.edge, me.x, me.y) < roadOf(BATTISTI.edge).w / 2,
    )
    const { run, world } = start([], [me, { traffic: [battistiTraffic(0x74746f)] }])
    const car = () => world().vehicles.find((v) => v.traffic)!
    let furthest = along(car()),
      gaveUp = -1
    run(to * 60, (frame) => {
      furthest = Math.max(furthest, along(car()))
      if (
        gaveUp < 0 &&
        (along(car()) < furthest - 0.5 || car().route?.forward !== BATTISTI.forward)
      )
        gaveUp = frame / 60
    })
    assert.ok(
      gaveUp >= from && gaveUp < to,
      `person at ${at} m: backed up or turned round after ${gaveUp} s`,
    )
  }
})

test("determinism: the same scripted joyride replays bit for bit", () => {
  const result = Determinism.check(
    ({ hostClock }) => {
      const made = makeRuntime({
        seed: 7,
        services: Game.Runtime.services(
          Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, joyride)),
        ),
        debug: { hostClock },
      })
      if (!made.ok) throw new Error(JSON.stringify(made.error))
      const ready = made.value.tick(setup, stage(...joyrideCast))
      if (!ready.ok) throw new Error(JSON.stringify(ready.error))
      // A handling off its real values: the knobs are part of what replays.
      made.value.send(SetHandling, { key: "grip", value: 1.3 })
      made.value.send(SetHandling, { key: "weightTransfer", value: 0.5 })
      // Ten game minutes a step: 100 game hours of weather, its regimes drawn from WeatherRng, wetting and drying the roads under the car.
      made.value.send(SetClock, { rate: 600 })
      return { runtime: made.value, schedules: { update } }
    },
    { schedule: "update", frames: 600, hostClock: HostClock.test() },
  )
  assert.deepEqual(result, { ok: true, frames: 600 })
})

test("saves: a snapshot taken mid-joyride, in a thunderstorm, restores through JSON and plays on identically", () => {
  const a = start(joyride, joyrideCast)
  a.runtime.send(SetHandling, { key: "power", value: 1.5 })
  // The clock fast and a storm over the map: the weather, its random stream and the storm cell are saved state too.
  a.runtime.send(SetClock, { rate: 600 })
  a.runtime.send(SetWeather, { regime: "storm", settle: true })
  const modes: Array<string> = [],
    seats: Array<number> = []
  a.run(420, () => {
    const { mode, turns } = a.view()!
    if (modes.at(-1) !== mode) modes.push(mode)
    if (seats.at(-1) !== turns) seats.push(turns)
  })
  assert.deepEqual(modes, ["foot", "driving", "foot"], "the joyride gets in, drives and gets out")
  assert.ok(seats.length > 2, `the view follows the car through the seats ${seats.join(", ")}`)
  assert.equal(seats.at(-1), seats.at(-2)! + 1, "and is turned once out")
  assert.ok(
    a.heard.cries.some((c) => c.feeling === "shock"),
    "the family came on the body",
  )
  assert.ok(
    a.world().peds.some((p) => p.leader !== undefined) &&
      a.world().animals.some((p) => p.leader !== undefined),
    "and walk on together",
  )
  assert.ok(
    a
      .world()
      .vehicles.some(
        (v) => v.damage.amount >= STAGE_FROM.severe && v.damage.amount < STAGE_FROM.destroyed,
      ),
    "and a car misfires after its crash",
  )
  assert.equal(a.heard.explosions.length, 1, "and a wreck blows up")
  assert.ok(
    a.world().peds.some((p) => p.dead !== undefined && p.dead > 0),
    "killing a bystander (the staged body died at step 0)",
  )
  assert.ok(
    a.world().vehicles.some((v) => !v.damage.exploded && v.damage.fuse > 0),
    "and setting the car beside it burning",
  )
  assert.ok(
    a.world().vehicles.some((v) => v.parked !== undefined),
    "with cars parked round the player since",
  )
  assert.deepEqual(a.world().parking.wrecked, [WRECKED], "and the wreck out of view gone for good")
  // Another seed's game: the restore brings back the save's random streams and its parking seed.
  const b = start([], undefined, { seed: 2 })
  assert.ok(b.runtime.restore(jsonSave(a.runtime)).ok)
  assert.deepEqual(b.view(), a.view())
  assert.deepEqual(b.world(), a.world())
  const from = a.heard.lightning.length
  a.run(1200)
  b.run(1200)
  assert.deepEqual(b.world(), a.world())
  assert.ok(b.heard.lightning.length > 0, "lightning after the restore")
  assert.deepEqual(b.heard.lightning, a.heard.lightning.slice(from), "the same lightning")
})

// Regression: no save reached a Witness, whose decision to gather or run is saved so that it survives one.
test("saves: a snapshot taken while a walker stands shocked by a body restores through JSON, and the witnesses decide alike", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward),
    verge = walkSide(roadOf(BATTISTI.edge)),
    angle = Ops.atan2(lane.dy, lane.dx)
  const walking = { mood: "walk", until: 0, fx: 0, fy: 0 } as const
  const body = pedestrian(
    LOOK,
    { ...lanePoint(lane, 22, verge), angle },
    { ...BATTISTI, side: verge },
    walking,
  )
  // Up the right verge toward a man lying dead on it, 12 m off, and down the left verge 12 m beyond him; the player stands by.
  const up = pedestrian(
    LOOK,
    { ...lanePoint(lane, 10, verge), angle },
    { ...BATTISTI, side: verge },
    walking,
  )
  const down = pedestrian(
    LOOK,
    { ...lanePoint(lane, 34, -verge), angle: angle + Math.PI },
    { ...BATTISTI, forward: !BATTISTI.forward, side: verge },
    walking,
  )
  const a = start([], [door(ON_BATTISTI), { bodies: [body], peds: [up, down] }])
  for (let frame = 0; !a.world().peds.some((p) => p.witness); frame++) {
    assert.ok(frame < 600, "they came on the body")
    a.run(1)
  }
  a.run(60)
  assert.ok(
    a.world().peds.some((p) => p.witness && p.mood === "shock"),
    "a witness stands shocked",
  )
  const b = start()
  assert.ok(b.runtime.restore(jsonSave(a.runtime)).ok)
  assert.deepEqual(b.world(), a.world())
  const moods = new Set<string>()
  for (let frame = 0; frame < 900; frame++) {
    a.run(1)
    b.run(1)
    for (const p of a.world().peds) moods.add(p.mood)
  }
  assert.deepEqual(b.world(), a.world())
  // Which way each goes is a roll; that both copies roll alike is the deepEqual above.
  assert.ok(moods.has("gather") || moods.has("flee"), `they decided: ${[...moods]}`)
})
