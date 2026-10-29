import assert from "node:assert/strict"
import { test } from "node:test"

import { leverFor } from "../driver.ts"
import {
  adhesion,
  curveDrag,
  type Lever,
  type Longitudinal,
  railGrip,
  stepTrain,
  type TrackUnder,
} from "../dynamics.ts"
import { TRAINS } from "../models.ts"

const ATR = TRAINS.atr220,
  DT = 1 / 60
const level: TrackUnder = { grade: 0, curvature: 0, grip: 1 }
const rest: Longitudinal = { s: 0, v: 0, facing: 1, power: 0, brake: 0 }

/** A train stepped `frames` times under `lever` on `track`. */
const run = (
  from: Longitudinal,
  frames: number,
  lever: (m: Longitudinal) => Lever,
  track: TrackUnder = level,
) => {
  let m = from
  for (let i = 0; i < frames; i++) m = stepTrain(ATR, m, lever(m), track, DT)
  return m
}
const full: Lever = { throttle: 1, handbrake: false },
  released: Lever = { throttle: 0, handbrake: false }

test("dynamics: an ATR 220 does what the FSE poster says: ≥ 0.5 m/s² from 0 to 40 km/h, it starts on 27 ‰, holds about 72 km/h up 25 ‰ and tops out at 130", () => {
  let m = rest,
    frames = 0
  while (m.v < 40 / 3.6) [m, frames] = [stepTrain(ATR, m, full, level, DT), frames + 1]
  const mean = m.v / (frames * DT)
  assert.ok(mean >= 0.5 && mean < 0.9, `0–40 km/h at ${mean.toFixed(2)} m/s²`)
  assert.ok(run(rest, 600, () => full, { ...level, grade: 0.027 }).s > 5, "it starts on 27 ‰")
  const climbing = run({ ...rest, v: 80 / 3.6 }, 60 * 300, () => full, { ...level, grade: 0.025 })
  assert.ok(Math.abs(climbing.v * 3.6 - 72) < 4, `${(climbing.v * 3.6).toFixed(1)} km/h up 25 ‰`)
  const flat = run({ ...rest, v: 120 / 3.6 }, 60 * 300, () => full)
  assert.ok(flat.v <= ATR.vmax + 0.05 && flat.v > ATR.vmax - 0.5, `${flat.v * 3.6} km/h`)
})

test("dynamics: brakes and resistance never reverse a train, the grade does, and at rest with the lever let go the brakes hold it", () => {
  // From 80 km/h the full service brake stops it, at about 0.9 m/s², and it stays stopped (held there, the lever would back it up).
  const braking: Lever = { throttle: -1, handbrake: false }
  const stopped = run({ ...rest, v: 80 / 3.6 }, 60 * 40, (m) => (m.v > 0 ? braking : released))
  assert.equal(stopped.v, 0)
  assert.ok(stopped.s > 250 && stopped.s < 300, `stopped in ${stopped.s.toFixed(0)} m`)
  // The emergency brake, further on snow, where the rail holds less.
  const emergency: Lever = { throttle: 0, handbrake: true }
  const dry = run({ ...rest, v: 80 / 3.6 }, 60 * 40, () => emergency)
  const snow = run({ ...rest, v: 80 / 3.6 }, 60 * 40, () => emergency, {
    ...level,
    grip: railGrip({ wet: 0, snow: 1 }),
  })
  assert.ok(dry.v === 0 && dry.s > 190 && dry.s < 240, `emergency stop in ${dry.s.toFixed(0)} m`)
  assert.ok(snow.v === 0 && snow.s > dry.s * 1.1, `on snow in ${snow.s.toFixed(0)} m`)
  // At rest on the level nothing moves it; released on 25 ‰ it rolls back; with the lever let go the brakes hold it there.
  assert.equal(run(rest, 600, () => released).s, 0)
  const bank = { ...level, grade: 0.025 }
  const rolled = run(rest, 600, () => ({ throttle: 0.01, handbrake: false }), bank)
  assert.ok(rolled.v < -1, `rolls back at ${rolled.v.toFixed(2)} m/s`)
  const held = run(rest, 600, () => released, bank)
  assert.ok(Math.abs(held.s) < 0.05 && held.v === 0, `held at ${held.s} m`)
})

