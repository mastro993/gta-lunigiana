import assert from "node:assert/strict"
import { test } from "node:test"

import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Determinism } from "@typeonce/ritmo-devtools"
import { Ops } from "@typeonce/ritmo-math"

import { bindings, Game, KeyboardInput, makeRuntime, setup, update } from "../index.ts"
import { MAP } from "../map/index.ts"
import { cabOf } from "../rail/boarding.ts"
import { REVERSE_MAX } from "../rail/dynamics.ts"
import { atDoor, stopOf } from "../rail/testing.ts"
import { stage, start, teleport } from "../testing.ts"
import {
  AT_CAB,
  AT_MONZONE,
  atCab,
  driveTo,
  dwelling,
  JOYRIDE,
  LENGTH,
  line,
  NEXT,
  S,
  WAY,
} from "./railway.ts"

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

test("driving trains: driven to the next station and stopped on its platforms, a stolen train backs up no faster than 30 km/h, and boarded at its far cab it drives the other way", () => {
  const game = atCab()
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
