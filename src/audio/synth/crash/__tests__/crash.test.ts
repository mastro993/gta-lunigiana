import assert from "node:assert/strict"
import { test } from "node:test"

import type { VehicleModel } from "../../../../sim/vehicles.ts"
import type { Surface, Zone } from "../../../types.ts"
import { between } from "../dsp.ts"
import { crushSpeeds, hitOf } from "../hit.ts"
import { crashQuiet } from "../index.ts"
import { aftermath, breakage, tempered } from "../parts.ts"
import { renderCrash } from "../render.ts"
import { bandEnergy, centroidOf, layer } from "../testing.ts"
import { land } from "../textures.ts"
import { CASES, crash, median, RATE, SEEDS, seeded, type Spec, within } from "./cases.ts"

// Regression: under 16 kHz a band with no bins under Nyquist was scaled by 1/0, and every sample of a crash was NaN.
test("a crash renders finite at any device rate, 8 kHz up", () => {
  for (const rate of [8000, 16000, 22050]) {
    const x = renderCrash(crash(CASES.masonry14), rate, seeded(1))
    assert.ok(x.every(Number.isFinite) && x.some((v) => Math.abs(v) > 0.01), `${rate} Hz`)
  }
})

// Regression: the band noise looped every 1.4 s, so a long tail replayed the same noise (correlation 0.99 one loop apart).
test("a crash's noise never repeats inside a render", () => {
  for (const seed of [1, 2, 3]) {
    const x = renderCrash(crash(CASES.masonry20), RATE, seeded(seed)),
      from = Math.round(0.9 * RATE),
      n = Math.round(0.5 * RATE),
      lag = 1 << 16
    let xy = 0,
      xx = 0,
      yy = 0
    for (let i = from; i < from + n; i++) {
      xy += x[i]! * x[i + lag]!
      xx += x[i]! * x[i]!
      yy += x[i + lag]! * x[i + lag]!
    }
    assert.ok(Math.abs(xy / Math.sqrt(xx * yy)) < 0.3, `seed ${seed}: ${xy / Math.sqrt(xx * yy)}`)
  }
})

test("a seed renders the same crash twice; another seed draws another", () => {
  const a = renderCrash(crash(CASES.masonry14), RATE, seeded(7)),
    b = renderCrash(crash(CASES.masonry14), RATE, seeded(7)),
    c = renderCrash(crash(CASES.masonry14), RATE, seeded(8))
  assert.deepEqual(a, b)
  assert.ok(a.length !== c.length || a.some((v, i) => v !== c[i]))
})

// Regression: the sim's masses became kilograms and tonnes; at the full 10·log10 μ a 26 t truck's nudge played as a Panda's 15 m/s crash.
test("a laden truck crashes loud and heavy, but its 2 m/s nudge into a house plays like a Panda's 4 m/s bump and breaks nothing", () => {
  const quiet = (spec: Spec) => crashQuiet(crash(spec))
  within(
    quiet({ speed: 2, model: "truck" }) - quiet({ speed: 4 }),
    -1,
    1,
    "truck at 2 m/s re a Panda at 4",
  )
  within(
    quiet({ speed: 8, model: "truck" }) - quiet({ speed: 8 }),
    -7.5,
    -6.5,
    "truck re a Panda at 8 m/s",
  )
  assert.equal(quiet({ speed: 14, model: "truck" }), -6)
  // Each body's barrier-equivalent speed, what its parts break by: the truck's own into a wall (under the 3 m/s of the first
  // part to go), a Panda against the truck nearly its own, the truck hit by it barely any (it hardly moves).
  const [nudge] = crushSpeeds(crash({ speed: 2, model: "truck" }))
  within(nudge!, 1.99, 2.01, "the truck's nudge, m/s")
  const [panda, truck] = crushSpeeds(crash({ speed: 12, against: "truck" }))
  within(panda!, 9.5, 11, "the Panda against the truck, m/s")
  within(truck!, 1, 1.4, "the truck hit by the Panda, m/s")
})

