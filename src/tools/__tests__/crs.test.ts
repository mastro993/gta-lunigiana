import assert from "node:assert/strict"
import { test } from "node:test"

import { latLonToUtm32, utm32ToLatLon } from "../crs.ts"

test("latLonToUtm32 inverts utm32ToLatLon within a millimetre round Lunigiana", () => {
  // Monte Sillara's ridge, the map's origin and lucido's southern ridge; Krüger's series to n³
  // leaves about 0.3 mm there.
  for (const [e, n] of [
    [584749, 4913222],
    [590350, 4890459],
    [590000, 4885000],
  ] as const) {
    const [e2, n2] = latLonToUtm32(...utm32ToLatLon(e, n))
    assert.ok(Math.hypot(e2 - e, n2 - n) < 0.001, `${e}, ${n} came back as ${e2}, ${n2}`)
  }
})
