// Water left perched over the carved ground (water.ts's `dropPerched`): it drops to the ground, but in
// a lake's water, whose carved bed lies under it.
import assert from "node:assert/strict"
import { test } from "node:test"

import type { WaterF } from "../features.ts"
import { ringBox } from "../geometry.ts"
import { type CarvedArea, stillLevel } from "../water-areas.ts"
import { dropPerched, waterProfiles } from "../water.ts"

/** A stream east along y = 0 for 100 m, its surface 99.75 m over ground carved down to 90 m. */
const STREAM: WaterF = {
  id: 1,
  kind: "stream",
  w: 2,
  bed: 2,
  depth: 0.5,
  pts: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  from: 0,
}
const CARVED = 90

/** A water area across the stream from x0 to x1 (odd, so no sample lies on its outline). */
const across = (x0: number, x1: number, area: Pick<CarvedArea, "level" | "waters">): CarvedArea => {
  const ring = [x0, -10, x1, -10, x1, 10, x0, 10]
  return { rings: [ring], box: ringBox(ring), bars: [], ...area }
}

/** The stream's surface at each sample after `dropPerched` with `still`. */
const dropped = (still?: (x: number, y: number) => number | undefined) => {
  const [p] = waterProfiles([STREAM], () => 100)
  dropPerched([STREAM], [p!], [], [new Float64Array(p!.x.length).fill(CARVED)], still)
  return p!
}

test("dropPerched: water perched far over the carved ground drops to it, but in a lake, not in a river polygon", () => {
  const still = stillLevel([across(21, 59, { level: 99.7 }), across(61, 99, { waters: [0] })])
  const p = dropped(still)
  // Dropped above the lake, the stream steps up into it no higher than its level: the lake's water.
  p.x.forEach((x, k) =>
    assert.equal(p.z[k], x > 21 && x < 59 ? 99.7 : CARVED + STREAM.depth / 2, `x = ${x}`),
  )
  assert.ok(p.x.filter((x) => x > 21 && x < 59).length > 10)
  const none = dropped()
  none.x.forEach((x, k) => assert.equal(none.z[k], CARVED + STREAM.depth / 2, `x = ${x}, no lake`))
})

// Regression: the Canale della Fola runs into a pond near Arlia at its ground, 1.7 m over the level
// the pond's outlet caps it at; over the outlet's cascade, carved 4 m under it, it stood 3.4 m over
// the ground.
test("dropPerched: a surface more than PERCH over a lake's level is not the lake's water, and drops to the level", () => {
  // The lake from x 21 to 59 holds its water at 97.5 m, 2.25 m under the stream's surface.
  const p = dropped(stillLevel([across(21, 59, { level: 97.5 })]))
  p.x.forEach((x, k) =>
    assert.equal(p.z[k], x > 21 && x < 59 ? 97.5 : CARVED + STREAM.depth / 2, `x = ${x}`),
  )
})
