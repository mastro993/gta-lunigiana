import assert from "node:assert/strict"
import { test } from "node:test"

import { Clock } from "@typeonce/ritmo"
import { Vec2 } from "@typeonce/ritmo-math"

import { MAP } from "../map/index.ts"
import { parkedCar } from "../spawning.ts"
import { WASTED } from "../systems/explosions.ts"
import { door, press, start, wear } from "../testing.ts"
import { on } from "./battisti-lane.ts"

test("explosions: the player sitting in the wreck dies with it, out of its door; 4 s later they come back on foot at the start", () => {
  const { runtime, run, view, world } = start(press(0, "action"), [
    door(on(30)),
    { cars: [parkedCar("panda", 0x3d6155, on(30))] },
  ])
  run(2)
  assert.equal(view()?.mode, "driving")
  assert.ok(runtime.tick(wear(1)).ok)
  const modes: Array<string> = []
  let died = -1
  run(900, (frame) => {
    const mode = view()!.mode
    if (modes.at(-1) !== mode) modes.push(mode)
    if (died < 0 && mode === "dead") died = frame
  })
  assert.deepEqual(modes, ["driving", "dead", "foot"])
  const me = view()!
  assert.ok(
    Vec2.distance(me.pose, MAP.spawns.player) < 1,
    `back at the start: ${JSON.stringify(me.pose)}`,
  )
  assert.equal(
    world().vehicles.some((v) => v.damage.exploded),
    true,
  )
  // Lying dead the whole of WASTED, offered nothing to do.
  const back = start(press(0, "action"), [
    door(on(30)),
    { cars: [parkedCar("panda", 0x3d6155, on(30))] },
  ])
  back.run(2)
  assert.ok(back.runtime.tick(wear(1)).ok)
  let deadFor = 0
  const counted: Array<number> = []
  back.run(900, () => {
    const me = back.view()!
    if (me.mode === "dead") {
      deadFor++
      assert.equal(me.nearby, undefined)
      counted.push(me.respawnIn!)
    } else assert.equal(me.respawnIn, undefined)
  })
  assert.ok(Math.abs(deadFor - Clock.steps(WASTED)) <= 1, `dead for ${deadFor} steps`)
  // The host reads how long until the respawn (it fetches the start's tiles first): one step less each step, down to 0.
  assert.ok(counted.every((left, k) => k === 0 || left === counted[k - 1]! - 1))
  assert.ok(
    counted.at(-1)! <= 1 && counted[0]! >= Clock.steps(WASTED) - 1,
    JSON.stringify([counted[0], counted.at(-1)]),
  )
})
