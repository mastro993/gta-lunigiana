import assert from "node:assert/strict"
import { test } from "node:test"

import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Determinism } from "@typeonce/ritmo-devtools"
import { Ops } from "@typeonce/ritmo-math"

import { bindings, Game, KeyboardInput, makeRuntime, setup, TrainView, update } from "../index.ts"
import { groundZ } from "../map/ground.ts"
import { MAP } from "../map/index.ts"
import { BOARD_SPEED, cabOf } from "../rail/boarding.ts"
import { TOUCH_SPEED } from "../rail/collisions.ts"
import { CROSSINGS } from "../rail/crossings.ts"
import { LAYOVER } from "../rail/dispatch.ts"
import { REVERSE_MAX } from "../rail/dynamics.ts"
import { DRAWN_RUN, LINES, nextStop, pointAt } from "../rail/lines.ts"
import { isHeld, TRAINS, trainLength } from "../rail/models.ts"
import { trainDraft } from "../rail/service.ts"
import {
  aboard,
  aiTrain,
  atDoor,
  liveKeys,
  LOW_BRIDGE,
  MONZONE,
  OVER_ROAD,
  RAIL_BRIDGE,
  RIOLO,
  stopOf,
  TUNNEL_MOUTH,
  UNDER_ROAD,
} from "../rail/testing.ts"
import { walkIndex } from "../route.ts"
import { pedestrian } from "../spawning.ts"
import { jsonSave, LOOK, press, stage, start, teleport, type Timeline } from "../testing.ts"
import { VIEW_REACH } from "../view.ts"

const S = 60,
  LENGTH = trainLength("atr220"),
  { door } = TRAINS.atr220,
  line = LINES[MONZONE.line]!
/** From Monzone the way to its nearer neighbouring station, and that station (an index into `MAP.railway.stations`). */
const [WAY, NEXT] = (() => {
  const run = (dir: 1 | -1) => {
    const from = stopOf(MONZONE.station, dir),
      next = nextStop(line, from, dir, LENGTH)
    return { dir, next, far: next < 0 ? Number.MAX_VALUE : Math.abs(stopOf(next, dir) - from) }
  }
  const best = [run(1), run(-1)].reduce((a, b) => (b.far < a.far ? b : a))
  return [best.dir, best.next] as const
})()
/** Where a train calling at Monzone that way stands. */
const AT_MONZONE = stopOf(MONZONE.station, WAY)
/** The ATR 220 dwelling at Monzone, bound for NEXT, for a minute. */
const dwelling = () => aiTrain(AT_MONZONE, WAY, 0, 60 * S)
/** Where the player stands to board it at its active cab, on the platform's side. */
const AT_CAB = atDoor(AT_MONZONE, WAY, 0, MONZONE.side)

/** A game where the player stands at the cab of a train dwelling at Monzone, with the trains' world and the player's keys live. */
const atMonzone = (alone = true) => {
  const keys = liveKeys()
  const game = start([], [AT_CAB, { trains: [dwelling()] }], { trains: true, alone, keys })
  return { ...game, keys, train: () => game.world().trains[0]! }
}

/** Steps `game` until `done` holds (at most `frames` steps); how many it took. */
const until = (game: { run: (frames: number) => void }, frames: number, done: () => boolean) => {
  for (let frame = 0; frame < frames; frame++) {
    if (done()) return frame
    game.run(1)
  }
  return frames
}

/** The player drives the train as a driver would: up to `top` m/s, then on a 0.6 m/s² braking curve to its nose at s `to`, stopping. */
const driveTo = (game: ReturnType<typeof atMonzone>, to: number, top = 22) => {
  let fastest = 0
  until(game, 600 * S, () => {
    const train = game.train(),
      way = Math.sign(to - train.s),
      fwd = train.v * way,
      d = Math.abs(to - train.s)
    fastest = Math.max(fastest, fwd)
    const want = Math.min(top, Math.sqrt(2 * 0.6 * Math.max(0, d - 1)))
    game.keys.release("up", "down")
    if (want < 0.6 && Math.abs(fwd) < 0.6) return Math.abs(train.v) < 0.01
    // Up and down are toward and away from the cab's way.
    const push = (sign: number) => game.keys.hold(sign * train.facing > 0 ? "up" : "down")
    if (fwd < want - 0.3) push(way)
    else if (fwd > want + 0.3) push(-way)
    return false
  })
  return fastest
}

