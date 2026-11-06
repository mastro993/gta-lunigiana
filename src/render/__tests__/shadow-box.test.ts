import assert from "node:assert/strict"
import { test } from "node:test"

import { Vector2, Vector3 } from "three"

import { viewAxes } from "../pipeline.ts"
import { type HeldBox, holdBox, shadowBase, shadowFit } from "../shadow-box.ts"

// Regression: sized for flat ground, the shadow box left most of a mountain view unshadowed.
test("the shadow box covers the view's ground rectangle on the flat and the far ground a falling slope shows", () => {
  const axes = viewAxes(0),
    toSun = new Vector3(-0.75, 1, 0.35).normalize(),
    focus = new Vector3(0, 0, 0)
  const flat = shadowFit(focus, axes, 100, 60, toSun, () => 0)
  assert.ok(Math.abs(flat.half - (Math.hypot(100, 60 / Math.sin(Math.PI / 6)) / 2 + 10)) < 1e-9)
  // Ground falling away from the camera at 25° along screen-up (three −z is north, screen-up points south-east).
  const fall = Math.tan((25 * Math.PI) / 180),
    dir = new Vector3(axes.up.x, 0, axes.up.z).normalize()
  const slope = shadowFit(
    focus,
    axes,
    100,
    60,
    toSun,
    (x, z) => -fall * Math.max(0, x * dir.x + z * dir.z),
  )
  assert.ok(slope.half > flat.half + 20, `half ${slope.half} vs ${flat.half}`)
  assert.ok(slope.below < -10, "the far ground lies away from the sun, deeper than the focus")
})

// Regression: only the view's corners and edge midpoints were marched, so a valley seen between them
// (east of Monte Sagro at zoom 5, 600 m deeper along the light) fell past the shadow camera's far plane.
test("the shadow box reaches ground that shows only between the view's edges", () => {
  const axes = viewAxes(0),
    toSun = new Vector3(-0.75, 1, 0.35).normalize(),
    focus = new Vector3(0, 0, 0)
  const right = new Vector3(axes.right.x, 0, axes.right.z).normalize(),
    ahead = new Vector3(axes.up.x, 0, axes.up.z).normalize()
  // A 6 m wide gully 800 m deep, a quarter of the view's width right of centre, beyond the focus.
  const gully = (x: number, z: number) =>
    Math.abs(x * right.x + z * right.z - 25) < 3 && x * ahead.x + z * ahead.z > 0 ? -800 : 0
  assert.ok(shadowFit(focus, axes, 100, 60, toSun, gully).below < -400)
})

/** A 1280 × 720 screen's view, texels; the steps on foot (from 50.2 m, each × √2 the last); a sun 50° up. */
const SCREEN = new Vector2(427, 240),
  FOOT = shadowBase(SCREEN, 8),
  STEPS = [FOOT],
  SUN = new Vector3(-0.75, 1, 0.35).normalize()
while (STEPS.length < 4) STEPS.push(STEPS.at(-1)! * Math.SQRT2)
/** `n` frames asking for `need` m. */
const asking = (n: number, need: number): Array<number> => Array.from({ length: n }, () => need)
/** The flat ground's fit for the view at `texelsPerMetre`. */
const flatFit = (texelsPerMetre: number): number =>
  shadowFit(new Vector3(), viewAxes(0), 427 / texelsPerMetre, 240 / texelsPerMetre, SUN, () => 0)
    .half
/** The box after each of `needs`, one 60 fps frame apart, from `box`. */
const held = (box: HeldBox | undefined, needs: ReadonlyArray<number>): Array<number> =>
  needs.map((need) => (box = holdBox(box, need, FOOT, 1 / 60)).half)

test("the home view's box on foot is its own flat fit, 50.2 m on a 1280 × 720 screen, and stays so", () => {
  assert.equal(FOOT, flatFit(8))
  assert.equal(FOOT.toFixed(1), "50.2")
  assert.deepEqual(held(undefined, [FOOT, FOOT, FOOT]), [FOOT, FOOT, FOOT])
})

// Regression (#89): sized for each frame's yaw, the box changed size on most degrees of a turn, redrawing every shadow edge.
test("the box grows at once to the step that holds the view's ground with a tenth to spare, and shrinks a second after the view asks for less", () => {
  const start = holdBox(undefined, FOOT, FOOT, 0)
  // 1.2 m over the first step: the second holds it; 65 m: 71.5 with the spare needs the third.
  assert.deepEqual(held(start, [51.4]), [STEPS[1]])
  assert.deepEqual(held(start, [65]), [STEPS[2]])
  // Asking for the second step for 0.95 s keeps the third; by 1.05 s it has dropped to the step that held the most asked meanwhile.
  const settling = held(
    holdBox(start, 65, FOOT, 1 / 60),
    Array.from({ length: 63 }, (_, k) => (k === 30 ? 60 : 52)),
  )
  assert.deepEqual(settling.slice(0, 57), asking(57, STEPS[2]!))
  assert.equal(settling.at(-1), STEPS[1])
  // A need back on the box's own step restarts the wait.
  const back = held(holdBox(start, 65, FOOT, 1 / 60), [...asking(50, 52), 80, ...asking(50, 52)])
  assert.ok(
    back.every((half) => half === STEPS[2]),
    "held through the restart",
  )
})

test("a box more than one step above what the view asks for drops to the view's step at once", () => {
  const wide = holdBox(holdBox(undefined, FOOT, FOOT, 0), 120, FOOT, 1 / 60)
  assert.equal(wide.half, STEPS[3])
  assert.deepEqual(held(wide, [90, 60, 52]), [STEPS[3], STEPS[1], STEPS[1]])
})

test("easing from foot to car and back, the box changes size once each way, never under the view's ground", () => {
  /** The box through `seconds` of the zoom easing from `from` to `to` texels per metre as the host eases it (main.ts). */
  const ease = (from: number, to: number, seconds: number) => {
    let box: HeldBox | undefined,
      zoom = from
    const halves: Array<number> = []
    for (let t = 0; t < seconds; t += 1 / 60) {
      const need = flatFit(zoom)
      box = holdBox(box, need, shadowBase(SCREEN, zoom), 1 / 60)
      assert.ok(box.half >= need, `${box.half} m holds ${need} m`)
      halves.push(box.half)
      zoom += Math.abs(to - zoom) < 0.01 ? to - zoom : (to - zoom) * (1 - Math.exp(-3 / 60))
    }
    return halves
  }
  const car = shadowBase(SCREEN, 6)
  for (const [from, to, end] of [
    [8, 6, car],
    [6, 8, FOOT],
  ] as const) {
    const halves = ease(from, to, 4)
    assert.equal(
      halves.filter((half, k) => k > 0 && half !== halves[k - 1]).length,
      1,
      `${from} → ${to}: ${[...new Set(halves)].join(", ")}`,
    )
    assert.equal(halves.at(-1), end)
  }
})
