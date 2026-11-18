import assert from "node:assert/strict"
import { test } from "node:test"

import { useDiskMap } from "../../sim/map/source.ts"
import { skipUnbuilt, TEST_MAPS } from "../../tools/__tests__/test-maps.ts"

// Map check (pnpm test:map), on the coast test region (`magra-coast`): this process loads it from
// test-maps/ (`pnpm maps` builds it); without the build the check is skipped, but in CI, which
// builds it, a missing build fails.
const [NAME, URL_COAST] = TEST_MAPS.find(([name]) => name === "the coast")!
const skip = skipUnbuilt(NAME, URL_COAST)
if (skip === false) useDiskMap(URL_COAST)
const kit =
  skip === false
    ? {
        ...(await import("./skidding.ts")),
        ...(await import("../../sim/map/ground.ts")),
        ...(await import("../../sim/map/surface.ts")),
        ...(await import("../../sim/water/rivers.ts")),
        ...(await import("../../sim/__tests__/flows.ts")),
      }
    : undefined

/** Marinella di Sarzana's beach 260 m west of its village (-9071, -12606): the column walked south from the village to the sea. */
const BEACH_X = -9330

// Regression: a car bogged in the surf, its wheels spinning on the sand under the sea, sent a plume
// of dry sand dust up out of the water.
test(
  "DrawEffects, magra-coast: a tyre spinning on Marinella's sand under the sea leaves its mark but throws up no dust; on the dry beach behind it does",
  { skip },
  () => {
    const k = kit!
    const wet = (x: number, y: number) => k.waterAt(x, y, k.groundZ(x, y), k.MEAN) !== undefined
    // The water's edge: the first point in the sea walking south from the village, 0.5 m a step.
    let edge = -12606
    while (!wet(BEACH_X, edge) && edge > -13500) edge -= 0.5
    assert.ok(edge > -13500, "the sea south of Marinella")
    /** 30 spots 0.1 m apart along the shore, `out` m seaward of its edge, all on sand, in the sea when `sea`. */
    const along = (out: number, sea: boolean) =>
      Array.from({ length: 30 }, (_, n) => {
        const x = BEACH_X + 0.1 * n,
          y = edge - out,
          z = k.groundZ(x, y)
        assert.equal(wet(x, y), sea, `(${x}, ${y})`)
        assert.equal(k.surfaceAt(x, y, z), "sand", `(${x}, ${y})`)
        return { x, y, z }
      })
    // The sea stands still at 0 m whatever the rivers carry: the runtime's own flow.
    const { slide } = k.skidding()
    assert.deepEqual(slide(along(6, true), "sand"), { marks: 29, puffs: 0 }, "in the sea")
    // Three puffs a second per m/s of slip on sand: 15 in half a second at 10 m/s.
    assert.deepEqual(slide(along(-15, false), "sand"), { marks: 58, puffs: 15 }, "on the beach")
  },
)