test("driving trains: the player steals a train dwelling at Monzone at its cab door: its driver gets out across the cab and runs, it is stolen, and it scores a theft", () => {
  const game = atMonzone(false)
  const view = () => game.runtime.inspect(TrainView)
  assert.deepEqual(game.view()!.nearby, {
    label: "ATR 220 Swing",
    occupied: true,
    stolen: false,
  })
  assert.deepEqual(
    view().trains.map(({ driver, state, stolen, next }) => ({ driver, state, stolen, next })),
    [
      {
        driver: "ai",
        state: "dwell",
        stolen: false,
        next: MAP.railway.stations[MONZONE.station]!.name,
      },
    ],
  )
  // The dev menu's view of the railway: no train due (the line's runs), Via Riolo open and dark.
  assert.deepEqual(view().lines[line.index], { due: null, from: 0 })
  assert.deepEqual(view().crossings[RIOLO], {
    x: CROSSINGS[RIOLO]!.x,
    y: CROSSINGS[RIOLO]!.y,
    road: MAP.roads[CROSSINGS[RIOLO]!.road]!.name ?? "",
    walk: false,
    phase: "open",
    arm: 0,
    lit: false,
    ringing: false,
  })
  game.keys.tap("action")
  game.run(2)
  const train = game.train()
  assert.equal(game.view()!.mode, "driving")
  assert.deepEqual(game.view()!.vehicle, { label: "ATR 220 Swing", speed: 0, kind: "train" })
  assert.ok(train.run === undefined && train.stolen, "the AI driver gone, the train stolen")
  assert.equal(game.world().score.stolen, 1)
  assert.deepEqual(
    view().trains.map(({ driver, state, stolen, next }) => ({ driver, state, stolen, next })),
    [{ driver: "player", state: undefined, stolen: true, next: MAP.railway.stations[NEXT]!.name }],
  )
  // The driver out of the cab's other door, running from it.
  const cab = cabOf(line, train, "atr220")
  const driver = game.world().peds.find((p) => Ops.hypot(p.x - cab.x, p.y - cab.y) < 4)
  assert.ok(driver?.mood === "flee", "the driver flees")
  const side = (p: { x: number; y: number }) =>
    Math.sign((p.x - cab.x) * Ops.sin(cab.track) - (p.y - cab.y) * Ops.cos(cab.track))
  assert.equal(side(driver), -MONZONE.side, "on the far side from the player")
  // The player rides in the cab.
  const { pose } = game.view()!
  assert.ok(Ops.hypot(pose.x - cab.x, pose.y - cab.y) < 1e-9 && pose.angle === cab.angle)
})

test("driving trains: standing with the lever forward, the player's train is about to go: Via Riolo ahead closes before it moves", () => {
  const game = atMonzone()
  game.keys.tap("action")
  game.run(2)
  assert.equal(game.view()!.mode, "driving")
  assert.equal(game.world().crossings[RIOLO]!.phase, "open")
  game.keys.hold(WAY * game.train().facing > 0 ? "up" : "down")
  game.run(1)
  assert.ok(Math.abs(game.train().v) < 0.1, "still standing")
  assert.equal(game.world().crossings[RIOLO]!.phase, "warning", "the bell rings at once")
})

test("driving trains: boarding an AI train at its far cab with its active cab on a bridge, its driver gets out of the far one", () => {
  // Its active cab's door over a stream, its far cab at grade.
  const s = LOW_BRIDGE + WAY * door,
    far = pointAt(line, s - WAY * (LENGTH - door))
  assert.ok(!far.bridge && !far.tunnel)
  const game = start(
    press(1, "action"),
    [atDoor(s, WAY, 1, MONZONE.side, 1), { trains: [aiTrain(s, WAY, 0, 60 * S)] }],
    { trains: true },
  )
  game.run(3)
  assert.equal(game.view()!.mode, "driving")
  // The far cab is the active one now.
  const cab = cabOf(line, game.world().trains[0]!, "atr220")
  const driver = game.world().peds.find((p) => Ops.hypot(p.x - cab.x, p.y - cab.y) < 4)
  assert.equal(driver?.mood, "flee", "the driver out of the far cab, running")
})

