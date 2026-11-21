import assert from "node:assert/strict"
import { test } from "node:test"

import { STEP } from "../../sim/index.ts"
import { yOf } from "../ground.ts"
import { FADE, Marks, type SkidValue } from "../marks.ts"

/** A skid of `car`'s wheel `wheel` at step `step`, sliding east along y = 0 at 30 m/s (0.5 m a step). */
const skid = (step: number, wheel = 0, car = 1, amount = 1): SkidValue => ({
  car,
  wheel,
  x: step * 0.5,
  y: wheel * 2,
  z: 300,
  slip: 8,
  amount,
  surface: "asphalt",
  snow: 0,
  step,
})

/** Quad `q`'s four corners as [x, y, z] triples (startL, startR, endR, endL). */
const corners = (marks: Marks, q: number) => {
  const p = marks.mesh.geometry.getAttribute("position").array
  return [0, 1, 2, 3].map((v) => [
    p[q * 12 + v * 3]!,
    p[q * 12 + v * 3 + 1]!,
    p[q * 12 + v * 3 + 2]!,
  ])
}
const alphas = (marks: Marks, q: number) => {
  const c = marks.mesh.geometry.getAttribute("color").array
  return [0, 1, 2, 3].map((v) => c[q * 16 + v * 4 + 3]!)
}

test("a wheel's consecutive skids draw one joined strip, its width, lifted just over the ground", () => {
  const marks = new Marks()
  for (const step of [1, 2, 3]) marks.add(skid(step), 0.2)
  assert.equal(marks.count, 2, "three points, two quads")
  const [a, b] = [corners(marks, 0), corners(marks, 1)]
  assert.deepEqual([b[0], b[1]], [a[3], a[2]], "the second quad starts where the first ends")
  const [startL, startR] = a
  assert.ok(
    Math.abs(Math.hypot(startL![0]! - startR![0]!, startL![2]! - startR![2]!) - 0.2) < 1e-6,
    "the tread's width across",
  )
  assert.ok(startL![2]! < startR![2]!, "left of travel (east) is north, three −z")
  const lift = startL![1]! - yOf(300)
  assert.ok(
    lift > 0.02 && lift < 0.08,
    `${lift} m over the ground: above the road ribbons' dash, not floating`,
  )
  marks.update(3 * STEP.dt)
  assert.equal(marks.mesh.geometry.drawRange.count, 2 * 6)
})

test("a gap of a step breaks the strip, and each wheel draws its own", () => {
  const marks = new Marks()
  for (const step of [1, 2, 4, 5]) {
    marks.add(skid(step, 0), 0.2)
    marks.add(skid(step, 1), 0.2)
  }
  assert.equal(
    marks.count,
    4,
    "steps 1–2 and 4–5 for each wheel; nothing across the gap or between the wheels",
  )
  for (let q = 0; q < 4; q++) {
    const xs = corners(marks, q).map(([x]) => x!)
    assert.ok(Math.max(...xs) - Math.min(...xs) < 0.6, `quad ${q} spans one step`)
  }
})

test("once full, the oldest quads are overwritten first", () => {
  const marks = new Marks(8)
  for (let step = 1; step <= 12; step++) marks.add(skid(step), 0.2)
  assert.equal(marks.count, 8, "bounded by the capacity")
  // 11 quads written: slots 0–2 hold the 9th to 11th, slot 3 still the 4th.
  assert.ok(Math.abs(corners(marks, 0)[0]![0]! - 4.5) < 0.2, "slot 0: the 9th quad, from step 9")
  assert.ok(Math.abs(corners(marks, 3)[0]![0]! - 2) < 0.2, "slot 3: the oldest left, from step 4")
})

