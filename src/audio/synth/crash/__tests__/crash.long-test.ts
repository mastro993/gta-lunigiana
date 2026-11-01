import assert from "node:assert/strict"
import { test } from "node:test"

import { BANDS } from "../dsp.ts"
import { hitOf, levelOf } from "../hit.ts"
import { crashQuiet } from "../index.ts"
import { partials as longPartials, renderCrash } from "../render.ts"
import { bandEnergy, features, type Features, layer, partials } from "../testing.ts"
import { type Case, CASES, crash, median, RATE, seeded, SEEDS, type Spec, within } from "./cases.ts"

const renders = new Map<Case, ReadonlyArray<{ readonly x: Float32Array; readonly f: Features }>>()
/** The share of `values` that pass `ok`. */
const share = <T>(values: ReadonlyArray<T>, ok: (value: T) => boolean): number =>
  values.filter(ok).length / values.length
/** Every seed's render of `name` and its features, made once. */
const of = (name: Case) => {
  let done = renders.get(name)
  if (done === undefined)
    renders.set(
      name,
      (done = SEEDS.map((seed) => {
        const x = renderCrash(crash(CASES[name]), RATE, seeded(seed))
        return { x, f: features(x, RATE) }
      })),
    )
  return done
}
/** The median over the seeds of `name` of what `read` takes from a render. */
const med = (name: Case, read: (f: Features) => number) => median(of(name).map(({ f }) => read(f)))
/** The exterior crashes the critique's acceptance targets apply to (the bump, the rail and the cabin have their own). */
const EXTERIOR = [
  "masonry5",
  "masonry14",
  "masonry20",
  "pandas",
  "truck",
  "stone",
  "tree",
  "earth",
  "side",
  "wreck",
] as const satisfies ReadonlyArray<Case>

test("every render is finite, never over full scale, at most 4 s long and faded to silence", () => {
  for (const name of Object.keys(CASES) as Array<Case>) {
    for (const { x } of of(name)) {
      let peak = 0
      for (const v of x) {
        assert.ok(Number.isFinite(v), name)
        peak = Math.max(peak, Math.abs(v))
      }
      assert.ok(peak > 0.01 && peak <= 1, `${name} peaks at ${peak}`)
      assert.ok(x.length <= 4 * RATE, name)
      assert.ok(
        Math.abs(x.at(-1)!) < 1e-6 && Math.abs(x.at(-100)!) < peak * 1e-3,
        `${name} ends with a click`,
      )
    }
  }
})

test("one level law, ½·μ·v²·(1 − e²): +6.5 dB per doubling of speed, Panda–Panda 3 dB under a Panda into a wall, capped 6 dB over the 15 m/s reference", () => {
  const quiet = (spec: Spec) => crashQuiet(crash(spec))
  assert.ok(Math.abs(quiet({ speed: 15 })) < 0.01)
  for (const v of [2, 4, 8])
    within(quiet({ speed: v }) - quiet({ speed: 2 * v }), 5.9, 7, `${v} → ${2 * v} m/s`)
  within(
    levelOf(crash({ speed: 10 })) - levelOf(crash({ speed: 10, against: "panda" })),
    2.9,
    3.1,
    "Panda–Panda",
  )
  assert.equal(quiet({ speed: 30 }), -6)
  assert.equal(quiet({ speed: 60, model: "carabinieri" }), -6)
  // The car crushes 30 % of its energy into an earth bank, 60 % into a tree: quieter by that much.
  within(quiet({ speed: 10, against: "earth" }) - quiet({ speed: 10 }), 5, 5.5, "earth")
  within(quiet({ speed: 10, against: "tree" }) - quiet({ speed: 10 }), 2, 2.5, "tree")
  // The renders follow it: the main block's RMS rises with the law.
  const rms = (name: Case) => med(name, (f) => f.rms)
  within(
    rms("masonry14") - rms("masonry5"),
    quiet({ speed: 5 }) - quiet({ speed: 14 }) - 2,
    quiet({ speed: 5 }) - quiet({ speed: 14 }) + 2,
    "5 → 14 m/s RMS",
  )
  // Regression: a bump played 3–5 dB under the law and a guard rail's ring 2–3 dB over it, so masking culled them wrongly. Peaks re the reference's, 10 seeds.
  const peakOf = (spec: Spec) =>
    median(
      SEEDS.slice(0, 10).map((seed) =>
        renderCrash(crash(spec), RATE, seeded(seed)).reduce((p, v) => Math.max(p, Math.abs(v)), 0),
      ),
    )
  const reference = peakOf({ speed: 15 })
  for (const spec of [
    { speed: 2 },
    { speed: 5 },
    { speed: 2, against: "rail" },
    { speed: 15, against: "rail" },
    { speed: 15, against: "sheet" },
    { speed: 10, against: "panda" },
    { speed: 2, model: "truck" },
    { speed: 8, zone: "under", against: "road" },
    { speed: 8, zone: "side", against: "road" },
  ] as const) {
    within(
      20 * Math.log10(peakOf(spec) / reference) + quiet(spec),
      -2,
      2,
      `${JSON.stringify(spec)} peak re the law, dB`,
    )
  }
})

