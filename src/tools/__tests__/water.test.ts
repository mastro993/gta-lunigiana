// Water left perched over the carved ground (water.ts's `dropPerched`): it drops to the ground, but in
// a lake's water, whose carved bed lies under it; and the sea's level, which no water stands under
// and a river reaching the sea meets.
import assert from "node:assert/strict"
import { test } from "node:test"

import type { WaterF } from "../features.ts"
import { ringBox } from "../geometry.ts"
import { PIER_DECK, pierDeck } from "../shore.ts"
import { type CarvedArea, stillLevel } from "../water-areas.ts"
import { BRIDGE_CLEAR, capUnderDecks, dropPerched, waterProfiles } from "../water.ts"

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
// Regression: a stream falling into the Magra's gravel at Aulla (way 1430400928) had a sample
// dropped to its ground and the next, within PERCH of its own, left over it: its surface stepped
// 0.1 m back up in the river polygon (49.0 m after 48.9 at (−13572.7, 4476.3)).
test("dropPerched: no sample after a dropped one steps back up over it", () => {
  // Down 1 m every 2 m sample, each sample's carved ground 1.15 m under it (0.9 m over its top:
  // kept), but at x 40, 1.35 m under it (1.1 m over its top: dropped).
  const [p] = waterProfiles([STREAM], (x) => 100 - x / 2)
  const before = Float64Array.from(p!.z),
    at = p!.x.indexOf(40)
  const carved = Float64Array.from(before, (z, k) => z - (k === at ? 1.35 : 1.15))
  dropPerched([STREAM], [p!], [], [carved])
  p!.z.forEach((z, k) =>
    assert.ok(k === 0 || z <= p!.z[k - 1]!, `x = ${p!.x[k]}: ${z} after ${p!.z[k - 1]}`),
  )
  assert.equal(p!.z[at], carved[at]! + STREAM.depth / 2, "dropped to its top")
  assert.equal(p!.z[at + 1], p!.z[at], "held at the dropped surface, over its own ground")
  p!.z.forEach((z, k) =>
    assert.ok(k === at || k === at + 1 || z === before[k], `x = ${p!.x[k]} moved`),
  )
})

// The hold above stops where the ground rises past the dropped surface: pinned to its own ground
// there, a stream onto the Magra's gravel (way 791364133), past the dip a path at grade takes it
// under, rippled 0.3 m up and down.
test("dropPerched: a sample whose own ground stands over a dropped one before it keeps its surface", () => {
  const [p] = waterProfiles([STREAM], (x) => 100 - x / 2)
  const before = Float64Array.from(p!.z),
    at = p!.x.indexOf(40)
  // At x 40 the ground 1.35 m under the surface (dropped 1.1 m, to 1.1 m under it); from x 42 on it
  // stands 1.05 m under the surface, over the dropped one at x 40.
  const carved = Float64Array.from(before, (z, k) => z - (k === at ? 1.35 : k > at ? 0.05 : 1.15))
  dropPerched([STREAM], [p!], [], [carved])
  assert.equal(p!.z[at], carved[at]! + STREAM.depth / 2, "dropped to its top")
  p!.z.forEach((z, k) => assert.ok(k === at || z === before[k], `x = ${p!.x[k]} moved`))
})

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
  capUnderDecks([RIVER], [p!], [{ water: 0, at: 150, half: 2, deck: 1, clear: BRIDGE_CLEAR }])
  p!.z.forEach((z, k) => assert.ok(z >= 0, `capped sample ${k}: ${z}`))
  // The sea floor 3 m under the level beneath the mouth: perched water drops no lower than it.
  dropPerched([RIVER], [p!], [], [new Float64Array(p!.x.length).fill(-3)])
  p!.z.forEach((z, k) => assert.equal(z, 0, `dropped sample ${k}`))
})

// Regression: a pier's crossing was capped as a bridge's, BRIDGE_CLEAR under its deck, which
// `pierDeck` sets PIER_DECK over the water: the river fell 1.5 m under its own level there and on
// downstream.
test("capUnderDecks: a pier's deck keeps the water under it at the level the deck stands on; a bridge's as high keeps it BRIDGE_CLEAR under, on downstream", () => {
  // The plain flat at 102 m: the river's surface 100.75 m all along, a pier across it at y −100.
  const ground = () => 102
  const [level] = waterProfiles([RIVER], ground)
  const [deck] = pierDeck(
    [
      { x: -10, y: -100 },
      { x: 10, y: -100 },
    ],
    () => 102,
    () => 100.75,
  )
  assert.equal(deck, 100.75 + PIER_DECK)
  const capped = (clear: number) => {
    const [p] = waterProfiles([RIVER], ground)
    capUnderDecks([RIVER], [p!], [{ water: 0, at: 100, half: 3, deck, clear }])
    return p!
  }
  assert.deepEqual(capped(PIER_DECK).z, level!.z, "under a pier")
  const bridge = capped(BRIDGE_CLEAR)
  bridge.s.forEach((s, k) => {
    if (s >= 97) assert.equal(bridge.z[k], 99.25, `under a bridge and ${s} m down the river`)
  })
})