test("driving trains: driven to the next station and stopped on its platforms, a stolen train backs up no faster than 30 km/h, and boarded at its far cab it drives the other way", () => {
  const game = atMonzone()
  game.keys.tap("action")
  game.run(1)
  const fastest = driveTo(game, stopOf(NEXT, WAY))
  const { s0, s1 } = MAP.railway.stations[NEXT]!
  const stopped = game.train(),
    tail = stopped.s - stopped.facing * LENGTH
  assert.ok(fastest > 15, `up to ${(fastest * 3.6).toFixed(0)} km/h`)
  assert.ok(Math.min(stopped.s, tail) >= s0 && Math.max(stopped.s, tail) <= s1, "on the platforms")
  assert.ok(Math.abs(game.view()!.vehicle!.speed) < 0.01)
  // Backing up from a stand, the down key held: no faster than 30 km/h, on the grade too.
  game.keys.hold("down")
  let backing = 0
  game.run(20 * S, () => {
    backing = Math.max(backing, -game.train().v * game.train().facing)
  })
  game.keys.release("down")
  assert.ok(backing > REVERSE_MAX - 0.1 && backing < REVERSE_MAX + 0.1, `${backing * 3.6} km/h`)
  // Back to the platforms, out at the cab, and in again at the far cab.
  driveTo(game, stopOf(NEXT, WAY))
  game.keys.tap("action")
  game.run(1)
  assert.equal(game.view()!.mode, "foot")
  assert.equal(game.train().input.handbrake, true, "left on its emergency brake")
  const before = game.train(),
    far = before.s - before.facing * LENGTH
  assert.ok(game.runtime.tick(Game.Schedule(teleport(atDoor(before.s, before.facing, 1, 1)))).ok)
  game.keys.tap("action")
  game.run(1)
  const after = game.train()
  assert.equal(game.view()!.mode, "driving")
  assert.ok(
    after.facing === -before.facing && Math.abs(after.s - far) < 1e-9 && after.prev === after.s,
  )
  const cab = cabOf(line, after, "atr220")
  assert.ok(Ops.hypot(game.view()!.pose.x - cab.x, game.view()!.pose.y - cab.y) < 1e-9)
  game.keys.hold("up")
  game.run(10 * S)
  assert.ok(game.train().v * after.facing > 3, "off the other way")
})

/** A game with the player aboard a driverless ATR 220 on Monzone's line, its nose at s, facing `facing`, moving `v` m/s toward +s. */
const seated = (s: number, facing: 1 | -1, v = 0) => {
  const keys = liveKeys()
  const game = start(
    [],
    [AT_CAB, { trains: [trainDraft("atr220", { line: line.index, s, facing, v })] }],
    { trains: true, alone: true, keys },
  )
  assert.ok(game.runtime.tick(aboard).ok)
  game.run(1)
  return { ...game, keys, train: () => game.world().trains[0]! }
}

