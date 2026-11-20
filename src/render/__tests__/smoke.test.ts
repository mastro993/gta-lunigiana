import assert from "node:assert/strict"
import { test } from "node:test"

import { Color, Matrix4, Quaternion, Vector3 } from "three"

import { STEP } from "../../sim/index.ts"
import type { Surface } from "../../sim/map/surface.ts"
import type { SkidValue } from "../marks.ts"
import { PUFF, Smoke } from "../smoke.ts"

const skid = (step: number, surface: Surface = "asphalt", slip = 10, amount = 1): SkidValue => ({
  car: 1,
  wheel: 0,
  x: 0,
  y: 0,
  z: 300,
  slip,
  amount,
  surface,
  snow: 0,
  step,
})
/** A fixed sequence: puffs land the same way every run. */
const steady = () => 0.5

/** Puff `i`'s position and scale. */
const puff = (smoke: Smoke, i: number) => {
  const m = new Matrix4(),
    at = new Vector3(),
    size = new Vector3()
  smoke.mesh.getMatrixAt(i, m)
  m.decompose(at, new Quaternion(), size)
  return { at, size: size.x }
}

test("puffs come in proportion to how hard the tyre slides, and grass hardly smokes", () => {
  const count = (surface: Surface, slip: number, amount: number) => {
    const smoke = new Smoke(steady)
    for (let step = 1; step <= 60; step++) smoke.add(skid(step, surface, slip, amount))
    smoke.update(60 * STEP.dt)
    return smoke.mesh.count
  }
  const full = count("asphalt", 10, 1)
  assert.ok(
    Math.abs(full - PUFF.asphalt.rate * 10) <= 1,
    `${full} puffs from a second of a 10 m/s slide`,
  )
  assert.ok(Math.abs(count("asphalt", 10, 0.5) - full / 2) <= 1, "half the amount, half the puffs")
  assert.ok(Math.abs(count("asphalt", 5, 1) - full / 2) <= 1, "half the slip, half the puffs")
  assert.ok(count("grass", 10, 1) < full / 4, "grass: little or none")
  assert.ok(count("dirt", 10, 1) >= full, "dirt: as much dust as asphalt smoke, or more")
  assert.ok(
    count("sand", 10, 1) > count("dirt", 10, 1),
    "sand: a spray of it, more than dirt's dust",
  )
})

test("a puff grows, rises and shrinks away within two seconds of sim time", () => {
  const smoke = new Smoke(steady)
  smoke.add(skid(60, "asphalt", 60, 1)) // one step at 60 m/s: at least one puff
  const born = 60 * STEP.dt
  const at = (t: number) => {
    smoke.update(born + t)
    return smoke.mesh.count === 0 ? undefined : puff(smoke, 0)
  }
  const early = at(0.02)!,
    peak = at(0.3)!,
    late = at(1)!
  assert.ok(
    early.size < peak.size && late.size < peak.size,
    `sizes ${early.size}, ${peak.size}, ${late.size}`,
  )
  assert.ok(peak.at.y > early.at.y && late.at.y > peak.at.y, "it rises")
  assert.equal(at(2), undefined, "gone after two seconds")
})

test("the puff count is bounded", () => {
  const smoke = new Smoke(steady, 16)
  for (let step = 1; step <= 120; step++) {
    smoke.add(skid(step, "dirt", 30, 1))
    smoke.update(step * STEP.dt)
    assert.ok(smoke.mesh.count <= 16)
  }
  assert.equal(smoke.mesh.count, 16, "75 puffs a second for 1.5 s each: the cap holds")
})

test("smoke is burnt-rubber grey on asphalt, dust is tan on dirt and the beach's pale warm grey on sand", () => {
  const lightness: Partial<Record<Surface, number>> = {},
    saturation: Partial<Record<Surface, number>> = {}
  for (const surface of ["asphalt", "dirt", "sand"] as const) {
    const smoke = new Smoke(steady)
    smoke.add(skid(1, surface, 60, 1))
    smoke.update(STEP.dt)
    const color = new Color(),
      hsl = { h: 0, s: 0, l: 0 }
    smoke.mesh.getColorAt(0, color)
    assert.equal(color.getHex(), PUFF[surface].hex, surface)
    color.getHSL(hsl)
    lightness[surface] = hsl.l
    saturation[surface] = hsl.s
    if (surface === "asphalt")
      assert.ok(
        hsl.s < 0.15 && hsl.l > 0.4,
        `asphalt smoke: saturation ${hsl.s}, lightness ${hsl.l}`,
      )
    else
      assert.ok(
        hsl.s > 0.1 && hsl.h > 20 / 360 && hsl.h < 50 / 360,
        `${surface} dust: hue ${hsl.h * 360}°, saturation ${hsl.s}`,
      )
  }
  // The Magra's beaches' measured sand is a pale grey-beige: greyer than a track's tan, and lighter.
  assert.ok(
    saturation.dirt! > 0.3 && saturation.sand! < saturation.dirt!,
    `sand ${saturation.sand}, dirt ${saturation.dirt}`,
  )
  assert.ok(
    lightness.sand! > lightness.dirt! + 0.15,
    `sand ${lightness.sand}, dirt ${lightness.dirt}`,
  )
})

test("on snow a sliding tyre throws up white spray; the smoke draws after the marks", () => {
  const smoke = new Smoke(steady)
  smoke.add({ ...skid(1, "asphalt", 60, 1), snow: 1 })
  smoke.update(STEP.dt)
  const color = new Color()
  smoke.mesh.getColorAt(0, color)
  assert.ok(
    Math.min(color.r, color.g, color.b) > 0.85 &&
      Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) < 0.1,
    `snow spray: ${color.toArray()}`,
  )
  assert.equal(smoke.mesh.renderOrder, 1)
})
