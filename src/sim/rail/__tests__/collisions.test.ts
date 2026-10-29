import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buffersOf,
  endStop,
  meet,
  type Moving,
  OVER,
  supervise,
  TOUCH_SPEED,
} from "../collisions.ts"
import { curveSpeed } from "../driver.ts"
import { REVERSE_MAX } from "../dynamics.ts"
import { DRAWN_RUN, makeLine } from "../lines.ts"
import { trainLength } from "../models.ts"

const LENGTH = trainLength("atr220")
/** A level, straight line 2 km long, east along y = 0. */
const flat = makeLine(0, [{ pts: [0, 0, 2000, 0], z: [100, 100] }])
const at = (s: number, v: number, facing: 1 | -1 = 1) => ({ s, v, facing, power: 0, brake: 0 })
const FULL = { throttle: 1, handbrake: false }

test("collisions: a driven train's buffer stops stand at the drawn run past each terminal", () => {
  assert.deepEqual(buffersOf(flat), { lo: -DRAWN_RUN, hi: 2000 + DRAWN_RUN })
})

test("collisions: SCMT leaves the lever under the braking curve to the buffer, takes the service brake over it and the emergency brake OVER past it", () => {
  const buffer = 2000 + DRAWN_RUN,
    d = 300,
    curve = curveSpeed(15, 1, { d, v: 0, rise: 0 })
  const ahead = (v: number) => supervise(flat, at(buffer - d, v), LENGTH, FULL, 1)
  assert.deepEqual(ahead(curve - 0.5), FULL)
  assert.deepEqual(ahead(curve + 0.5), { throttle: -1, handbrake: false })
  assert.deepEqual(ahead(curve + OVER + 0.5), { throttle: 0, handbrake: true })
  // Toward the start's buffer, its cab facing it 20 m short at 10 m/s: far over its curve.
  const back = supervise(flat, at(-DRAWN_RUN + 20, -10, -1), LENGTH, FULL, 1)
  assert.deepEqual(back, { throttle: 0, handbrake: true })
  // Standing, it lets the driver be.
  assert.deepEqual(supervise(flat, at(buffer - 1, 0), LENGTH, FULL, 1), FULL)
})

test("collisions: backing up, SCMT holds a driven train to 30 km/h: the service brake over it (the lever toward the cab), the emergency brake OVER past it", () => {
  // The down key backs up either way the cab faces.
  const DOWN = { throttle: -1, handbrake: false }
  const backing = (v: number, facing: 1 | -1) =>
    supervise(flat, at(1000, -facing * v, facing), LENGTH, DOWN, 1)
  for (const facing of [1, -1] as const) {
    assert.deepEqual(backing(REVERSE_MAX - 0.1, facing), DOWN)
    assert.deepEqual(backing(REVERSE_MAX + 0.1, facing), { throttle: 1, handbrake: false })
    assert.deepEqual(backing(REVERSE_MAX + OVER + 0.1, facing), { throttle: 0, handbrake: true })
  }
  // Running forward that fast it is left alone.
  assert.deepEqual(supervise(flat, at(1000, 20), LENGTH, FULL, 1), FULL)
})

test("collisions: a train past its end stop stops with its end there, and says how fast it struck it", () => {
  assert.deepEqual(endStop(at(500, 4), LENGTH, 0, 1000), { s: 500, v: 4, hit: 0, at: 500 })
  const over = endStop(at(1003, 4), LENGTH, 0, 1000)
  assert.deepEqual(over, { s: 1000, v: 0, hit: 4, at: 1000 })
  // Its tail at the low end, the cab facing +s.
  const under = endStop(at(LENGTH - 2, -3), LENGTH, 0, 1000)
  assert.ok(Math.abs(under.s - LENGTH) < 1e-9 && under.v === 0 && under.hit === 3 && under.at === 0)
})

test("collisions: trains meeting on a line go on together at their common speed, touching, the struck one shoved; slower than TOUCH_SPEED, no bump", () => {
  const train = (id: number, s: number, v: number, facing: 1 | -1 = 1): Moving => ({
    id,
    line: 0,
    s,
    v,
    facing,
    length: LENGTH,
    mass: 108000,
  })
  // Rear-ended: 10 m/s into one standing, 0.5 m into it.
  const struck = meet([train(1, 100.5, 10), train(2, 100 + LENGTH, 0)])
  const [a, b] = struck.trains
  assert.ok(Math.abs(a!.v - 5) < 1e-9 && Math.abs(b!.v - 5) < 1e-9, "the common speed")
  assert.ok(Math.abs(b!.s - LENGTH - a!.s) < 1e-9, "touching")
  assert.ok(Math.abs(a!.s - 100.25) < 1e-9, "each pushed back half the overlap")
  assert.deepEqual(struck.bumps, [{ car: 1, other: 2, line: 0, s: 100.5, speed: 10, mass: 54 }])
  // Head-on, the one facing −s struck by the faster.
  const head = meet([train(1, 100, 4), train(2, 99, -6, -1)])
  assert.ok(head.trains.every((t) => Math.abs(t.v + 1) < 1e-9))
  assert.equal(head.bumps[0]!.car, 2)
  // Touching at a walk: pushed apart, no bump; parting: no speed changes.
  assert.equal(
    meet([train(1, 100.1, TOUCH_SPEED - 0.1), train(2, 100 + LENGTH, 0)]).bumps.length,
    0,
  )
  const parting = meet([train(1, 100.1, -1), train(2, 100 + LENGTH, 1)])
  assert.deepEqual(
    parting.trains.map((t) => t.v),
    [-1, 1],
  )
  // Apart, untouched.
  const apart = [train(1, 50, 3), train(2, 200, 0)]
  assert.deepEqual(meet(apart).trains, apart)
})
