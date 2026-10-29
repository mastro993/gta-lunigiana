import assert from "node:assert/strict"
import { test } from "node:test"

import { Clock, HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Determinism } from "@typeonce/ritmo-devtools"
import { Ops } from "@typeonce/ritmo-math"

import { crashDamage } from "../damage.ts"
import { bindings, Game, KeyboardInput, makeRuntime, setup, update } from "../index.ts"
import { MAP } from "../map/index.ts"
import { CROSSINGS } from "../rail/crossings.ts"
import { LINES, linesNear, pointAt, speedAt } from "../rail/lines.ts"
import { CREEP, HORN } from "../rail/lookout.ts"
import { isHeld, trainLength } from "../rail/models.ts"
import { trainDraft } from "../rail/service.ts"
import { WRECK_SPEED } from "../rail/strikes.ts"
import {
  aiTrain,
  BESIDE_WALL,
  crossedBy,
  MONZONE,
  RIOLO,
  setCrossing,
  stopOf,
  UNDER_ROAD,
  wayInto,
} from "../rail/testing.ts"
import { parkedCar, pedestrian } from "../spawning.ts"
import { WASTED } from "../systems/explosions.ts"
import { jsonSave, LOOK, rolling, stage, start, teleport, type Timeline } from "../testing.ts"
import { screenAxes } from "../view.ts"

const S = 60,
  line = LINES[MONZONE.line]!,
  riolo = crossedBy(RIOLO, line.index),
  box = CROSSINGS[RIOLO]!,
  LENGTH = trainLength("atr220")
/** Where Via Riolo crosses the track, its heading and a way along it there (to walk), and the player watching from 35 m off. */
const ON_TRACK = pointAt(line, riolo.s),
  ROAD = box.approaches[0]!.heading,
  ROUTE = wayInto(RIOLO, 0).step,
  NEARBY = { x: box.x + 25, y: box.y + 25, angle: 0 }
/** How far a point lies from the line's centreline, m. */
const offTrack = (p: { readonly x: number; readonly y: number }) =>
  linesNear(p.x, p.y, 40).find((near) => near.line === line.index)?.distance ?? 40

test("trains: a car standing on Via Riolo's box, struck by a train at 80 km/h, is wrecked and thrown off the track; the driver pulled the emergency brake and sounded the alarm", () => {
  const game = start(
    [],
    [
      NEARBY,
      {
        cars: [parkedCar("panda", 0x8b8170, { x: ON_TRACK.x, y: ON_TRACK.y, angle: ROAD })],
        trains: [aiTrain(riolo.s - 60, 1, speedAt(line, riolo.s - 60))],
      },
    ],
    { trains: true, alone: true },
  )
  const [car] = game.world().vehicles,
    [train] = game.world().trains
  game.run(1)
  assert.equal(game.world().trains[0]!.input.handbrake, true, "the emergency brake at once")
  assert.ok(
    game.heard.whistles.some((w) => w.urgent && w.train === train!.id),
    "and the alarm",
  )
  let speeds: Array<number> = []
  game.run(6 * S, () => speeds.push(game.world().trains[0]!.v))
  const hit = game.heard.impacts.find((i) => i.hit === "train")
  assert.ok(hit !== undefined, "a train hit")
  assert.deepEqual([hit.car, hit.other, hit.fatal], [car!.id, train!.id, true])
  assert.ok(hit.speed > WRECK_SPEED, `struck at ${hit.speed.toFixed(1)} m/s`)
  const after = game.world().vehicles.find((v) => v.id === car!.id)!
  assert.equal(after.damage.amount, 1, "destroyed")
  assert.equal(after.damage.struck, train!.id)
  assert.ok(after.damage.fuse > 0, "and burning, its fuse lit")
  assert.ok(offTrack(after) > 3, `thrown ${offTrack(after).toFixed(1)} m off the track`)
  // The train is not shoved: it slows only as its brakes slow it.
  speeds = speeds.slice(0, 4 * S)
  for (let i = 1; i < speeds.length; i++)
    assert.ok(
      speeds[i - 1]! - speeds[i]! < 1.3 / S,
      `smooth at ${i}: ${speeds[i - 1]} → ${speeds[i]}`,
    )
})