test("opacity follows how far past its grip the tyre slid, and fades to nothing over a minute of sim time", () => {
  const marks = new Marks()
  marks.add(skid(1, 0, 1, 0.5), 0.2)
  marks.add(skid(2, 0, 1, 1), 0.2)
  const born = 2 * STEP.dt
  marks.update(born)
  const [startL, , endR] = alphas(marks, 0)
  assert.ok(
    Math.abs(endR! - 2 * startL!) < 1e-6 && endR! > 0.5,
    "the half-amount end is half as dark",
  )
  marks.update(born + FADE / 2)
  assert.ok(
    Math.abs(alphas(marks, 0)[2]! - endR! / 2) < 0.01,
    "halfway through the fade, half the opacity",
  )
  marks.update(born + FADE)
  assert.deepEqual(alphas(marks, 0), [0, 0, 0, 0], "gone after FADE")
})

test("ruts on dirt are earth, marks on asphalt are rubber", () => {
  const marks = new Marks()
  marks.add(skid(1), 0.2)
  marks.add(skid(2), 0.2)
  marks.add({ ...skid(1, 1), surface: "dirt" }, 0.2)
  marks.add({ ...skid(2, 1), surface: "dirt" }, 0.2)
  const c = marks.mesh.geometry.getAttribute("color").array
  const [rubber, earth] = [0, 1].map((q) => [c[q * 16]!, c[q * 16 + 1]!, c[q * 16 + 2]!])
  assert.ok(
    earth![0]! > earth![2]! && rubber![0]! - rubber![2]! < earth![0]! - earth![2]!,
    "earth is browner than rubber",
  )
})

test("ruts in sand are its damp, darker under-layer: earthy, paler than a dirt rut, less opaque than rubber", () => {
  const marks = new Marks()
  for (const [wheel, surface] of [
    [0, "sand"],
    [1, "dirt"],
    [2, "asphalt"],
  ] as const)
    for (const step of [1, 2]) marks.add({ ...skid(step, wheel), surface }, 0.2)
  const c = marks.mesh.geometry.getAttribute("color").array
  const [sand, dirt, rubber] = [0, 1, 2].map((q) => ({
    rgb: [c[q * 16]!, c[q * 16 + 1]!, c[q * 16 + 2]!],
    alpha: c[q * 16 + 3]!,
  }))
  assert.ok(sand!.rgb[0]! > sand!.rgb[2]!, `earthy: ${sand!.rgb}`)
  assert.ok(Math.max(...sand!.rgb) > 2 * Math.max(...dirt!.rgb), `paler than dirt: ${sand!.rgb}`)
  assert.ok(sand!.alpha < rubber!.alpha, "a sand rut is fainter than rubber on asphalt")
})

// Regression: a skid in a tunnel drew its mark on the hillside over it, 5.4 m up. The 7.6 m
// underpass's mouths hold the ground over its first metres at its floor (`mouthClaim`), in the
// shipped decimetres 211.5 m over the floor's 211.42 m here, and the mark lies on it, 0.125 m over
// the floor.
test("a skid in the tunnel near Monzone lies on its floor, not on the hill above", () => {
  const marks = new Marks()
  for (const step of [1, 2])
    marks.add({ ...skid(step), x: -116.3 + step * 0.1, y: 324.2, z: 211.42 }, 0.2)
  for (const [, y] of corners(marks, 0))
    assert.ok(Math.abs(y! - yOf(211.42)) < 0.15, `${y! - yOf(211.42)} m off the tunnel floor`)
})

test("on snow a sliding tyre leaves dark slush ruts, whatever the ground under the snow; marks draw before the smoke", () => {
  const marks = new Marks()
  for (const step of [1, 2]) marks.add({ ...skid(step), surface: "grass", snow: 1 }, 0.2)
  for (const step of [1, 2]) marks.add({ ...skid(step, 1), surface: "grass" }, 0.2)
  const c = marks.mesh.geometry.getAttribute("color").array
  const [rut, bare] = [0, 1].map((q) => ({
    rgb: [c[q * 16]!, c[q * 16 + 1]!, c[q * 16 + 2]!],
    alpha: c[q * 16 + 3]!,
  }))
  const value = (rgb: Array<number>) => Math.max(...rgb)
  assert.ok(value(rut!.rgb) < 0.12, `a dark rut: ${rut!.rgb}`)
  assert.ok(rut!.alpha > bare!.alpha, "plainer on white snow than on grass")
  assert.equal(marks.mesh.renderOrder, 0, "the first transparent effect drawn")
})