test("bottoming out after a jump breaks no glass, lamp or airbag: nothing faces the ground", () => {
  const broken = layer(RATE, 2.5, seeded(2), (mix) => {
    const hit = hitOf(crash({ speed: 15, zone: "under" }), seeded(4))
    breakage(mix, hit, hit.bodies[0]!)
  })
  assert.ok(broken.every((v) => v === 0))
  // Nor the Giulia's light bar: its landing settles and rattles like a body with no parts of its own (the Ape's quirks are none).
  const settling = (model: VehicleModel) =>
    layer(RATE, 2.5, seeded(2), (mix) => {
      const hit = hitOf(crash({ speed: 15, model: "carabinieri", zone: "under" }), seeded(4))
      aftermath(mix, hit, { ...hit.bodies[0]!, model })
    })
  const giulia = settling("carabinieri"),
    plain = settling("ape")
  const off = giulia.reduce((most, v, i) => Math.max(most, Math.abs(v - plain[i]!)), 0)
  assert.equal(off, 0, `the landing differs by up to ${off}`)
})

// Regression: every ramp ended at the level cap (about 30 m/s), so a 42 or 60 m/s wreck rendered like a 30 m/s one.
test("past the level cap a crash grows in time: a longer tail and block, at most 3 sub-hits, another sound at 60 m/s than at 42", () => {
  const wreck = (speed: number, zone: Zone = "front") =>
    crash({ speed, model: "carabinieri", zone })
  const tails = [30, 42, 60].map((v) => hitOf(wreck(v), seeded(1)).tail)
  assert.ok(tails[0]! < tails[1]! && tails[1]! < tails[2]!, `${tails}`)
  const blocks = (v: number) => median(SEEDS.map((seed) => hitOf(wreck(v), seeded(seed)).block))
  assert.ok(blocks(30) < blocks(60), `${blocks(30)} → ${blocks(60)} s`)
  for (const seed of SEEDS) assert.ok(hitOf(wreck(40, "side"), seeded(seed)).subHits.length <= 3)
  const a = renderCrash(wreck(42), RATE, seeded(3)),
    b = renderCrash(wreck(60), RATE, seeded(3))
  let diff = 0,
    sum = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    diff += (a[i]! - b[i]!) ** 2
    sum += a[i]! ** 2
  }
  assert.ok(diff / sum > 0.01, `42 vs 60 m/s differ by ${10 * Math.log10(diff / sum)} dB`)
})

test("what broke stays broken: a side already hit at 12 m/s loses no mirror and no glass again", () => {
  const side = (worn: number) =>
    layer(RATE, 2.5, seeded(2), (mix) => {
      const hit = hitOf(
        { ...crash({ speed: 12, zone: "side" }), body: { model: "panda", zone: "side", worn } },
        seeded(4),
      )
      breakage(mix, hit, hit.bodies[0]!)
    })
  const energy = (x: Float32Array) => x.reduce((p, v) => p + v * v, 0)
  assert.ok(energy(side(0)) > 0 && energy(side(12)) === 0)
})

test("a tempered pane's shower is centred on the 8 kHz octave, and grass swallows it 14 dB and more", () => {
  const shower = (surface: Surface) =>
    layer(RATE, 2.5, seeded(3), (mix) =>
      tempered(mix, hitOf(crash({ speed: 12, zone: "side", surface }), seeded(4)), 0.02, 0.95),
    )
  const asphalt = shower("asphalt"),
    grass = shower("grass")
  within(centroidOf(asphalt, RATE, 0.15, 1.4), 6000, 10000, "shower centroid, Hz")
  assert.ok(
    10 *
      Math.log10(
        bandEnergy(grass, RATE, 0.1, 2.4, 20, 20000) /
          bandEnergy(asphalt, RATE, 0.1, 2.4, 20, 20000),
      ) <=
      -14,
  )
  // A single piece of debris too.
  const piece = (surface: Surface) =>
    layer(RATE, 1, seeded(5), (mix) =>
      land(
        mix,
        0.1,
        surface,
        0.01,
        [0, 0, 0, 0, 0.3, 1, 0.6, 0.2, 0, 0],
        [[between(mix.random, 1000, 2000), 0.01]],
        0.5,
      ),
    )
  assert.ok(
    10 *
      Math.log10(
        bandEnergy(piece("grass"), RATE, 0, 1, 20, 20000) /
          bandEnergy(piece("asphalt"), RATE, 0, 1, 20, 20000),
      ) <=
      -14,
  )
})
