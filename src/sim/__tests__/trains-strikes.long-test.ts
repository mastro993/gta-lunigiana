import assert from "node:assert/strict"
import { test } from "node:test"

import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Determinism } from "@typeonce/ritmo-devtools"

import { bindings, Game, KeyboardInput, makeRuntime, setup, update } from "../index.ts"
import { linesNear, pointAt, speedAt } from "../rail/lines.ts"
import { CREEP } from "../rail/lookout.ts"
import { isHeld } from "../rail/models.ts"
import { trainDraft } from "../rail/service.ts"
import { WRECK_SPEED } from "../rail/strikes.ts"
import { aiTrain, besideWall, underRoad } from "../rail/testing.ts"
import { parkedCar, pedestrian } from "../spawning.ts"
import { jsonSave, LOOK, stage, start } from "../testing.ts"
import { LENGTH, line, NEARBY, ON_TRACK, riolo, ROAD, ROUTE, S } from "./railway.ts"

/** A car on Via Riolo's box 120 m ahead of a train and a man on the track 150 m past it: the look-out, the strike, the damage, the alarm. */
const strikes = () => [
  {
    cars: [parkedCar("panda", 0x8b8170, { x: ON_TRACK.x, y: ON_TRACK.y, angle: ROAD })],
    peds: [
      pedestrian(
        LOOK,
        { ...pointAt(line, riolo.s + 150), angle: ROAD },
        { ...ROUTE, side: 0.5 },
        { mood: "look", until: 100 * S, fx: ON_TRACK.x, fy: ON_TRACK.y },
      ),
    ],
    trains: [aiTrain(riolo.s - 120, 1, speedAt(line, riolo.s - 120))],
  },
]

test("trains: determinism and saves: trains holding for what is on the track, striking it and wrecking a car replay bit for bit, and a save taken mid-hold plays on alike", () => {
  const result = Determinism.check(
    ({ hostClock }) => {
      const made = makeRuntime({
        seed: 5,
        services: Game.Runtime.services(
          Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])),
        ),
        debug: { hostClock },
      })
      if (!made.ok) throw new Error(JSON.stringify(made.error))
      const ready = made.value.tick(setup, stage(NEARBY, strikes()[0]))
      if (!ready.ok) throw new Error(JSON.stringify(ready.error))
      return { runtime: made.value, schedules: { update } }
    },
    { schedule: "update", frames: 20 * S, hostClock: HostClock.test() },
  )
  assert.deepEqual(result, { ok: true, frames: 20 * S })
  // Those frames hold the train held, the alarm, a wreck: saved 3 s in, restored, both play on to the same world.
  const a = start([], [NEARBY, strikes()[0]], { trains: true })
  a.run(3 * S)
  assert.ok(isHeld(a.world().trains[0]!.run!.state))
  const b = start([], undefined, { trains: true })
  assert.ok(b.runtime.restore(jsonSave(a.runtime)).ok)
  const from = a.heard.impacts.length
  a.run(10 * S)
  b.run(10 * S)
  assert.deepEqual(b.world(), a.world())
  assert.deepEqual(b.heard.impacts, a.heard.impacts.slice(from))
  assert.ok(
    a.heard.impacts.some((i) => i.hit === "train" && i.fatal === true),
    "the car wrecked",
  )
})

test("trains: a train creeping on at a walk shoves a car pinned under the road bridge along, unharmed; driving it there at 6 m/s wrecks it: the blow and the crush, no hit more for the drag", () => {
  // A Panda square across the track between the road bridge's abutments.
  const at = pointAt(line, underRoad() + 5)
  const pinned = parkedCar("panda", 0x8b8170, { x: at.x, y: at.y, angle: at.angle + Math.PI / 2 })
  const away = { x: at.x + 40, y: at.y + 40, angle: 0 }
  // An AI train 600 m back: it stops for the car, sounds the horn and creeps on into it.
  const creep = start([], [away, { cars: [pinned], trains: [aiTrain(underRoad() - 600, 1, 20)] }], {
    trains: true,
    alone: true,
  })
  let touched = false
  creep.run(150 * S, () => {
    touched ||=
      creep.world().trains[0]!.run?.state === "creep" && creep.world().vehicles[0]!.vx !== 0
  })
  assert.ok(touched, "it crept on into the car")
  assert.ok(creep.world().vehicles[0]!.damage.amount < 1, "the car is not wrecked")
  assert.deepEqual(
    creep.heard.impacts.filter((i) => i.fatal === true),
    [],
    "no wrecking or killing hit",
  )
  // A driverless train at 6 m/s 10 m short of it: pinned, dragged and wrecked.
  const fast = start(
    [],
    [
      away,
      {
        cars: [pinned],
        trains: [trainDraft("atr220", { line: line.index, s: underRoad() - 5, facing: 1, v: 6 })],
      },
    ],
    { trains: true, alone: true },
  )
  fast.run(4 * S)
  const hits = fast.heard.impacts.filter((i) => i.hit === "train")
  assert.deepEqual(
    hits.map((i) => i.fatal),
    [false, true],
    "the blow, then the crush that wrecks it",
  )
  assert.ok(
    hits[1]!.speed < WRECK_SPEED,
    `slower than a wreck by the blow alone (${hits[1]!.speed} m/s)`,
  )
  // Dragged along the abutment at the train's pace, it slides along it rather than into it: no wall hit each step.
  const walls = fast.heard.impacts.filter((i) => i.hit === "wall").length
  assert.ok(walls < 8, `${walls} wall hits`)
  assert.equal(fast.world().vehicles[0]!.damage.amount, 1, "destroyed")
})

test("trains: a car the creeping train shoves against a wall beside the track is scraped along its side at a walk until the train is past it, unwrecked: no hit", () => {
  for (const [s, back, v] of [
    [besideWall()[0], 400, 15],
    [besideWall()[1], 600, 20],
  ] as const) {
    // A Panda square across the track by the wall, and an AI train coming at it: it stops, sounds the horn and creeps on.
    const at = pointAt(line, s)
    const pinned = parkedCar("panda", 0x8b8170, { x: at.x, y: at.y, angle: at.angle + Math.PI / 2 })
    const train = trainDraft(
      "atr220",
      { line: line.index, s: s - back, facing: 1, v },
      { dir: 1, stop: -1, state: "run", until: 0 },
    )
    const game = start(
      [],
      [
        { x: at.x + 40, y: at.y + 40, angle: 0 },
        { cars: [pinned], trains: [train] },
      ],
      {
        trains: true,
        alone: true,
      },
    )
    let fastest = 0
    game.run(190 * S, () => {
      const { s: nose, v: speed } = game.world().trains[0]!,
        car = game.world().vehicles[0]!
      // While the car is beside the train's body.
      const beside = linesNear(car.x, car.y, 4).find((near) => near.line === line.index)
      if (beside !== undefined && beside.s < nose && beside.s > nose - LENGTH)
        fastest = Math.max(fastest, Math.abs(speed))
    })
    const after = game.world().trains[0]!
    assert.ok(game.world().vehicles[0]!.damage.amount < 1, `at ${s}: not wrecked`)
    assert.deepEqual(
      game.heard.impacts.filter((i) => i.hit === "train"),
      [],
      `at ${s}: no hit`,
    )
    assert.ok(
      fastest > 0 && fastest <= CREEP + 0.05,
      `at ${s}: at a walk beside it, ${fastest} m/s`,
    )
    assert.ok(after.s - LENGTH > s + 10 && after.run?.state === "run", `at ${s}: past it, running`)
  }
})
