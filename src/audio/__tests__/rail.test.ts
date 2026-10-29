import assert from "node:assert/strict"
import { test } from "node:test"

import { Keyboard } from "@typeonce/ritmo-browser"

import {
  bindings,
  Game,
  Impact,
  KeyboardInput,
  makeRuntime,
  type PoseValue,
  setup,
  Whistle,
} from "../../sim/index.ts"
import { cabOf } from "../../sim/rail/boarding.ts"
import { carsOf } from "../../sim/rail/consist.ts"
import { CROSSINGS } from "../../sim/rail/crossings.ts"
import { LINES, pointAt } from "../../sim/rail/lines.ts"
import { TRAINS } from "../../sim/rail/models.ts"
import {
  aboard,
  aiTrain,
  atDoor,
  MONZONE,
  noTrains,
  RIOLO,
  setCrossing,
} from "../../sim/rail/testing.ts"
import { stage } from "../../sim/testing.ts"
import { Audio, audio } from "../index.ts"
import { heardCrossings, heardTrain, railImpact, trainRevs } from "../rail.ts"
import type { Body, Heard } from "../types.ts"

const ENGINE = TRAINS.atr220.engine
const motion = (s: number, more = {}) => ({
  line: 0,
  s,
  prev: s,
  v: 0,
  facing: 1 as const,
  power: 0,
  brake: 0,
  ...more,
})

test("a train's power packs idle with the power off and run to their rated revs at full power, whichever way it goes", () => {
  assert.deepEqual(trainRevs(ENGINE, 0), { rpm: ENGINE.idle, load: 0 })
  assert.deepEqual(trainRevs(ENGINE, 1), { rpm: ENGINE.redline, load: 1 })
  assert.deepEqual(trainRevs(ENGINE, -0.5), trainRevs(ENGINE, 0.5))
  assert.equal(trainRevs(ENGINE, Number.NaN).load, 0)
})

test("a train is heard car by car from its active cab back, each car's middle on the track with its s and whether it is in a tunnel", () => {
  const tunnel = LINES[0]!.tunnels[0]!,
    // Nose 15 m into the first tunnel, toward +s: the cab car's middle in it, the rest out.
    t = heardTrain(1, "atr220", motion(tunnel.from + 15, { power: 0.5, v: 5 }), false)!
  assert.deepEqual(
    t.cars.map((car) => car.tunnel),
    [true, false, false],
  )
  assert.ok(Math.abs(t.cars[0]!.s - (tunnel.from + 15 - TRAINS.atr220.cars[0] / 2)) < 1e-9)
  const mid = pointAt(LINES[0]!, t.cars[1]!.s)
  assert.ok(Math.hypot(mid.x - t.cars[1]!.x, mid.y - t.cars[1]!.y) < 0.5)
  assert.ok(t.rpm > ENGINE.idle && t.load === 0.5 && t.v === 5)
  assert.equal(heardTrain(1, "atr220", motion(0, { line: 99 }), false), undefined)
})

test("a road's level crossing rings from the warning until its arms are down; a foot crossing has no bell", () => {
  const roads = CROSSINGS.flatMap((box, i) => (box.walk ? [] : [i]))
  const at = (phase: "open" | "warning" | "lowering" | "closed" | "raising") =>
    heardCrossings(
      CROSSINGS.map(() => ({ phase, since: 0, from: 0, demanded: 0 })),
      10,
    )
  assert.deepEqual(
    at("warning").map((c) => c.id),
    roads,
  )
  for (const phase of ["warning", "lowering"] as const)
    assert.ok(
      at(phase).every((c) => c.ringing),
      phase,
    )
  for (const phase of ["open", "closed", "raising"] as const)
    assert.ok(
      at(phase).every((c) => !c.ringing),
      phase,
    )
})

