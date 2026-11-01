import assert from "node:assert/strict"
import { test } from "node:test"

import { SPEED_OF_SOUND } from "../../acoustics.ts"
import { measure } from "../../measure.ts"
import { renderThunder, THUNDER_RATE, thunderRender } from "../thunder.ts"
import { EARS, median, onset, RATE, renders, SEEDS } from "./thunders.ts"

test("an in-cloud flash has no foot to crack: it starts under its loudest and dark, even overhead", () => {
  const bolt = renders(300),
    cloud = renders(300, false)
  // Medians (96 draws): 9 dB under, 190 Hz against the bolt's 0 dB, 840 Hz.
  assert.ok(median(cloud.map(({ samples }) => onset(samples))) < -3)
  assert.ok(
    median(cloud.map(({ samples }) => measure([samples], RATE).centroid)) <
      0.5 * median(bolt.map(({ samples }) => measure([samples], RATE).centroid)),
  )
})

test("the strike point's own sound comes `lead` s into the render: at once near, after the nearer cloud branches far", () => {
  // Mostly the foot comes first; a channel leaning towards the ears may come first by tens of metres (0.2 s at most on seeds 1–48).
  const near = renders(300).map(({ lead }) => lead)
  assert.ok(median(near) < 0.01 && Math.max(...near) < 0.3, `leads ${near}`)
  // An in-cloud flash's first sound comes off a branch reaching towards the ears, before its start's: never more than its spread allows.
  for (const { lead } of renders(5000, false))
    assert.ok(lead >= 0 && lead <= 4000 / SPEED_OF_SOUND, `lead ${lead}`)
})

test("from a ridge 435 m over a valley bolt 500 m off, the trunk at the ears' height is heard first, before the foot", () => {
  // Regression: the render heard every bolt from its foot's level, so a ridge heard the foot first, half a second late.
  const slant = Math.hypot(500, 435) / SPEED_OF_SOUND,
    ridge = renders(500, true, RATE / 2, SEEDS, 435).map(({ lead }) => slant - lead)
  const level = renders(500, true, RATE / 2).map(({ lead }) => lead)
  // Medians: 1.57 s against the foot's 1.95 (0.83–1.79 s over these draws).
  assert.ok(median(ridge) < slant - 0.3, `first sounds ${ridge} s against ${slant} s`)
  assert.ok(median(level) < 0.01, `leads ${level}`)
})

test("a flash's render is made once per params object, at 16 kHz for a bolt within 1 km and 8 kHz past it or in the cloud, from where its reference sound comes", () => {
  const near = { kind: "thunder", distance: 600, ears: EARS, bolt: true, seed: 5 } as const,
    far = { kind: "thunder", distance: 4000, ears: EARS, bolt: false, seed: 5 } as const
  assert.equal(thunderRender(near), thunderRender(near))
  // An in-cloud flash overhead is 2.4 km off at its nearest: the air leaves nothing a 16 kHz render would add.
  const overhead = { kind: "thunder", distance: 0, ears: EARS, bolt: false, seed: 5 } as const
  assert.deepEqual(
    [thunderRender(near).rate, thunderRender(overhead).rate, thunderRender(far).rate],
    [THUNDER_RATE, THUNDER_RATE / 2, THUNDER_RATE / 2],
  )
  assert.ok(
    Math.abs(thunderRender(far).seconds - thunderRender(far).samples.length / (THUNDER_RATE / 2)) <
      1e-9,
  )
  // A bolt is heard from its strike point; an in-cloud flash from its start, 3–5 km up.
  assert.equal(thunderRender(near).height, 0)
  assert.ok(
    thunderRender(far).height >= 3000 && thunderRender(far).height <= 5000,
    `${thunderRender(far).height} m`,
  )
})

test("a flash at no finite distance thunders as one overhead rather than rendering nothing (which would mute thunder for the session)", () => {
  for (const distance of [Infinity, -Infinity, Number.NaN]) {
    const { samples, lead } = renderThunder(
      { kind: "thunder", distance, ears: distance, bolt: true, seed: 2 },
      RATE / 2,
    )
    assert.ok(
      samples.length > 0 && Number.isFinite(lead),
      `${distance}: ${samples.length} samples, lead ${lead}`,
    )
  }
})