test("driving trains: no getting out faster than 1.5 m/s, on a bridge or in a tunnel, where the player goes through to the far cab instead; stopped at grade, over a road underpass or under a road bridge too, they step down at the cab with its emergency brake on", () => {
  // The cab's door over a stream, or just inside a tunnel's mouth: the ground beside it on the rail's level, but off the track bed.
  for (const [where, s] of [
    ["on a bridge", LOW_BRIDGE + WAY * door],
    ["in a tunnel", TUNNEL_MOUTH + WAY * door],
  ] as const) {
    const game = seated(s, WAY)
    game.keys.tap("action")
    game.run(2)
    assert.equal(game.view()!.mode, "driving", `still aboard ${where}`)
    const train = game.train()
    assert.deepEqual([train.s, train.facing], [s - WAY * LENGTH, -WAY], `in the far cab ${where}`)
  }
  // At grade with a road's tunnel under the cab's door or a road's deck over it: the ground beside it on the rail's level counts.
  for (const [where, s] of [
    ["over a road underpass", OVER_ROAD + WAY * door],
    ["under a road bridge", UNDER_ROAD + WAY * door],
  ] as const) {
    const game = seated(s, WAY)
    game.keys.tap("action")
    game.run(2)
    assert.equal(game.view()!.mode, "foot", `out ${where}`)
  }
  // Rolling at 2 m/s at Monzone: aboard; braked under 1.5 m/s, out.
  const game = seated(AT_MONZONE, WAY, WAY * 2)
  game.keys.tap("action")
  game.run(2)
  assert.equal(game.view()!.mode, "driving", "too fast to get out")
  game.keys.hold("down")
  until(game, 10 * S, () => Math.abs(game.train().v) < BOARD_SPEED - 0.1)
  game.keys.release("down")
  game.keys.tap("action")
  game.run(1)
  const train = game.train()
  assert.equal(game.view()!.mode, "foot")
  assert.equal(train.input.handbrake, true)
  const cab = cabOf(line, train, "atr220"),
    { pose } = game.view()!
  const off = Ops.hypot(pose.x - cab.x, pose.y - cab.y)
  assert.ok(Math.abs(off - (TRAINS.atr220.width / 2 + 0.6)) < 0.05, `beside the cab, ${off} m off`)
  game.run(3 * S)
  assert.equal(game.train().v, 0, "stopped by its emergency brake")
})

test("driving trains: on a rail bridge the view's ground is the cab's rail head, not the valley the map's ground has there", () => {
  const game = seated(RAIL_BRIDGE + WAY * door, WAY)
  const view = game.view()!,
    under = pointAt(line, RAIL_BRIDGE)
  assert.equal(view.vehicle?.kind, "train")
  assert.ok(Math.abs(view.z! - under.z) < 0.5, `${view.z} against the rail head ${under.z}`)
  assert.ok(view.z! - groundZ(view.pose.x, view.pose.y) > 3, "high over the map's ground")
  // On foot or in a car the host finds the ground itself.
  assert.equal(start().view()!.z, undefined)
})

test("driving trains: SCMT brakes a driven train to a stop at the buffer stop at the drawn run past the line's end, at full power; one too fast to stop pulls the emergency brake and strikes it, an Impact", () => {
  const buffer = line.length + DRAWN_RUN,
    service = TRAINS.atr220.service / TRAINS.atr220.emergency
  // 400 m short at 20 m/s, the up key held throughout: the service brake on its curve, never the emergency brake.
  const game = seated(buffer - 400, 1, 20)
  game.keys.hold("up")
  let hardest = 0
  game.run(90 * S, () => {
    hardest = Math.max(hardest, game.train().brake)
  })
  const held = game.train()
  assert.ok(held.s <= buffer && buffer - held.s < 5, `its nose ${buffer - held.s} m short`)
  assert.ok(Math.abs(held.v) < 0.01, "at a stand")
  assert.ok(
    hardest > service - 0.01 && hardest < service + 1e-9,
    `braked at ${hardest} of the emergency rate`,
  )
  assert.ok(
    game.heard.impacts.every((hit) => hit.speed <= TOUCH_SPEED),
    "never struck it",
  )
  // 60 m short at 25 m/s: past the curve by more than OVER, the emergency brake, and still no stopping in that.
  const fast = seated(buffer - 60, 1, 25)
  let emergency = 0
  fast.run(5 * S, () => {
    emergency = Math.max(emergency, fast.train().brake)
  })
  const [hit] = fast.heard.impacts
  assert.equal(emergency, 1, "the emergency brake")
  assert.ok(hit?.hit === "wall" && hit.car === fast.train().id, "an Impact")
  assert.ok(hit.speed > 10, `at ${hit.speed} m/s`)
  assert.ok(Math.abs(fast.train().s - buffer) < 1e-9 && fast.train().v === 0, "dead against it")
  // At the line's start, backing up to it with the cab ahead.
  const back = seated(-DRAWN_RUN + LENGTH + 100, 1, -5)
  back.keys.hold("down")
  back.run(60 * S)
  const tail = back.train().s - LENGTH
  assert.ok(tail >= -DRAWN_RUN && tail < -DRAWN_RUN + 5, `its tail ${tail + DRAWN_RUN} m short`)
  assert.ok(back.heard.impacts.every((h) => h.speed <= TOUCH_SPEED))
})