test("hits with trains are heard as steel: a car meeting a train is its own hit on a steel wall, two trains meeting crash both, a struck person has no vehicle body", () => {
  const panda: Body = { model: "panda", zone: "front" }
  const bodyAt = (id: number) => (id === 7 ? panda : undefined)
  const t = heardTrain(1, "atr220", motion(4000), false)!,
    u = heardTrain(2, "atr220", motion(4100), false)!
  const trains = new Map([
    [1, t],
    [2, u],
  ])
  const hit = { x: t.cars[0]!.x, y: t.cars[0]!.y, speed: 9, mass: 1 }
  // Regression: every hit with a train was dropped.
  assert.deepEqual(railImpact({ ...hit, hit: "train", car: 7, other: 1 }, bodyAt, trains), [
    { kind: "impact", hit: "wall", ...hit, car: 7, other: 1, material: "sheet", body: panda },
  ])
  const met = railImpact({ ...hit, hit: "train", car: 1, other: 2, mass: 54 }, bodyAt, trains)!
  assert.deepEqual(
    met.map((h) =>
      h.kind === "impact" && h.hit === "wall" ? [h.car, h.material, h.body.model] : [],
    ),
    [
      [1, "sheet", "truck"],
      [2, "sheet", "truck"],
    ],
  )
  // The buffer stop: a wall hit whose car is a train, by its front.
  const buffer = railImpact({ ...hit, hit: "wall", car: 1, mass: 108 }, bodyAt, trains)!
  assert.ok(
    buffer[0]?.kind === "impact" && buffer[0].hit === "wall" && buffer[0].body.zone === "front",
  )
  const struck = railImpact(
    { ...hit, hit: "person", car: 1, other: 5, fatal: false },
    bodyAt,
    trains,
  )!
  assert.ok(
    struck[0]?.kind === "impact" && struck[0].hit === "person" && struck[0].body === undefined,
  )
  // A car's own hits are no train's.
  assert.equal(railImpact({ ...hit, hit: "wall", car: 7 }, bodyAt, trains), undefined)
  // A vehicle gone since its hit is no longer heard.
  assert.deepEqual(railImpact({ ...hit, hit: "train", car: 8, other: 1 }, bodyAt, trains), [])
})

/** A runtime with no train service, the player at `at` and the trains `trains` staged, whose Audio service records every Heard. */
const listen = (at: PoseValue, trains: ReadonlyArray<ReturnType<typeof aiTrain>>) => {
  const frames: Array<Heard> = []
  const made = makeRuntime({
    seed: 1,
    services: Game.Runtime.services(
      Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])),
      Game.Runtime.service(Audio, { hear: (heard: Heard) => frames.push(heard) }),
    ),
  })
  assert.ok(made.ok)
  const runtime = made.value
  assert.ok(runtime.tick(noTrains, setup).ok)
  assert.ok(runtime.tick(stage(at, { trains })).ok)
  return { runtime, frames, hear: () => assert.ok(runtime.tick(audio).ok) }
}

test("hear: every train car by car, a crossing's bell as its cycle says, a whistle at its train's rail head, hits with trains as steel, and the player in the cab", () => {
  const s = MONZONE.s0 + 60
  const { runtime, frames, hear } = listen(atDoor(s, 1, 0, 1), [aiTrain(s, 1)])
  hear()
  const [t] = frames[0]!.trains
  assert.ok(t !== undefined && frames[0]!.trains.length === 1 && !t.mine)
  const cars = carsOf(LINES[MONZONE.line]!, s, 1, "atr220")
  assert.deepEqual(
    t.cars.map(({ x, y, z }) => ({ x, y, z })),
    cars.map(({ x, y, z }) => ({ x, y, z })),
  )
  assert.equal(t.rpm, TRAINS.atr220.engine.idle)
  assert.ok(frames[0]!.crossings.every((c) => !c.ringing))

  assert.ok(
    runtime.tick(setCrossing(RIOLO, { phase: "warning", since: 0, from: 0, demanded: 0 })).ok,
  )
  runtime.send(Whistle, { train: t.id, x: 1, y: 2, urgent: true })
  runtime.send(Impact, { hit: "train", x: 1, y: 2, speed: 9, mass: 54, car: t.id, other: t.id })
  hear()
  assert.deepEqual(
    frames[1]!.crossings.filter((c) => c.ringing).map((c) => c.id),
    [RIOLO],
  )
  const whistle = frames[1]!.happenings.find((h) => h.kind === "whistle")
  assert.deepEqual(whistle, {
    kind: "whistle",
    train: t.id,
    x: 1,
    y: 2,
    z: t.cars[0]!.z,
    urgent: true,
  })
  assert.ok(
    frames[1]!.happenings.some(
      (h) => h.kind === "impact" && h.hit === "wall" && h.car === t.id && h.material === "sheet",
    ),
  )

  assert.ok(runtime.tick(aboard).ok)
  hear()
  const mine = frames[2]!.trains[0]!
  assert.ok(mine.mine && frames[2]!.listener.car === mine.id)
  assert.ok(
    Math.abs(
      mine.cab -
        cabOf(
          LINES[MONZONE.line]!,
          { line: MONZONE.line, s, prev: s, v: 0, facing: 1, power: 0, brake: 0 },
          "atr220",
        ).z,
    ) < 1e-9,
  )
})
