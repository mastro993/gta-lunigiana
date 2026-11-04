import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { placeFrom } from "../place.ts"

const ORIGIN = { lat: 44.16175, lon: 10.13 }
/** 50 × 40 nodes 4 m apart, their north-east quarter unlisted (an L's notch). */
const cols = 50,
  rows = 40
const listed = Uint8Array.from({ length: cols * rows }, (_, n) =>
  n % cols >= 25 && Math.floor(n / cols) >= 20 ? 0 : 1,
)
/** A plane from 200 m rising 0.3 m a node east and 0.1 m north, in decimetres; 0 in the notch, as `joinTiles` leaves it. */
const data = Int16Array.from({ length: cols * rows }, (_, n) =>
  listed[n] === 1 ? 2000 + 3 * (n % cols) + Math.floor(n / cols) : 0,
)

test("placeFrom fits the place over the listed nodes alone: an L's notch moves neither its floor nor its slope", () => {
  const where = placeFrom(ORIGIN, { cell: 4, cols, rows, data }, listed)
  const heights = Array.from(data.filter((_, n) => listed[n] === 1)).sort((a, b) => a - b)
  assert.equal(where.floor, heights[Math.floor(0.05 * (heights.length - 1))]! / 10)
  // falling west-south-west, down the plane
  assert.ok(Math.abs(where.downslope - Ops.atan2(-1, -3)) < 1e-9, `${where.downslope}`)
  assert.deepEqual([where.lat, where.lon], [ORIGIN.lat, ORIGIN.lon])
  // Read whole, the notch's zeros are its low ground.
  assert.equal(placeFrom(ORIGIN, { cell: 4, cols, rows, data }).floor, 0)
})
