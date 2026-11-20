import assert from "node:assert/strict"
import { test } from "node:test"

import { MEAN } from "../../sim/__tests__/flows.ts"
import { atLucido } from "../../sim/__tests__/lucido.ts"
import { groundZ } from "../../sim/map/ground.ts"
import { flood } from "../../sim/testing.ts"
import { waterUnder } from "../../sim/water/rivers.ts"
import { skidding } from "./skidding.ts"

/** 30 spots 0.1 m apart downstream, `across` m off the Lucido's middle, on the sim's ground there: under its water at the mean flow when `wet`. */
const along = (across: number, wet: boolean) =>
  Array.from({ length: 30 }, (_, k) => {
    const { x, y } = atLucido(across, 0.1 * k),
      water = waterUnder(x, y, false, MEAN)
    assert.equal(water !== undefined, wet, `${across} m across, ${0.1 * k} m down`)
    return { x, y, z: water === undefined ? groundZ(x, y) : water.level - water.depth }
  })

// Regression: a tyre sliding under water threw up its ground's dust out of it, so a car bogged in
// the surf sent a plume of dry sand up out of the sea, and one spinning in a river a gravel dust.
test("DrawEffects: a tyre sliding on the Lucido's gravel under its mean flow leaves its mark but throws up no dust; on the dry gravel of its bank it does", () => {
  const { runtime, slide } = skidding()
  assert.ok(runtime.tick(flood(MEAN)).ok)
  assert.deepEqual(slide(along(0, true), "gravel"), { marks: 29, puffs: 0 }, "in the river")
  // Two puffs a second per m/s of slip on gravel: 10 in half a second at 10 m/s.
  assert.deepEqual(slide(along(-10, false), "gravel"), { marks: 58, puffs: 10 }, "on its bank")
})
