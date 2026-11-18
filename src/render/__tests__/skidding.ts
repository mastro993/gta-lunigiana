// The effects host fed by its render system alone (`DrawEffects`), on a runtime of its own with a
// Panda's node to lay skids for, which effects.test.ts (Lunigiana) and effects-coast.map-test.ts
// (the coast) share. It reads the map as it loads: a process that provides another map imports it
// after that.
import assert from "node:assert/strict"

import { Group } from "three"

import { Game, makeRuntime, Skid } from "../../sim/index.ts"
import type { Surface } from "../../sim/map/surface.ts"
import { vehicleNode } from "../actors.ts"
import { RenderClock } from "../clock.ts"
import { DrawEffects, Effects, makeEffects } from "../effects.ts"
import { solidMaterial } from "../geometry.ts"
import { makeRegistries, Vehicles } from "../registries.ts"

/** A point a wheel touches: map x, y and its ground's height z, m a.s.l. */
interface Spot {
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * The tyre marks and puffs a Panda's wheel leaves, on a `runtime` of their own (a test sets its
 * rivers): each `slide` lays a step of it sliding at 10 m/s on `surface` at every spot in turn, a
 * strip of its own, draws them (`DrawEffects`) and counts every mark and puff laid so far.
 */
export const skidding = () => {
  const scene = new Group(),
    effects = makeEffects(scene),
    { vehicles } = makeRegistries(scene)
  const made = makeRuntime({
    seed: 1,
    services: Game.Runtime.services(
      Game.Runtime.service(Effects, effects),
      Game.Runtime.service(Vehicles, vehicles),
      Game.Runtime.service(RenderClock, { alpha: 0 }),
    ),
  })
  assert.ok(made.ok)
  const runtime = made.value,
    car = 1
  vehicles.ensure(car, () => vehicleNode("panda", 0xb8312b, solidMaterial))
  let step = 0
  const slide = (spots: ReadonlyArray<Spot>, surface: Surface) => {
    for (const { x, y, z } of spots)
      runtime.send(Skid, {
        car,
        wheel: 0,
        x,
        y,
        z,
        slip: 10,
        amount: 1,
        surface,
        snow: 0,
        step: ++step,
      })
    step++ // a break: the next slide starts a strip of its own
    assert.ok(runtime.tick(Game.Schedule(DrawEffects)).ok)
    return { marks: effects.marks.count, puffs: effects.smoke.mesh.count }
  }
  return { runtime, slide }
}
