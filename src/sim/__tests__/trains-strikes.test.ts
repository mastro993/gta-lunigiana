import assert from "node:assert/strict"
import { test } from "node:test"

import { Clock } from "@typeonce/ritmo"
import { Ops } from "@typeonce/ritmo-math"

import { crashDamage } from "../damage.ts"
import { Game } from "../index.ts"
import { MAP } from "../map/index.ts"
import { linesNear, pointAt, speedAt } from "../rail/lines.ts"
import { CREEP, HORN } from "../rail/lookout.ts"
import { isHeld } from "../rail/models.ts"
import { trainDraft } from "../rail/service.ts"
import { WRECK_SPEED } from "../rail/strikes.ts"
import { aiTrain, MONZONE, RIOLO, setCrossing, stopOf } from "../rail/testing.ts"
import { parkedCar, pedestrian } from "../spawning.ts"
import { WASTED } from "../systems/explosions.ts"
import { LOOK, rolling, start, teleport, type Timeline } from "../testing.ts"
import { screenAxes } from "../view.ts"
import { LENGTH, line, NEARBY, ON_TRACK, riolo, ROAD, ROUTE, S } from "./railway.ts"

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
