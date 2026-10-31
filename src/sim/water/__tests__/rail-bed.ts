// The check channel.test.ts (the track within 4 km of Monzone station) and channel.map-test.ts (all
// of the map's) share: the rail bed stays dry where a stream crosses it.
import assert from "node:assert/strict"

import { Ops } from "@typeonce/ritmo-math"

import { atGrade } from "../../map/ground.ts"
import type { Rail } from "../../map/index.ts"
import { waterAt } from "../rivers.ts"

/** The rivers about their mean, in a spate, and at the 30 years' highest flood (357 m³/s at Soliera), m³/s per km². */
const FLOWS = [0.041, 0.6, 1.72]
/** Half the rail bed's width, m (the map build profiles the track 4 m wide). */
const BED = 2
/** How finely the bed is sampled, along and across, m. */
const STEP = 0.25

/**
 * Every point of the bed of `track` at grade (off bridges and tunnels), `STEP` m apart along and
 * across, stays dry at each of `FLOWS`; the bed meets water at `least` places (50 m squares) or more.
 */
export const checkBedDry = (track: ReadonlyArray<Rail>, least: number): void => {
  const streams = new Set<string>()
  for (const piece of track) {
    if (piece.bridge === true || piece.tunnel === true) continue
    for (let k = 0; k + 1 < piece.pts.length / 2; k++) {
      const ax = piece.pts[2 * k]!,
        ay = piece.pts[2 * k + 1]!,
        dx = piece.pts[2 * k + 2]! - ax,
        dy = piece.pts[2 * k + 3]! - ay,
        length = Ops.hypot(dx, dy)
      for (let along = 0; along < length; along += STEP)
        for (let off = -BED; off <= BED; off += STEP) {
          const x = ax + (dx * along - dy * off) / length,
            y = ay + (dy * along + dx * off) / length
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
    }
  }
  assert.ok(streams.size >= least, `the rail bed meets water at ${streams.size} places`)
}
