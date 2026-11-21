import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { MAP } from "../../map/index.ts"
import { eachTile } from "../../map/tiles.ts"
import { bedOf } from "../channel.ts"
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
test("channel: no stream's bed by Monzone station stands more than depth/2 over the water's own surface, as the build's carve leaves none: under the ground a road lays over its channel it runs in a culvert", () => {
  const over: Array<string> = []
  const seen = new Set<number>()
  eachTile(STATION.x - 1000, STATION.y - 1000, STATION.x + 1000, STATION.y + 1000, ({ vectors }) =>
    vectors.water.items.forEach((w, i) => {
      const id = vectors.water.ids[i]!
      if (seen.has(id)) return
      seen.add(id)
      bedOf(w).forEach((bed, k) => {
        if (bed > w.z[k]! + w.depth / 2)
          over.push(`${w.id} vertex ${k}: ${bed.toFixed(2)} over ${w.z[k]}`)
      })
    }),
  )
  assert.ok(seen.size > 50, `${seen.size} waters`)
  assert.deepEqual(over, [])
})
