import assert from "node:assert/strict"
import { test } from "node:test"

import type { Surface } from "../../types.ts"
import type { Crash } from "../crash/hit.ts"
import { renderCrash } from "../crash/render.ts"
import { bandEnergy, centroidOf, features } from "../crash/testing.ts"
import { renderExplosion } from "../explosion.ts"

const RATE = 48000
/** Twenty draws of each sound. */
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)

/** A small deterministic random source (mulberry32), so the checks never flake. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const median = (values: ReadonlyArray<number>): number =>
  [...values].sort((a, b) => a - b)[values.length >> 1]!
const db = (power: number): number => 10 * Math.log10(Math.max(power, 1e-30))
/** RMS of x over [from, to) s, dBFS. */
const rms = (x: Float32Array, from: number, to: number): number => {
  let sum = 0,
    n = 0
  for (let i = Math.round(from * RATE); i < Math.min(x.length, to * RATE); i++, n++)
    sum += x[i]! * x[i]!
  return db(sum / Math.max(1, n))
}
/** Where in x the loudest `span` s starts, s, and its RMS, dBFS, looked for in [from, to) s every half span. */
const loudest = (
  x: Float32Array,
  span: number,
  from = 0,
  to = x.length / RATE,
): { readonly at: number; readonly db: number } => {
  let at = from,
    top = -300
  for (let t = from; t + span <= to; t += span / 2) {
    const level = rms(x, t, t + span)
    if (level > top) [at, top] = [t, level]
  }
  return { at, db: top }
}
/** x through a second-order highpass at `hz` (two one-pole stages): the clinks, without the roar under them. */
const highpass = (x: Float32Array, hz: number): Float32Array => {
  const a = 1 / (1 + (2 * Math.PI * hz) / RATE),
    y = Float32Array.from(x)
  for (let stage = 0; stage < 2; stage++) {
    for (let i = 0, last = 0, out = 0; i < y.length; i++) {
      const v = y[i]!
      out = a * (out + v - last)
      last = v
      y[i] = out
    }
  }
  return y
}

const renders = new Map<Surface, ReadonlyArray<Float32Array>>()
/** Every seed's blast with its debris landing on `surface`, rendered once. */
const blasts = (surface: Surface = "asphalt") => {
  let done = renders.get(surface)
  if (done === undefined)
    renders.set(
      surface,
      (done = SEEDS.map((seed) =>
        renderExplosion({ kind: "explosion", surface }, RATE, seeded(seed)),
      )),
    )
  return done
}
/** The reference crash, a Panda nose first into a house wall at 15 m/s, which peaks near the same nominal 0.5. */
const REFERENCE: Crash = {
  kind: "crash",
  speed: 15,
  mass: 1.015,
  body: { model: "panda", zone: "front" },
  against: { kind: "wall", material: "masonry" },
  surface: "asphalt",
}
const crashes = SEEDS.map((seed) => renderCrash(REFERENCE, RATE, seeded(seed)))

test("every blast is finite, peaks at the nominal 0.5, lasts at most 4 s and fades to silence", () => {
  for (const x of [...blasts(), ...blasts("grass")]) {
    let peak = 0
    for (const v of x) {
      assert.ok(Number.isFinite(v))
      peak = Math.max(peak, Math.abs(v))
    }
    assert.ok(Math.abs(peak - 0.5) < 1e-6, `peaks at ${peak}`)
    assert.ok(x.length <= 4 * RATE, `${x.length / RATE} s`)
    assert.ok(
      Math.abs(x.at(-1)!) < 1e-6 && Math.abs(x.at(-100)!) < peak * 1e-3,
      "ends with a click",
    )
  }
  for (const rate of [8000, 22050]) {
    const x = renderExplosion({ kind: "explosion", surface: "asphalt" }, rate, seeded(1))
    assert.ok(x.every(Number.isFinite) && x.some((v) => Math.abs(v) > 0.4), `${rate} Hz`)
  }
})

test("at the same peak a blast is louder, denser, deeper and darker than the reference crash", () => {
  const median300 = (xs: ReadonlyArray<Float32Array>) =>
    median(xs.map((x) => features(x, RATE).rms))
  const below200 = (xs: ReadonlyArray<Float32Array>) =>
    median(
      xs.map((x) => bandEnergy(x, RATE, 0, 3, 1, 200) / bandEnergy(x, RATE, 0, 3, 1, RATE / 2)),
    )
  const centroid = (xs: ReadonlyArray<Float32Array>) =>
    median(xs.map((x) => centroidOf(x, RATE, 0.03, 0.6)))
  const [loud, deep, dark] = [
    median300(blasts()) - median300(crashes),
    below200(blasts()),
    centroid(blasts()),
  ]
  assert.ok(loud >= 4, `the first 300 ms ${loud.toFixed(1)} dB over the crash's RMS`)
  assert.ok(median(blasts().map((x) => features(x, RATE).crest)) <= 9, "crest")
  assert.ok(
    deep >= below200(crashes) + 0.1,
    `${deep.toFixed(2)} of its energy under 200 Hz against ${below200(crashes).toFixed(2)}`,
  )
  assert.ok(
    dark <= centroid(crashes) - 500,
    `centroid ${dark.toFixed(0)} Hz against ${centroid(crashes).toFixed(0)}`,
  )
})

test("the blast is loudest at once, its roar carries on and dies away over about 1.5 s", () => {
  for (const x of [...blasts(), ...blasts("grass")]) {
    const onset = rms(x, 0, 0.15),
      roar = rms(x, 0.3, 1),
      late = rms(x, 1.2, 1.6),
      { at } = loudest(x, 0.05)
    assert.ok(at < 0.2, `the loudest 50 ms starts at ${at} s`)
    assert.ok(
      onset - roar <= 10 && onset - late >= 11,
      `${(onset - roar).toFixed(1)} dB down at 0.3–1 s, ${(onset - late).toFixed(1)} at 1.2–1.6 s`,
    )
  }
})

test("debris rains down: over 2 kHz its clinks stand out of the roar's tail on the road, muffled on grass", () => {
  const rain = (surface: Surface) =>
    median(blasts(surface).map((x) => loudest(highpass(x, 2000), 0.005, 1.3, 2.5).db))
  const tail = median(blasts().map((x) => rms(highpass(x, 2000), 1.3, 2.5)))
  assert.ok(
    rain("asphalt") - tail >= 10,
    `pieces ${(rain("asphalt") - tail).toFixed(1)} dB over the tail`,
  )
  assert.ok(
    rain("asphalt") - rain("grass") >= 6,
    `${rain("asphalt").toFixed(1)} on asphalt against ${rain("grass").toFixed(1)} dBFS on grass`,
  )
})
