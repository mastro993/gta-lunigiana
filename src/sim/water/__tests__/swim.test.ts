import assert from "node:assert/strict"
import { test } from "node:test"

import { personBuild } from "../../systems/water.ts"
import { holdOf, personMass, swept, wadeShare, wadingSpeed } from "../swim.ts"

const still = (depth: number, speed = 0) => ({
  depth,
  level: depth,
  vx: speed,
  vy: 0,
  bankX: 0,
  bankY: 1,
})

test("hold: an adult stands to a depth × speed of 1.2 m²/s, a 1.2 m child to 0.4, as Cox et al. (2010) find", () => {
  assert.ok(Math.abs(holdOf(1.75, 75) - 1.2) < 1e-9)
  assert.ok(Math.abs(personBuild(1.2).hold - 0.4) < 0.02, `${personBuild(1.2).hold}`)
  assert.equal(holdOf(1.4, 600), 1.2, "no body stands more than an adult")
  assert.ok(Math.abs(personMass(1.75) - 75) < 0.1)
})

test("swept: off its feet at its chest or past its hold, back on them a little under either", () => {
  const adult = personBuild(1.75)
  assert.ok(!swept(still(1.1), adult, false))
  assert.ok(swept(still(1.3), adult, false), "the water at the chest lifts it")
  assert.ok(swept(still(0.5, 2.6), adult, false), "1.3 m²/s takes its feet")
  assert.ok(swept(still(1.15), adult, true), "swimming, it stands again only lower down")
  assert.ok(!swept(still(1), adult, true))
})

test("wading: walking pace falls by about two fifths in knee-deep water (0.35 m), more for a child", () => {
  assert.ok(Math.abs(wadeShare(0.35, 1.75) - 0.6) < 0.01)
  assert.ok(wadeShare(0.35, 1.2) < wadeShare(0.35, 1.75))
  assert.equal(wadeShare(2, 1.75), 0.25, "never below a quarter")
})

test("running in water: a sprint splashes through the shallows and is a wade by knee depth", () => {
  const sprint = (depth: number) => wadingSpeed(5.5, depth, 1.75)
  assert.ok(sprint(0.1) > 3 && sprint(0.1) < 0.9 * 5.5, `${sprint(0.1)} m/s in 0.1 m`)
  assert.ok(
    Math.abs(sprint(0.49) - wadingSpeed(1.4, 0.49, 1.75)) < 1e-9,
    "at the knees no faster than a walk",
  )
  assert.equal(wadingSpeed(1.2, 0.3, 1.75), 1.2 * wadeShare(0.3, 1.75), "a walk only wades")
})