test("exterior crashes meet the measured targets: a 150–450 ms main block, a 8–25 ms rise, crest 9–15 dB, Gaussian-dense noise, no boom, the energy at 125 Hz–2 kHz", () => {
  for (const name of EXTERIOR) {
    within(
      med(name, (f) => f.db10 ?? Infinity),
      150,
      450,
      `${name} −10 dB, ms`,
    )
    if (name !== "earth")
      within(
        med(name, (f) => f.rise),
        8,
        25,
        `${name} rise, ms`,
      )
    within(
      med(name, (f) => f.crest),
      9,
      15,
      `${name} crest, dB`,
    )
    for (const p of [1, 2])
      within(
        med(name, (f) => f.phases[p]!.bandFlatness),
        0.35,
        0.6,
        `${name} band flatness, phase ${p}`,
      )
    within(
      med(name, (f) => f.kurtosis),
      2.8,
      4.5,
      `${name} 1–8 kHz kurtosis`,
    )
    within(
      med(name, (f) => f.phases[1]!.octaves[8]!),
      -25,
      -12,
      `${name} 8 kHz, dB`,
    )
    within(
      med(name, (f) => f.phases[1]!.octaves[9]!),
      -36,
      -22,
      `${name} 16 kHz, dB`,
    )
    for (const p of [0, 1, 2])
      within(
        med(name, (f) => f.phases[p]!.centroid),
        1500,
        3500,
        `${name} centroid, phase ${p}`,
      )
  }
  // Render by render (98–99 % of them measured): no boom, the loudest octave in 125 Hz–2 kHz.
  const all = EXTERIOR.flatMap((name) => of(name).map(({ f }) => f.phases[1]!.octaves))
  within(
    share(all, (octaves) => octaves[1]! <= -5),
    0.97,
    1,
    "renders with 63 Hz ≤ −5 dB",
  )
  within(
    share(all, (octaves) => octaves.indexOf(0) >= 2 && octaves.indexOf(0) <= 6),
    0.97,
    1,
    "renders loudest at 125 Hz–2 kHz",
  )
})

test("the tail grows with speed: −20 dB from 0.25 s to 2.5 s, later the harder the hit", () => {
  const d20 = (name: Case) => med(name, (f) => f.db20 ?? Infinity)
  for (const name of ["masonry5", "masonry14", "masonry20", "wreck"] as const)
    within(d20(name), 250, 2500, `${name} −20 dB, ms`)
  assert.ok(
    d20("masonry5") < d20("masonry14") &&
      d20("masonry14") < d20("masonry20") &&
      d20("masonry20") < d20("wreck"),
  )
})

test("the median crash spectrum is flat within 6 dB over 125 Hz–2 kHz (the truck's bumper clang lifts 250–500 Hz: 8 dB)", () => {
  for (const [name, spread] of [
    ["masonry14", 6],
    ["pandas", 6],
    ["truck", 8],
  ] as const) {
    const bands = [2, 3, 4, 5, 6].map((b) => med(name, (f) => f.phases[1]!.octaves[b]!))
    assert.ok(Math.max(...bands) - Math.min(...bands) <= spread, `${name}: ${bands}`)
  }
})