test("dynamics: adhesion falls with speed (Curtius–Kniffler), wet rail and snow keep 0.6 and 0.5 of it, and Röckl's curves drag", () => {
  assert.ok(Math.abs(adhesion(0) - 0.3315) < 1e-3 && Math.abs(adhesion(60 / 3.6) - 0.233) < 1e-3)
  assert.deepEqual(
    [railGrip({ wet: 0, snow: 0 }), railGrip({ wet: 1, snow: 0 }), railGrip({ wet: 0, snow: 1 })],
    [1, 0.6, 0.5],
  )
  assert.ok(Math.abs(curveDrag(1 / 300) - 0.65 / 245) < 1e-9)
  assert.ok(Math.abs(curveDrag(1 / 200) - 0.5 / 170) < 1e-9)
  assert.ok(curveDrag(0) < 1e-6)
})

test("driver: an AI train's stop lands within 3 m of its point from line speed, dry, wet and under snow, on the level and on 25 ‰ either way, braking no harder than planned", () => {
  // Rail keeping 0.3 of its grip (leaves; the weather leaves at least 0.5) asks the plan to brake gentler than 0.6 m/s².
  for (const grip of [1, 0.6, 0.5, 0.3])
    for (const grade of [0, 0.025, -0.025])
      for (const from of grip < 0.5 ? [85 / 3.6] : [85 / 3.6, 8]) {
        const track = { grade, curvature: 0, grip }
        const at = from > 10 ? 1500 : 60
        let m: Longitudinal = { ...rest, v: from, power: 0.3 },
          hardest = 0
        for (let i = 0; i < 60 * 300 && !(m.v === 0 && i > 60); i++) {
          const throttle = leverFor(
            ATR,
            m.v,
            1,
            85 / 3.6,
            [{ d: at - m.s, v: 0, rise: grade * (at - m.s) }],
            track,
          )
          const before = m.v
          m = stepTrain(ATR, m, { throttle, handbrake: false }, track, DT)
          hardest = Math.max(hardest, (before - m.v) / DT)
        }
        const label = `grip ${grip}, ${grade * 1000} ‰, from ${from} m/s`
        assert.equal(m.v, 0)
        assert.ok(Math.abs(m.s - at) < 3, `${label}: ${(m.s - at).toFixed(2)} m off`)
        // Begun early enough that it never has to catch up: at most the plan's 0.6 m/s², and the holding brake's last half metre.
        assert.ok(hardest < 0.75, `${label}: braked at ${hardest.toFixed(2)} m/s²`)
      }
})

test("driver: an AI train holds its line speed, slows to a lower limit ahead by the time it gets there, and never runs past it", () => {
  const track = level
  let m: Longitudinal = { ...rest, v: 80 / 3.6, power: 0.3 },
    worst = 0
  for (let i = 0; i < 60 * 120; i++) {
    const limit = m.s >= 1000 ? 30 / 3.6 : 85 / 3.6
    const targets = m.s < 1000 ? [{ d: 1000 - m.s, v: 30 / 3.6, rise: 0 }] : []
    m = stepTrain(
      ATR,
      m,
      { throttle: leverFor(ATR, m.v, 1, limit, targets, track), handbrake: false },
      track,
      DT,
    )
    if (m.s >= 1000) worst = Math.max(worst, m.v - 30 / 3.6)
    if (i === 60 * 15)
      assert.ok(Math.abs(m.v - 85 / 3.6) < 0.5, `${m.v * 3.6} km/h on the open line`)
  }
  assert.ok(worst < 0.5, `${(worst * 3.6).toFixed(1)} km/h over the lower limit`)
})
