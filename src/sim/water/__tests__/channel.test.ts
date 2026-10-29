import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { atGrade } from "../../map/ground.ts"
import { MAP } from "../../map/index.ts"
import { waterAt } from "../rivers.ts"

/** The rivers about their mean, in a spate, and at the 30 years' highest flood (357 m³/s at Soliera), m³/s per km². */
const FLOWS = [0.041, 0.6, 1.72]
/** Half the rail bed's width, m (the map build profiles the track 4 m wide). */
const BED = 2
/** How finely the bed is sampled, along and across, m. */
const STEP = 0.25

/** Every point of the rail bed at grade (off bridges and tunnels, every track), `STEP` m apart along and across. */
const RAIL_BED = MAP.rail.flatMap((piece) => {
  if (piece.bridge === true || piece.tunnel === true) return []
  const out: Array<{ readonly x: number; readonly y: number }> = []
  for (let k = 0; k + 1 < piece.pts.length / 2; k++) {
    const ax = piece.pts[2 * k]!,
      ay = piece.pts[2 * k + 1]!,
      dx = piece.pts[2 * k + 2]! - ax,
      dy = piece.pts[2 * k + 3]! - ay,
      length = Ops.hypot(dx, dy)
    for (let along = 0; along < length; along += STEP)
      for (let off = -BED; off <= BED; off += STEP)
        out.push({
          x: ax + (dx * along - dy * off) / length,
          y: ay + (dy * along + dx * off) / length,
        })
  }
  return out
})

// Regression: the bed under the track was the rail bed the map build lays across a stream and the bank it raises beside it,
// so the water stood on the track, and on the bed's edge beside two of its culverts even at the mean flow.
test("channel: a stream crossing the track runs under it, through its culvert or under its deck: the whole rail bed stays dry at the mean, in a spate and in the 30 years' highest flood", () => {
  const streams = new Set<string>()
  for (const { x, y } of RAIL_BED) {
    // Any water's reach there, whatever its level.
    if (waterAt(x, y, -Infinity, FLOWS[0]!) === undefined) continue
    streams.add(`${Math.round(x / 50)},${Math.round(y / 50)}`)
    for (const q of FLOWS)
      assert.equal(
        waterAt(x, y, atGrade(x, y), q)?.depth,
        undefined,
        `water on the rail bed at (${x.toFixed(1)}, ${y.toFixed(1)}) at ${q} m³/s per km²`,
      )
  }
  assert.ok(streams.size >= 3, `the rail bed meets water at ${streams.size} places`)
})