test("a crash has 1–3 long partials: the layer rings its model's count at 0.6–4.3 kHz, η 0.001–0.01; in the render they stand 9 dB clear of the crunch", () => {
  // The layer alone, over a flat crunch: Panda and Giulia 1–2, the Ape 2–3, the truck 1–2 (and 0–1 on the other body of two).
  const flat = BANDS.map(() => 0.1)
  for (const [model, few, many] of [
    ["panda", 1, 2],
    ["ape", 2, 3],
    ["truck", 1, 2],
    ["carabinieri", 1, 2],
  ] as const) {
    for (const seed of SEEDS.slice(0, 8)) {
      const random = seeded(seed),
        hit = hitOf(crash({ speed: 12, model }), random)
      const x = layer(RATE, 1.6, random, (mix) => longPartials(mix, hit, hit.bodies[0]!, flat)),
        found = partials(x, RATE, 0, 500, 5000)
      assert.ok(
        found.length >= few && found.length <= many,
        `${model} seed ${seed}: ${found.length} partials`,
      )
      for (const p of found)
        assert.ok(
          p.hz >= 600 && p.hz <= 4300 && p.eta >= 0.0007 && p.eta <= 0.011 && p.t60 >= 0.2,
          `${model}: ${p.hz.toFixed(0)} Hz, η ${p.eta.toFixed(4)}`,
        )
    }
  }
  for (const name of ["masonry5", "masonry14", "pandas", "stone", "tree", "earth"] as const) {
    const counts = of(name).map(
      ({ x, f }) =>
        partials(x, RATE, f.onset).filter((p) => p.eta >= 0.001 && p.eta <= 0.01).length,
    )
    assert.ok(median(counts) >= 1 && median(counts) <= 3, `${name}: ${counts}`)
  }
})

test("a parking bump is short: −10 dB at 40–100 ms, its crest that of a bumper tap", () => {
  within(
    med("bump", (f) => f.db10 ?? Infinity),
    40,
    100,
    "−10 dB, ms",
  )
  within(
    med("bump", (f) => f.rise),
    8,
    25,
    "rise, ms",
  )
  within(
    med("bump", (f) => f.crest),
    12,
    16,
    "crest, dB",
  )
  within(
    med("bump", (f) => f.phases[1]!.bandFlatness),
    0.35,
    0.6,
    "band flatness",
  )
})

test("the guard rail is the only long tonal ring: low band flatness through 150–600 ms, partials ringing a second and more", () => {
  within(
    med("rail", (f) => f.phases[2]!.bandFlatness),
    0,
    0.4,
    "rail band flatness 150–600 ms",
  )
  assert.ok(
    med("rail", (f) => f.phases[2]!.bandFlatness) <
      med("masonry14", (f) => f.phases[2]!.bandFlatness) - 0.15,
  )
  within(
    share(of("rail"), ({ x, f }) => partials(x, RATE, f.onset, 150, 3000).some((p) => p.t60 >= 1)),
    0.9,
    1,
    "renders with a partial of T60 ≥ 1 s",
  )
})

test("a tree rustles for more than 2 s, faintly; an earth bank is the slowest, dullest hit", () => {
  const rustle = (name: Case) =>
    median(
      of(name).map(
        ({ x }) =>
          bandEnergy(x, RATE, 2, 2.5, 2500, 8000) / bandEnergy(x, RATE, 0, 0.3, 2500, 8000),
      ),
    )
  // Regression: the leaves hissed at 7–13 dB under the crash itself, brighter than any recording's tail (w4, a real tree crash: 1.4 kHz).
  within(
    10 * Math.log10(rustle("tree")),
    -45,
    -18,
    "tree rustle at 2–2.5 s re 0–0.3 s, 2.5–8 kHz, dB",
  )
  assert.ok(
    rustle("tree") > 4 * rustle("masonry14"),
    `tree ${rustle("tree")}, masonry ${rustle("masonry14")}`,
  )
  within(
    med("tree", (f) => f.phases[3]!.centroid),
    1500,
    3500,
    "tree centroid 0.6–3 s",
  )
  const others = EXTERIOR.filter((name) => name !== "earth")
  for (const name of others) {
    assert.ok(
      med("earth", (f) => f.rise) > med(name, (f) => f.rise),
      `earth rises slower than ${name}`,
    )
    assert.ok(
      med("earth", (f) => f.phases[1]!.octaves[8]!) < med(name, (f) => f.phases[1]!.octaves[8]!),
      `earth duller than ${name}`,
    )
  }
})

