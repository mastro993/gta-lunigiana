import assert from "node:assert/strict"
import { test } from "node:test"

import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Determinism } from "@typeonce/ritmo-devtools"

import { bindings, Game, KeyboardInput, makeRuntime, SetClock, setup, update } from "../index.ts"
import { flood, stage } from "../testing.ts"
import { SPATE } from "./flows.ts"
import { SWIM, swimCast } from "./lucido.ts"

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
