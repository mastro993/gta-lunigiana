import assert from "node:assert/strict"
import { test } from "node:test"

import { bellLoop, STROKE } from "../crossing.ts"

const RATE = 16000

test("a crossing's bell strokes once every 1.287 s: the loop is one stroke's period long, its stroke at its start", () => {
  const loop = bellLoop(RATE)
  assert.ok(Math.abs(loop.length / RATE - 1.287) <= 1 / RATE)
  assert.equal(STROKE, 1.287)
  const peakAt = loop.reduce((best, v, i) => (Math.abs(v) > Math.abs(loop[best]!) ? i : best), 0)
  assert.ok(peakAt < 0.01 * RATE, `${peakAt / RATE} s`)
  assert.ok(Math.abs(Math.max(...loop.map(Math.abs)) - 0.5) < 1e-6)
  // A second on, the stroke has rung down 30 dB and more (the recording's −30 dB at about 1.0 s).
  const late = Math.max(
    ...loop.subarray(Math.round(1.0 * RATE), Math.round(1.1 * RATE)).map(Math.abs),
  )
  assert.ok(20 * Math.log10(late / 0.5) < -20, `${20 * Math.log10(late / 0.5)}`)
})

test("the bell's loop is a minute of strokes rung steadily: every earlier stroke's ring is in it, so it wraps with no seam", () => {
  const loop = bellLoop(RATE),
    n = loop.length
  // The same bell struck every period for 40 strokes, by brute force (no click): its last period against the loop's.
  const partials = [
    [1233.5, -17, 6.5],
    [1526, -22, 8],
    [1720, -29, 5],
    [2502.6, -20, 5],
    [3737, -4, 2.5],
    [3762.7, -2, 2.1],
    [4398, -8, 0.65],
    [5157, 0, 1.2],
    [5182, -5, 1.5],
    [6720, -7, 0.46],
    [8536, -7, 0.4],
    [10314, -3, 0.45],
  ] as const
  const struck = (i: number) => {
    let sum = 0
    for (let k = 0; k < 40; k++) {
      const t = (i + k * n) / RATE
      for (const [hz, db, t60] of partials)
        sum += 10 ** (db / 20) * Math.exp((-6.91 * t) / t60) * Math.sin(2 * Math.PI * hz * t)
    }
    return sum
  }
  // The loop is normalised: compare after the click (its first 12 ms), at the scale of a sample well into the ring.
  const scale = loop[(n / 2) | 0]! / struck((n / 2) | 0)
  for (const i of [300, 1000, 5000, 12000, n - 2, n - 1])
    assert.ok(Math.abs(loop[i]! - scale * struck(i)) < 1e-4, `${i}`)
  // Across the wrap the ring runs on: from the last sample to the next stroke's first (its click aside) is a step of the ring's own.
  let step = 0
  for (let i = 200; i < n; i++) step = Math.max(step, Math.abs(loop[i]! - loop[i - 1]!))
  assert.ok(Math.abs(scale * struck(0) - loop[n - 1]!) <= step, `${step}`)
})
