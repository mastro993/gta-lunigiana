import assert from "node:assert/strict"
import { test } from "node:test"

import { measure } from "../../measure.ts"
import { lineFor } from "../lines.ts"
import { tokenize } from "../phonemes.ts"
import { PAD, planLine } from "../plan.ts"
import { renderPlan, renderSpeech } from "../render.ts"
import { f0Of, seeded, stretch } from "../testing.ts"
import type { Line, Speaker, Tune } from "../types.ts"
import { MAN, RATE, rms, SITUATIONS, SPEAKERS } from "./speakers.ts"

const line = (words: ReadonlyArray<ReadonlyArray<string>>, tune: Tune = "say"): Line => ({
  text: words.map((w) => w.join("")).join(" "),
  words,
  tune,
})

/** The F0 over the first 50 ms of the first vowel and the last 50 ms of the last, Hz. */
const ends = (l: Line, speaker: Speaker, loud = false) => {
  const plan = planLine(l, speaker, loud),
    out = renderPlan(plan, RATE, seeded(1)),
    vowels = plan.targets.filter((t) => t.vowel)
  const first = vowels[0]!,
    last = vowels.at(-1)!
  return {
    first: f0Of(stretch(out, RATE, first.start + 0.01, first.start + 0.06), RATE),
    last: f0Of(stretch(out, RATE, last.end - 0.06, last.end - 0.01), RATE),
  }
}

test("the same seed renders the same samples", () => {
  const speech = { speaker: MAN, line: lineFor("chat", seeded(2)) }
  assert.deepEqual(
    renderSpeech(speech, false, RATE, seeded(3)),
    renderSpeech(speech, false, RATE, seeded(3)),
  )
})

test("men speak lower than women, women lower than children", () => {
  const l = line([["m", "ˈa", "mː", "a"]]),
    f0 = (speaker: Speaker) => ends(l, speaker).first
  const man = f0(MAN),
    woman = f0({ voice: 0.5, age: "adult", female: true }),
    kid = f0({ voice: 0.5, age: "kid", female: false })
  assert.ok(man > 100 && man < 160, `man ${man}`)
  assert.ok(man < woman && woman < kid, `${man} < ${woman} < ${kid}`)
})

test("a question ends higher than it starts, a statement lower", () => {
  const words = [
    ["m", "a"],
    ["k", "ˈɔ", "z", "a"],
    ["d", "ˈi", "tʃ", "i"],
  ]
  for (const speaker of SPEAKERS.slice(0, 3)) {
    const ask = ends(line(words, "ask"), speaker),
      say = ends(line(words, "say"), speaker)
    assert.ok(ask.last > ask.first * 1.15, `ask ${ask.first} → ${ask.last}`)
    assert.ok(say.last < say.first * 0.9, `say ${say.first} → ${say.last}`)
  }
})

test("a yell is higher and brighter than the same line said", () => {
  const l = line(
    [
      ["m", "ˈa", "mː", "a"],
      ["m", "ˈi", "a"],
    ],
    "exclaim",
  )
  for (const speaker of SPEAKERS.slice(0, 3)) {
    assert.ok(ends(l, speaker, true).first > 1.4 * ends(l, speaker).first)
    const vowels = (loud: boolean) => {
      const plan = planLine(l, speaker, loud),
        out = renderPlan(plan, RATE, seeded(4))
      return plan.targets.filter((t) => t.vowel).map((t) => stretch(out, RATE, t.start, t.end))
    }
    const quiet = measure(vowels(false), RATE).centroid,
      loud = measure(vowels(true), RATE).centroid
    assert.ok(loud > quiet * 1.15, `centroid ${quiet} → ${loud}`)
  }
})

test("/s/ is brighter than /a/ and sits under it; /ʃ/ is darker than /s/", () => {
  const centroid = (word: ReadonlyArray<string>, label: string) => {
    const plan = planLine(line([word]), MAN),
      out = renderPlan(plan, RATE, seeded(5)),
      t = plan.targets.find((x) => x.label === label)!
    return {
      centroid: measure([stretch(out, RATE, t.start + 0.01, t.end - 0.01)], RATE).centroid,
      rms: rms(stretch(out, RATE, t.start + 0.01, t.end - 0.01)),
    }
  }
  const a = centroid(["ˈa", "sː", "a"], "a"),
    s = centroid(["ˈa", "sː", "a"], "s"),
    sh = centroid(["ˈa", "ʃː", "a"], "ʃ")
  assert.ok(s.centroid > 3 * a.centroid, `/s/ ${s.centroid} vs /a/ ${a.centroid}`)
  assert.ok(sh.centroid < s.centroid && sh.centroid > 2500, `/ʃ/ ${sh.centroid}`)
  // Sibilants ≈ 10–15 dB under the vowel (Jongman, Wayland & Wong 2000).
  const db = 20 * Math.log10(s.rms / a.rms)
  assert.ok(db < -8 && db > -18, `/s/ re /a/ ${db.toFixed(1)} dB`)
})

test("a line rings out into its trailing pad: no step where the speech ends", () => {
  // Was: the last phoneme stopped dead at full amplitude, a step up to 0.42 on a 0.5 peak (a click on every line).
  const random = seeded(8),
    ms = RATE / 1000
  for (const situation of SITUATIONS)
    for (const speaker of SPEAKERS)
      for (const loud of [false, true]) {
        const plan = planLine(lineFor(situation, random), speaker, loud),
          out = renderPlan(plan, RATE, random),
          end = Math.round((plan.seconds - PAD) * RATE)
        let step = 0
        for (let n = end - ms; n < end + ms; n++)
          step = Math.max(step, Math.abs(out[n]! - out[n - 1]!))
        assert.ok(step < 0.06, `${situation}: a step of ${step.toFixed(3)}`)
      }
})

test("a release burst goes through its own band, not the closure's", () => {
  // Was: the band was retuned on the 5 ms frame grid, so up to 5 ms of a 6 ms burst went through the closure's 1 kHz band
  // (the /t/ window's centroid 3.8–4.0 kHz, now ≈ 5.2 kHz; /k/ 2.5 kHz, now ≈ 2.9 kHz).
  for (const [word, least] of [
    ["ata", 4600],
    ["ˈatːo", 4600],
    ["aka", 2750],
  ] as const) {
    const plan = planLine(line([tokenize(word)]), MAN),
      burst = plan.targets.find((t) => t.label === "burst")!
    const windows = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
      stretch(renderPlan(plan, RATE, seeded(seed)), RATE, burst.start - 0.003, burst.end + 0.003),
    )
    const centroid =
      windows.reduce((sum, w) => sum + measure([w], RATE).centroid, 0) / windows.length
    assert.ok(centroid > least, `${word}: burst centroid ${centroid.toFixed(0)} Hz`)
  }
})