test("trains: a car driven into a standing train takes a wall's hit at the closing speed, struck by the train, and stops against it", () => {
  // A standing train across Via Riolo, a car rolling at 8 m/s square into its side, 6 m off.
  const standing = trainDraft("atr220", {
    line: line.index,
    s: riolo.s + LENGTH / 2,
    facing: 1,
    v: 0,
  })
  const toward = { x: ON_TRACK.x, y: ON_TRACK.y }
  const nx = -Ops.sin(ON_TRACK.angle),
    ny = Ops.cos(ON_TRACK.angle)
  const pose = { x: toward.x + nx * 6, y: toward.y + ny * 6, angle: Ops.atan2(-ny, -nx) }
  const game = start([], [NEARBY, { cars: [rolling("panda", pose, 8, 0)], trains: [standing] }], {
    trains: true,
    alone: true,
  })
  const [train] = game.world().trains
  game.run(2 * S)
  const hit = game.heard.impacts.find((i) => i.hit === "train")
  assert.ok(hit?.fatal === false, "a train hit, not a wreck")
  assert.equal(hit.other, train!.id)
  assert.ok(Math.abs(hit.speed - 8) < 1, `at the closing speed (${hit.speed.toFixed(2)} m/s)`)
  const car = game.world().vehicles[0]!
  assert.ok(Math.abs(car.damage.amount - crashDamage("panda", hit.speed)) < 1e-9, "a wall's damage")
  assert.equal(car.damage.struck, train!.id)
  assert.ok(Ops.hypot(car.vx, car.vy) < 1, "stopped against it")
  assert.equal(game.world().trains[0]!.s, riolo.s + LENGTH / 2, "and the train never moved")
})

test("trains: the player sprinting into the side of a train standing at Monzone is stopped against it, not knocked down", () => {
  const s = stopOf(MONZONE.station, -1),
    at = pointAt(line, s + LENGTH / 2)
  // 6 m out on the platform's side, running square at the train's middle.
  const nx = Ops.sin(at.angle) * MONZONE.side,
    ny = -Ops.cos(at.angle) * MONZONE.side
  const { up, right } = screenAxes(0),
    u = -nx * up.x - ny * up.y,
    r = -nx * right.x - ny * right.y
  const keys: Array<"up" | "down" | "left" | "right" | "sprint"> = ["sprint"]
  if (Math.abs(u) > 0.38) keys.push(u > 0 ? "up" : "down")
  if (Math.abs(r) > 0.38) keys.push(r > 0 ? "right" : "left")
  const timeline: Timeline = [{ frame: 0, press: keys }]
  const game = start(
    timeline,
    [{ x: at.x + nx * 6, y: at.y + ny * 6, angle: 0 }, { trains: [aiTrain(s, -1, 0, 600 * S)] }],
    { trains: true, alone: true },
  )
  let nearest = Number.MAX_VALUE
  game.run(4 * S, () => {
    nearest = Math.min(nearest, offTrack(game.view()!.pose))
  })
  assert.ok(
    nearest < 2.2,
    `the runner reached the train's side (${nearest.toFixed(2)} m off its axis)`,
  )
  assert.equal(game.view()!.mode, "foot", "still on their feet")
  assert.deepEqual(
    game.heard.impacts.filter((i) => i.hit === "person"),
    [],
  )
})

