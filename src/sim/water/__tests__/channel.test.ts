import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { MAP } from "../../map/index.ts"
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
