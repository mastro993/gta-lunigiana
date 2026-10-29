import assert from "node:assert/strict"
import { test } from "node:test"

import { TRAIN_TONES, trainBlasts } from "../horns.ts"
import {
  brakesQuiet,
  brakesTargets,
  clacksAhead,
  LOOKAHEAD,
  RAILS_TOP,
  railsQuiet,
  railsTargets,
} from "../rail.ts"

const FRAME = 1 / 60

test("a train rolls 30 dB quieter per decade of speed under its nominal, at its top speed, and its band follows the speed over the rails' roughness", () => {
  assert.equal(railsQuiet(RAILS_TOP), 0)
  assert.ok(Math.abs(railsQuiet(RAILS_TOP / 10) - 30) < 1e-9)
  // The voice's own gains fall as the law does.
  const top = railsTargets(RAILS_TOP),
    tenth = railsTargets(-RAILS_TOP / 10)
  assert.ok(Math.abs(20 * Math.log10(top.roar / tenth.roar) - 30) < 1e-9)
  assert.ok(Math.abs(railsTargets(80 / 3.6).band - 889) < 1, `${railsTargets(80 / 3.6).band}`)
  assert.equal(railsTargets(0).roar, 0)
})

/** The clacks of `axles` (s at time 0) rolling at `v` m/s over `joints`, frame by frame for `seconds`, as absolute times. */
const rollOver = (
  axles: ReadonlyArray<number>,
  joints: ReadonlyArray<number>,
  v: number,
  seconds: number,
  dt = FRAME,
) => {
  const times: Array<number> = []
  let from: ReadonlyArray<number> | undefined
  for (let t = 0; t < seconds; t += dt) {
    const ahead = clacksAhead(
      from,
      axles.map((a) => a + v * t),
      joints,
      v,
    )
    from = ahead.from
    times.push(...ahead.times.map((dt) => t + dt))
  }
  return times.sort((a, b) => a - b)
}

test("each axle clacks once over each joint, when it gets there, frame after frame", () => {
  // Two axles 2.6 m apart at 20 m/s over joints at 10 and 46 m: four clacks, each at the time its axle reaches its joint.
  const times = rollOver([0, -2.6], [10, 46], 20, 3)
  const expected = [10 / 20, 12.6 / 20, 46 / 20, 48.6 / 20]
  assert.equal(times.length, 4, `${times}`)
  for (const [i, t] of times.entries()) assert.ok(Math.abs(t - expected[i]!) < 1e-9, `${times}`)
  // Frames of any length (a 30 Hz display, a long one) give the same clacks.
  assert.deepEqual(rollOver([0, -2.6], [10, 46], 20, 3, 1 / 30).length, 4)
  assert.deepEqual(rollOver([0, -2.6], [10, 46], 20, 3, LOOKAHEAD).length, 4)
})

test("a train backing up clacks over the joints behind it; one too slow to clack, or after a stall, starts afresh", () => {
  assert.equal(rollOver([0], [-10, 10], -10, 2).length, 1)
  assert.equal(clacksAhead(undefined, [9.99], [10], 0.2).times.length, 0)
  // Reversed: what was scheduled ahead now lies behind, so the axle carries on from where it is.
  const ahead = clacksAhead([5], [4], [3, 6], -10)
  assert.deepEqual(
    ahead.times.map((t) => Number(t.toFixed(6))),
    [0.1],
  )
})

test("a train's brakes squeal on every stop, braking harder than a tenth of the emergency rate below 6 m/s, not coasting", () => {
  const squeal = (speed: number, brake: number) => brakesTargets({ kind: "brakes", speed, brake })
  assert.ok(squeal(2, 0.6) > 0.9)
  assert.equal(squeal(2, 0.05), 0)
  assert.equal(squeal(10, 1), 0)
  assert.equal(squeal(0, 1), 0)
  assert.ok(squeal(4, 0.3) < squeal(2, 0.6))
  assert.ok(brakesQuiet({ kind: "brakes", speed: 2, brake: 0.6 }) < 1)
  assert.ok(Number.isFinite(brakesQuiet({ kind: "brakes", speed: 10, brake: 1 })))
})

test("a train's horn sounds EN 15153-2's tones one at a time: a moderately long high blast, or the alarm, high and low in turn", () => {
  assert.ok(Math.abs(TRAIN_TONES.high - 660) <= 30 && Math.abs(TRAIN_TONES.low - 370) <= 20)
  const long = trainBlasts(false, () => 0.5)
  assert.equal(long.length, 1)
  assert.ok(long[0]!.tone === "high" && long[0]!.held >= 1 && long[0]!.held <= 2)
  const alarm = trainBlasts(true)
  // More than three short blasts (RFI's signal rules, art. 7), the tones alternating, over before the next alarm 2 s on.
  assert.ok(alarm.length > 3 && alarm.every((b) => b.held < 0.5))
  assert.ok(alarm.every((b, i) => b.tone === (i % 2 === 0 ? "high" : "low")))
  assert.ok(alarm.reduce((sum, b) => sum + b.held + 0.1, 0) < 2)
})