test("trains: a train creeping on at a walk shoves a car pinned under the road bridge along, unharmed; driving it there at 6 m/s wrecks it: the blow and the crush, no hit more for the drag", () => {
  // A Panda square across the track between the road bridge's abutments.
  const at = pointAt(line, UNDER_ROAD + 5)
  const pinned = parkedCar("panda", 0x8b8170, { x: at.x, y: at.y, angle: at.angle + Math.PI / 2 })
  const away = { x: at.x + 40, y: at.y + 40, angle: 0 }
  // An AI train 600 m back: it stops for the car, sounds the horn and creeps on into it.
  const creep = start([], [away, { cars: [pinned], trains: [aiTrain(UNDER_ROAD - 600, 1, 20)] }], {
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
        trains: [trainDraft("atr220", { line: line.index, s: UNDER_ROAD - 5, facing: 1, v: 6 })],
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
    [BESIDE_WALL[0], 400, 15],
    [BESIDE_WALL[1], 600, 20],
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

test("trains: a person standing on the track ahead hears the alarm and runs off it, and the train stops short of where they stood", () => {
  // Via Riolo's arms down, a man standing on the track watching something, the train 320 m off at 80 km/h.
  const man = pedestrian(
    LOOK,
    { x: ON_TRACK.x, y: ON_TRACK.y, angle: ROAD },
    { ...ROUTE, side: 0.5 },
    { mood: "look", until: 100 * S, fx: ON_TRACK.x + 20, fy: ON_TRACK.y },
  )
  const game = start(
    [],
    [NEARBY, { peds: [man], trains: [aiTrain(riolo.s - 320, 1, speedAt(line, riolo.s - 320))] }],
    { trains: true, alone: true },
  )
  assert.ok(
    game.runtime.tick(setCrossing(RIOLO, { phase: "closed", since: 0, from: 1, demanded: 0 })).ok,
  )
  let fled = false,
    stopped: number | undefined,
    held = false
  game.run(30 * S, () => {
    const world = game.world(),
      train = world.trains[0]!
    fled ||= world.peds[0]!.mood === "flee"
    held ||= isHeld(train.run!.state)
    if (stopped === undefined && held && train.v === 0) stopped = train.s
  })
  assert.ok(
    game.heard.whistles.some((w) => w.urgent),
    "the alarm",
  )
  assert.ok(held && fled, "the driver held, the man ran")
  assert.ok(
    stopped !== undefined && stopped < riolo.s - 5,
    `stopped at ${stopped} before ${riolo.s}`,
  )
  assert.deepEqual(
    game.heard.impacts.filter((i) => i.hit === "person"),
    [],
    "nobody struck",
  )
  assert.ok(offTrack(game.world().peds[0]!) > 2.5, "off the track")
  assert.equal(game.world().trains[0]!.run!.state, "run", "and on its way again once clear")
})

test("trains: held for a car on the track, a train stands sounding the horn 10 s, Via Riolo ahead kept down, then creeps on at a walk", () => {
  // A car standing on the track 120 m short of Via Riolo, square across it; the train 420 m short at 80 km/h.
  const at = pointAt(line, riolo.s - 120)
  const game = start(
    [],
    [
      NEARBY,
      {
        cars: [parkedCar("panda", 0x8b8170, { x: at.x, y: at.y, angle: at.angle + Math.PI / 2 })],
        trains: [aiTrain(riolo.s - 420, 1, speedAt(line, riolo.s - 420))],
      },
    ],
    { trains: true, alone: true },
  )
  let stood = -1,
    crept = -1,
    fastest = 0,
    urgent = 0
  const phases = new Set<string>()
  game.run(40 * S, (frame) => {
    const train = game.world().trains[0]!
    if (stood < 0 && isHeld(train.run!.state) && train.v === 0) stood = frame
    if (stood >= 0 && crept < 0 && train.v > 0.05) crept = frame
    if (crept >= 0) fastest = Math.max(fastest, train.v)
    if (stood >= 0) phases.add(game.world().crossings[RIOLO]!.phase)
    if (stood >= 0 && crept < 0) urgent = game.heard.whistles.filter((w) => w.urgent).length
  })
  assert.ok(stood > 0 && crept > stood, `stood at ${stood}, crept at ${crept}`)
  assert.ok(Math.abs(crept - stood - HORN * S) <= 2 * S, `the horn ${(crept - stood) / S} s`)
  assert.ok(urgent >= HORN / 2, `the horn sounded on and on (${urgent})`)
  assert.ok(fastest <= CREEP + 0.05, `creeping at ${fastest.toFixed(2)} m/s`)
  assert.deepEqual([...phases], ["closed"], "Via Riolo kept down while it stood ready")
})

// Regression: each step back onto the track took the hold again with the alarm at once, so two of them (1.6 s each) started
// 1 s apart, one over the other.
test("trains: the player stepping half a pace on and off the track's edge in front of a held train hears its alarm every 2 s, never two at once", () => {
  // The train standing 200 m short of Via Riolo, the player 12 m ahead of its nose, 1.4 m off the centreline (on the track)
  // for 12 s, then 2.4 m off (clear of it) and back every 0.5 s.
  const s = riolo.s - 200,
    at = pointAt(line, s + 12),
    side = (d: number) => ({
      x: at.x + Ops.sin(at.angle) * d,
      y: at.y - Ops.cos(at.angle) * d,
      angle: 0,
    })
  const game = start([], [side(1.4), { trains: [aiTrain(s, 1, 0)] }], { trains: true, alone: true })
  const alarms: Array<number> = []
  let on = true,
    heard = 0
  game.run(30 * S, (frame) => {
    if (frame > 12 * S && frame % (S / 2) === 0) {
      on = !on
      assert.ok(game.runtime.tick(Game.Schedule(teleport(side(on ? 1.4 : 2.4)))).ok)
    }
    for (; heard < game.heard.whistles.length; heard++)
      if (game.heard.whistles[heard]!.urgent) alarms.push(frame)
  })
  const dithering = alarms.filter((frame) => frame > 12 * S)
  assert.ok(dithering.length >= 7, `${dithering.length} alarms while the player stepped on and off`)
  for (let k = 1; k < alarms.length; k++)
    assert.ok(
      alarms[k]! - alarms[k - 1]! >= 2 * S,
      `alarms ${((alarms[k]! - alarms[k - 1]!) / S).toFixed(2)} s apart at ${(alarms[k]! / S).toFixed(2)} s`,
    )
})

test("trains: someone too near to stop for is struck; the player on foot is killed and comes back at the start", () => {
  // A walker on the track 40 m ahead of a train at 80 km/h: struck, the train its `car`.
  const walker = pedestrian(
    LOOK,
    { x: ON_TRACK.x, y: ON_TRACK.y, angle: ROAD },
    { ...ROUTE, side: 0.5 },
    { mood: "look", until: 100 * S, fx: ON_TRACK.x + 20, fy: ON_TRACK.y },
  )
  const near = start(
    [],
    [NEARBY, { peds: [walker], trains: [aiTrain(riolo.s - 40, 1, speedAt(line, riolo.s - 40))] }],
    { trains: true, alone: true },
  )
  const [train] = near.world().trains
  near.run(4 * S)
  const struck = near.heard.impacts.find((i) => i.hit === "person")
  assert.ok(struck !== undefined && struck.car === train!.id, "struck by the train")
  assert.ok(struck.speed > 10 && near.world().peds[0]!.down, `knocked down at ${struck.speed}`)
  // The player standing on the track, a driverless train 25 m off at 30 m/s: a 96 % death.
  const runaway = trainDraft("atr220", { line: line.index, s: riolo.s - 25, facing: 1, v: 30 })
  const game = start([], [{ x: ON_TRACK.x, y: ON_TRACK.y, angle: ROAD }, { trains: [runaway] }], {
    trains: true,
    alone: true,
  })
  let died = -1
  game.run(2 * S, (frame) => {
    if (died < 0 && game.view()?.mode === "dead") died = frame
  })
  assert.ok(died >= 0, "killed")
  assert.ok(game.heard.impacts.some((i) => i.hit === "person" && i.fatal === true))
  game.run(Clock.steps(WASTED) + 2)
  const { mode, pose } = game.view()!
  assert.equal(mode, "foot", "back on foot")
  assert.ok(Ops.hypot(pose.x - MAP.spawns.player.x, pose.y - MAP.spawns.player.y) < 1e-6)
})

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
