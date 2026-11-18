import assert from "node:assert/strict"
import { test } from "node:test"

import type { Surface } from "../../types.ts"
import { tyreTargets } from "../tyres.ts"

/** Tyres rolling at `speed` m/s, `skid` 0…1 past their grip and sliding at `slip` m/s. */
const tyre = (speed: number, skid: number, slip: number, surface: Surface, heavy = false) =>
  tyreTargets({ kind: "tyres", speed, skid, slip, surface, heavy })

test("rolling noise rises 30 dB per decade of speed and stops at a standstill", () => {
  assert.ok(
    Math.abs(20 * Math.log10(tyre(30, 0, 0, "asphalt").roll / tyre(3, 0, 0, "asphalt").roll) - 30) <
      1e-9,
  )
  assert.equal(tyre(0, 0, 0, "asphalt").roll, 0)
})

test("a skid squeals on hard ground and sprays gravel on loose ground", () => {
  for (const surface of ["asphalt", "stone"] as const)
    assert.ok(tyre(15, 0.8, 6, surface).squeal > tyre(15, 0, 0, surface).squeal, surface)
  for (const surface of ["gravel", "dirt", "grass", "leaves", "sand"] as const) {
    assert.equal(tyre(15, 0.8, 6, surface).squeal, 0, surface)
    assert.ok(tyre(15, 0.8, 6, surface).crunch > tyre(15, 0, 0, surface).crunch, surface)
  }
})

test("sand hisses low and soft: a quieter, darker roll than a dirt track's, and its spray a denser, lower stream than gravel's crunch", () => {
  const sand = tyre(15, 0.8, 6, "sand"),
    dirt = tyre(15, 0.8, 6, "dirt"),
    gravel = tyre(15, 0.8, 6, "gravel")
  assert.ok(sand.roll < dirt.roll && sand.rollHz < dirt.rollHz, "muffled rolling")
  assert.ok(
    sand.grainHz < gravel.grainHz / 1.5 && sand.grainTop < gravel.grainTop,
    `spray at ${sand.grainHz} Hz, cut over ${sand.grainTop} Hz`,
  )
  assert.ok(sand.grains > 1.5 * gravel.grains, "grains so dense they fuse into a hiss")
  assert.equal(dirt.grainHz, gravel.grainHz, "the other loose grounds keep gravel's crunch")
})

// Regression: the squeal came from sideways speed over ground speed, faded in from 8 km/h, so wheelspin and lock-ups were silent.
test("a standing burnout squeals with no rolling noise, and sprays gravel; a locked wheel squeals in a straight line", () => {
  const burnout = tyre(0, 1, 8, "asphalt")
  assert.ok(
    burnout.squeal > 0.5 * tyre(40, 1, 12, "asphalt").squeal && burnout.roll === 0,
    `${burnout.squeal}`,
  )
  assert.ok(tyre(0, 1, 8, "gravel").crunch > 0.5 * tyre(15, 1, 8, "gravel").crunch)
  assert.ok(tyre(15, 1, 15, "asphalt").squeal > tyre(15, 0, 0, "asphalt").squeal)
})

test("a tyre barely past its grip, or creeping, hardly squeals", () => {
  assert.ok(tyre(15, 0.1, 6, "asphalt").squeal < 0.15 * tyre(15, 1, 6, "asphalt").squeal)
  assert.equal(tyre(15, 1, 0.3, "asphalt").squeal, 0)
})

test("setts rumble at one per 14 cm, only on stone", () => {
  assert.ok(Math.abs(tyre(14, 0, 0, "stone").settHz - 100) < 1e-9)
  assert.ok(tyre(14, 0, 0, "stone").setts > 0)
  assert.equal(tyre(14, 0, 0, "asphalt").setts, 0)
})

test("the calibration case, the Giulia at top speed sliding fully at 12 m/s, squeals at full level", () => {
  const full = tyre(40, 1, 12, "asphalt")
  assert.equal(full.squeal, tyre(40, 1, 20, "asphalt").squeal)
  assert.ok(tyre(40, 0.5, 12, "asphalt").squeal < full.squeal)
})

test("heavy tyres are 6 dB louder and darker", () => {
  const light = tyre(15, 0.8, 6, "asphalt"),
    heavy = tyre(15, 0.8, 6, "asphalt", true)
  assert.ok(
    Math.abs(heavy.roll / light.roll - 2) < 1e-9 &&
      Math.abs(heavy.squeal / light.squeal - 2) < 1e-9,
  )
  assert.ok(heavy.rollHz < light.rollHz && heavy.pitch < light.pitch)
})
