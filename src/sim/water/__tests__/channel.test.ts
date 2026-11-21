import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { SPATE } from "../../__tests__/flows.ts"
import { atGrade, terrainZ } from "../../map/ground.ts"
import { MAP } from "../../map/index.ts"
import { eachTile } from "../../map/tiles.ts"
import { bedOf } from "../channel.ts"
import { waterIndex } from "../rivers.ts"
import { checkBedDry } from "./rail-bed.ts"

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }

/** The track with a point within 4 km of Monzone station; channel.map-test.ts checks all of the map's. */
const HERE = MAP.rail.filter(({ pts }) =>
  pts.some((_, k) => k % 2 === 0 && Ops.hypot(pts[k]! - STATION.x, pts[k + 1]! - STATION.y) < 4000),
)

// Regression: the bed under the track was the rail bed the map build lays across a stream and the bank it raises beside it,
// so the water stood on the track, and on the bed's edge beside two of its culverts even at the mean flow.
test("channel: a stream crossing the track by Monzone station runs under it, through its culvert or under its deck: the rail bed stays dry at the mean, in a spate and in the 30 years' highest flood", () => {
  checkBedDry(HERE, 3)
})

// Regression: a stream beside a road on the plain below Arcola (373093516) ran under the road's
// fill, which the road's core lays over the channel the build carves beside it, and its bed was
// that fill, 1.2–2.5 m over the water's own surface: a spate stood on it, and on the verge of the
// 6 m bridge 373320292 over it.
test("channel: a stream whose surface runs 2 m under the ground by Monzone station (a road's fill over its channel) runs in a culvert under it: the ground stays dry in a spate", () => {
  // The vertices of the streams within 1 km of the station off any road, the water's surface set
  // 2 m under the ground there.
  const pts: Array<number> = []
  eachTile(STATION.x - 1000, STATION.y - 1000, STATION.x + 1000, STATION.y + 1000, ({ vectors }) =>
    vectors.water.items.forEach((w) => {
      for (let k = 0; k < w.pts.length && pts.length < 2 * 40; k += 2) {
        const x = w.pts[k]!,
          y = w.pts[k + 1]!
        if (
          w.w <= 2 &&
          Ops.hypot(x - STATION.x, y - STATION.y) < 1000 &&
          atGrade(x, y) === terrainZ(x, y)
        )
          pts.push(x, y)
      }
    }),
  )
  const z = Array.from(
    { length: pts.length / 2 },
    (_, k) => terrainZ(pts[2 * k]!, pts[2 * k + 1]!) - 2,
  )
  const fill = { id: 1, kind: "stream", w: 2, bed: 3, depth: 1, pts, z, area: z.map(() => 5) }
  const floor = bedOf(fill)
  const index = waterIndex([{ ...fill, floor }], [])
  let dry = 0
  for (let k = 0; k < z.length; k++) {
    const x = pts[2 * k]!,
      y = pts[2 * k + 1]!
    assert.equal(floor[k], z[k]! - 0.5, `the culvert's bed at (${x}, ${y})`)
    assert.equal(index.at(x, y, terrainZ(x, y), SPATE), undefined, `the ground at (${x}, ${y})`)
    dry++
  }
  assert.ok(dry > 20, `${dry} vertices`)
})