// Regression: the truck's bumper clang sat 23–28 dB under the crunch, and the marble and chain needed the truck to lose 2–6 m/s.
test("a Panda into the truck rings the truck's steel bumper: a 150–650 Hz partial 12 dB clear in most renders, in a Panda–Panda hit's hardly any", () => {
  const clang = (name: Case) =>
    share(of(name), ({ x, f }) =>
      partials(x, RATE, f.onset, 150, 650).some((p) => p.eta <= 0.01 && p.clear >= 12),
    )
  assert.ok(
    clang("truck") >= 0.3 && clang("pandas") <= 0.1,
    `truck ${clang("truck")}, pandas ${clang("pandas")}`,
  )
})

// Regression: a car–car hit, a hard landing and a roll onto the road all measured like a Panda into a house wall.
test("two cars clank: their shells ring through a car–car hit's first 30 ms, its band flatness under a house wall's", () => {
  const flatness = (name: Case) => med(name, (f) => f.phases[0]!.bandFlatness)
  assert.ok(
    flatness("pandas") < flatness("masonry10") - 0.05,
    `pandas ${flatness("pandas")}, masonry ${flatness("masonry10")}`,
  )
})

test("the road thumps under the car's weight: a landing on it is short with most of its energy under 200 Hz, a roll onto it slaps 63 Hz near the loudest band", () => {
  within(
    med("landing", (f) => f.below200),
    0.45,
    0.75,
    "landing share under 200 Hz",
  )
  assert.ok(med("masonry6", (f) => f.below200) < 0.4)
  within(
    med("landing", (f) => f.db10 ?? Infinity),
    40,
    120,
    "landing −10 dB, ms",
  )
  // A side into a house wall as hard keeps 63 Hz well down: no boom.
  within(
    med("roll", (f) => f.phases[1]!.octaves[1]!),
    -5,
    0,
    "roll 63 Hz, dB",
  )
  assert.ok(med("side8", (f) => f.phases[1]!.octaves[1]!) < -8)
})

// Regression: the sub-hits came back within 6 dB of the hit in one render in four, and through the master limiter as loud as it: an echo.
test("a crash's sub-hits come back well under its hit: a re-attack after 60 ms 13 dB and more under its peak (10 ms RMS), in all but a few renders 6 dB", () => {
  const comeback = (x: Float32Array) => {
    const w = RATE / 100,
      rms: Array<number> = []
    for (let i = 0; i + w <= x.length; i += w)
      rms.push(10 * Math.log10(x.subarray(i, i + w).reduce((p, v) => p + v * v, 0) / w + 1e-20))
    const peak = Math.max(...rms)
    // A 10 ms frame 6 dB over the one 30 ms before it.
    return Math.max(
      -99,
      ...rms.flatMap((v, i) => (i >= 6 && v - rms[i - 3]! >= 6 ? [v - peak] : [])),
    )
  }
  for (const name of ["masonry10", "masonry14"] as const) {
    const backs = of(name).map(({ x }) => comeback(x))
    assert.ok(
      median(backs) <= -13 && share(backs, (db) => db > -6) <= 0.15,
      `${name}: ${backs.map((db) => db.toFixed(0))}`,
    )
  }
})

// Regression: a sheet-metal wall rang 11–18 dB under the car's crunch and measured like masonry.
test("a sheet-metal wall rings: its band flatness through 150–600 ms well under masonry's", () => {
  const flatness = (name: Case) => med(name, (f) => f.phases[2]!.bandFlatness)
  assert.ok(
    flatness("sheet") < flatness("masonry12") - 0.1,
    `sheet ${flatness("sheet")}, masonry ${flatness("masonry12")}`,
  )
  for (const { f } of of("sheet"))
    assert.ok(f.phases[1]!.octaves[1]! <= -5, `sheet: 63 Hz at ${f.phases[1]!.octaves[1]} dB`)
})

// Regression: a 2 m/s nudge into a greenhouse opened with the full pane-breaking crack (0–30 ms centroid 5.9 kHz), and nothing fell after it.
test("a greenhouse nudged at 2 m/s barely cracks: its first 30 ms near a house wall's, a 5 m/s hit's bright", () => {
  const first = (spec: Spec) =>
    median(
      SEEDS.slice(0, 10).map(
        (seed) => features(renderCrash(crash(spec), RATE, seeded(seed)), RATE).phases[0]!.centroid,
      ),
    )
  assert.ok(
    first({ speed: 2, against: "glass" }) < 4000 && first({ speed: 5, against: "glass" }) > 4500,
    `${first({ speed: 2, against: "glass" })} / ${first({ speed: 5, against: "glass" })} Hz`,
  )
})