test("driving trains: a train driven into an AI train is a train Impact; the AI driver pulls the emergency brake, struck while running it sounds the alarm, and both stop", () => {
  for (const [what, nose, v, dwell] of [
    ["running", AT_MONZONE - WAY * 300, 3, undefined],
    ["dwelling", AT_MONZONE, 0, 60 * S],
  ] as const) {
    // The player's train 40 m behind it at 12 m/s, the up key held until it strikes.
    const mine = trainDraft("atr220", {
      line: line.index,
      s: nose - WAY * (LENGTH + 40),
      facing: WAY,
      v: WAY * 12,
    })
    const keys = liveKeys()
    const game = start([], [AT_CAB, { trains: [mine, aiTrain(nose, WAY, v, dwell)] }], {
      trains: true,
      alone: true,
      keys,
    })
    assert.ok(game.runtime.tick(aboard).ok)
    keys.hold("up")
    until(game, 20 * S, () => game.heard.impacts.length > 0)
    // Then the player brakes.
    keys.release("up")
    keys.hold("down")
    const trains = () => game.world().trains,
      player = trains().find((t) => t.run === undefined)!,
      ai = trains().find((t) => t.run !== undefined)!
    const [bump] = game.heard.impacts
    assert.ok(bump?.hit === "train", `${what}: a train hit`)
    assert.ok(bump.car === player.id && bump.other === ai.id, `${what}: the player's train struck`)
    assert.ok(bump.speed > 5, `${what}: at ${bump.speed} m/s`)
    const stood = until(game, 30 * S, () => trains().every((t) => Math.abs(t.v) < 0.5))
    keys.release("down")
    game.run(2 * S)
    // From about 10 m/s together, at about 1 m/s²: one on its emergency brake, the other on its service brake.
    assert.ok(stood < 13 * S, `${what}: both stopping ${stood / S} s after`)
    assert.ok(
      trains().every((t) => Math.abs(t.v) < 0.01),
      `${what}: both stand`,
    )
    // Never one through the other.
    const [a, b] = [player, ai].map((t) => {
      const ends = [t.s, t.s - t.facing * LENGTH]
      return [Math.min(...ends), Math.max(...ends)] as const
    })
    assert.ok(Math.max(a![0], b![0]) >= Math.min(a![1], b![1]) - 0.01, `${what}: apart`)
    if (what === "running") {
      assert.ok(isHeld(trains().find((t) => t.run !== undefined)!.run!.state))
      assert.ok(
        game.heard.whistles.some((w) => w.urgent && w.train === ai.id),
        "the alarm",
      )
    }
  }
})

test("driving trains: a stolen train left at Monzone goes once all of it is out of the player's view, and its line's next train is due after a layover from the nearer end", () => {
  const game = atMonzone()
  game.keys.tap("action")
  game.run(1)
  game.keys.tap("action")
  game.run(1)
  assert.equal(game.view()!.mode, "foot")
  const left = game.train()
  assert.ok(left.stolen && left.run === undefined)
  assert.deepEqual(game.world().railway[line.index], { due: null, from: 0 })
  // Away from the train, square off the track: in view 10 m short of VIEW_REACH, kept; gone 10 m past it.
  const cab = cabOf(line, left, "atr220"),
    across = { x: Ops.sin(cab.track), y: -Ops.cos(cab.track) }
  const off = (m: number) => ({ x: cab.x + across.x * m, y: cab.y + across.y * m, angle: 0 })
  assert.ok(game.runtime.tick(Game.Schedule(teleport(off(VIEW_REACH - 10)))).ok)
  game.run(S)
  assert.equal(game.world().trains.length, 1, "in view: kept")
  assert.ok(game.runtime.tick(Game.Schedule(teleport(off(VIEW_REACH + 10)))).ok)
  game.run(1)
  assert.equal(game.world().trains.length, 0, "removed")
  const { due, from } = game.world().railway[line.index]!
  const step = game.runtime.inspect(TrainView).lines[line.index]!
  assert.ok(due !== null && step.due !== null)
  assert.ok(step.due >= LAYOVER[0] - 1 && step.due <= LAYOVER[1], `due in ${step.due} s`)
  const middle = left.s - (left.facing * LENGTH) / 2
  assert.equal(from, middle < line.length / 2 ? 0 : 1)
})

