// Water left perched over the carved ground (water.ts's `dropPerched`): it drops to the ground, but in
// a lake's water, whose carved bed lies under it; and the sea's level, which no water stands under
// and a river reaching the sea meets.
import assert from "node:assert/strict"
import { test } from "node:test"

import type { WaterF } from "../features.ts"
import { ringBox } from "../geometry.ts"
import { type CarvedArea, stillLevel } from "../water-areas.ts"
import { capUnderDecks, dropPerched, waterProfiles } from "../water.ts"

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

/** A river south along x = 0 from y 0 to y −200, the sea south of y −190 (its mouth 10 m in it). */
const RIVER: WaterF = {
  id: 2,
  kind: "river",
  w: 4,
  bed: 3,
  depth: 2.5,
  pts: [
    { x: 0, y: 0 },
    { x: 0, y: -100 },
    { x: 0, y: -200 },
  ],
  from: 0,
}
const SEA = (_x: number, y: number) => y < -190

test("waterProfiles: no surface stands under the sea's level, and a river reaching the sea meets it at 0 m, its tail lowered to it", () => {
  // The plain falls from 3 m to 1 m a.s.l. at the mouth: the surface (ground − 1.25 m) from 1.75 m
  // to under the sea.
  const ground = (_x: number, y: number) => 3 + y / 100
  const [p] = waterProfiles([RIVER], ground, SEA)
  p!.z.forEach((z, k) => assert.ok(z >= 0, `sample ${k}: ${z}`))
  assert.equal(p!.z.at(-1), 0)
  assert.equal(p!.z[0], 1.75, "upstream as the ground has it")
  // Over the sea's level at its mouth (a stream off a cliff): the tail lowered over the last 20 m,
  // as a tributary's to the water it joins, and left above.
  const [cliff] = waterProfiles([RIVER], () => 6.25, SEA)
  assert.equal(cliff!.z.at(-1), 0)
  cliff!.z.forEach((z, k) => {
    const left = cliff!.s.at(-1)! - cliff!.s[k]!
    assert.ok(
      Math.abs(z - (left >= 20 ? 5 : (5 * left) / 20)) < 1e-9,
      `${left} m short of the mouth: ${z}`,
    )
  })
  // Ending short of the sea, the same river keeps its last surface: only the sea's level holds it.
  const [inland] = waterProfiles(
    [RIVER],
    () => 6.25,
    (_x, y) => y < -210,
  )
  assert.equal(inland!.z.at(-1), 5)
  const [low] = waterProfiles([RIVER], ground, (_x, y) => y < -210)
  assert.equal(low!.z.at(-1), 0, "under the sea's level, raised to it")
})

test("capUnderDecks and dropPerched keep the water at the sea's level or over it", () => {
  const [p] = waterProfiles([RIVER], () => 1.25, SEA)
  // A footbridge 1 m over the sea's level at y −150: the water capped 2.5 m under its deck stays at 0.
  capUnderDecks([RIVER], [p!], [{ water: 0, at: 150, half: 2, deck: 1, bridge: true }])
  p!.z.forEach((z, k) => assert.ok(z >= 0, `capped sample ${k}: ${z}`))
  // The sea floor 3 m under the level beneath the mouth: perched water drops no lower than it.
  dropPerched([RIVER], [p!], [], [new Float64Array(p!.x.length).fill(-3)])
  p!.z.forEach((z, k) => assert.equal(z, 0, `dropped sample ${k}`))
})
