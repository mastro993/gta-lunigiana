import assert from "node:assert/strict"
import { test } from "node:test"

import { facingAt, groundZ, terrainZ } from "../../map/ground.ts"
import { DAY, daysFromCivil, utcFromRome } from "../calendar.ts"
import { airAt } from "../climate.ts"
import { groundAt } from "../local.ts"
import { underfoot } from "../underfoot.ts"

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }

test("underfoot: a wheel on a north face takes the snow the face holds under a line 150 m over it, where level ground lies bare", () => {
  const air = airAt(utcFromRome(daysFromCivil(2027, 1, 15) * DAY + 10 * 3600), {
    cloud: 0,
    wind: 2,
    anomaly: -6,
  })
  // Bare terrain round the station facing at least half north, gentle enough for the snow to settle, found by geometry.
  let faces = 0
  for (let x = STATION.x - 600; x <= STATION.x + 600; x += 7.3)
    for (let y = STATION.y - 600; y <= STATION.y + 600; y += 7.3) {
      const z = terrainZ(x, y)
      if (groundZ(x, y, z) > z + 0.01) continue
      const face = facingAt(x, y, z)
      if (face.north < 0.5 || face.up < 0.81) continue
      const weather = { wet: 0, snowLine: z + 150 }
      assert.equal(underfoot(weather, air)(x, y, z).snow, 1, `snow on the face at (${x}, ${y})`)
      assert.equal(groundAt(weather, x, y, z, air).snow, 0, "none on level ground at its height")
      faces++
    }
  assert.ok(faces > 20, `${faces} north faces`)
})
