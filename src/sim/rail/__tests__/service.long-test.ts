// The map with two lines on one track (two-lines.ts) is staged before any rail module loads; this file runs in a process of its own.
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  bindings,
  FillTrains,
  Game,
  KEEP_BEHIND,
  Keyboard,
  KeyboardInput,
  L,
  listener,
  makeRuntime,
  railStep,
  S,
  TrainWorld,
} from "./two-lines.ts"

test("service, two lines on one track: from a new game their trains run the same way, and come back the same way, so they never meet head-on: nothing strikes and nobody stands face to face in 15 min", () => {
  for (let seed = 1; seed <= 3; seed++) {
    const made = makeRuntime({
      seed,
      services: Game.Runtime.services(
        Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])),
      ),
    })
    assert.ok(made.ok)
    const runtime = made.value
    assert.ok(runtime.tick(Game.Schedule(FillTrains, Game.Schedule.applyDeferred())).ok)
    // Line 1's cab faces the other way along line 0.
    const [a, b] = runtime.inspect(TrainWorld).trains
    assert.equal(a!.facing, -b!.facing, `seed ${seed}: the same way`)
    const hits: Array<{ hit: string; speed: number }> = [],
      listen = listener(hits)
    for (let frame = 0; frame < 900 * S; frame++) assert.ok(runtime.tick(railStep, listen).ok)
    assert.deepEqual(hits, [], `seed ${seed}`)
    // On line 0's s: no train with its nose toward +s standing just short of one whose nose is toward −s.
    const noses = runtime
      .inspect(TrainWorld)
      .trains.map((t) =>
        t.line === 0
          ? { s: t.s, facing: t.facing, v: t.v }
          : { s: L - t.s, facing: -t.facing, v: t.v },
      )
    const facing = noses.some((a) =>
      noses.some((b) => a.facing > 0 && b.facing < 0 && b.s > a.s && b.s - a.s < 2 * KEEP_BEHIND),
    )
    assert.ok(!facing, `seed ${seed}: ${JSON.stringify(noses)}`)
  }
})