test("driving trains: someone knocked down by the player's train counts on the HUD", () => {
  // A man on the track 30 m ahead of the player's train at 20 m/s, between stations, his back to it.
  const s = (AT_MONZONE + stopOf(NEXT, WAY)) / 2,
    ahead = pointAt(line, s + WAY * 30),
    away = WAY > 0 ? ahead.angle : ahead.angle + Math.PI
  const keys = liveKeys()
  const man = pedestrian(
    LOOK,
    { x: ahead.x, y: ahead.y, angle: away },
    { edge: walkIndex.nearest(ahead.x, ahead.y), forward: true, side: 0 },
    {
      mood: "look",
      until: 100 * S,
      fx: ahead.x + 10 * Ops.cos(away),
      fy: ahead.y + 10 * Ops.sin(away),
    },
  )
  const train = trainDraft("atr220", { line: line.index, s, facing: WAY, v: WAY * 20 })
  const game = start([], [AT_CAB, { trains: [train], peds: [man] }], {
    trains: true,
    alone: true,
    keys,
  })
  assert.ok(game.runtime.tick(aboard).ok)
  game.run(3 * S)
  const struck = game.heard.impacts.find((hit) => hit.hit === "person")
  assert.ok(struck !== undefined && struck.car === game.world().trains[0]!.id, "struck by it")
  assert.equal(game.world().score.knocked, 1)
})

/** The player at the cab of the train dwelling at Monzone: in at frame 1, the up key held from frame 10. */
const JOYRIDE: Timeline = [...press(1, "action"), { frame: 10, press: ["up"] }]

test("driving trains: a save taken while the player drives a stolen train out of Monzone restores through JSON and drives on alike", () => {
  const a = start(JOYRIDE, [AT_CAB, { trains: [dwelling()] }], { trains: true, alone: true })
  a.run(20 * S)
  assert.equal(a.view()!.mode, "driving")
  assert.ok(Math.abs(a.world().trains[0]!.v) > 5, "under way")
  // Restored into a game whose keys hold the up key from its first step, as `a`'s do now.
  const b = start([{ frame: 0, press: ["up"] }], [AT_CAB, { trains: [dwelling()] }], {
    trains: true,
    alone: true,
  })
  assert.ok(b.runtime.restore(jsonSave(a.runtime)).ok)
  assert.deepEqual(b.world(), a.world())
  a.run(20 * S)
  b.run(20 * S)
  assert.deepEqual(b.world(), a.world())
  assert.deepEqual(b.view(), a.view())
  assert.deepEqual(b.runtime.inspect(TrainView), a.runtime.inspect(TrainView))
})

test("driving trains: determinism: stealing a train at Monzone and driving it off replays bit for bit", () => {
  const frames = 30 * S
  const result = Determinism.check(
    ({ hostClock }) => {
      const made = makeRuntime({
        seed: 7,
        services: Game.Runtime.services(
          Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, JOYRIDE)),
        ),
        debug: { hostClock },
      })
      if (!made.ok) throw new Error(JSON.stringify(made.error))
      const ready = made.value.tick(setup, stage(AT_CAB, { trains: [dwelling()] }))
      if (!ready.ok) throw new Error(JSON.stringify(ready.error))
      return { runtime: made.value, schedules: { update } }
    },
    { schedule: "update", frames, hostClock: HostClock.test() },
  )
  assert.deepEqual(result, { ok: true, frames })
  // What those frames hold: the theft and the train under way.
  const game = start(JOYRIDE, [AT_CAB, { trains: [dwelling()] }], { trains: true, alone: true })
  game.run(frames)
  const [train] = game.world().trains
  assert.ok(game.view()!.mode === "driving" && train!.stolen && train!.run === undefined)
  assert.ok(Math.abs(train!.s - AT_MONZONE) > 100, `${Math.abs(train!.s - AT_MONZONE)} m on`)
  assert.equal(game.world().score.stolen, 1)
})
