// The check water.test.ts (the bridges by Monzone) and water.map-test.ts (every bridge of the map) share: a walker's
// verge over the water in a spate is on the deck.
import assert from "node:assert/strict"

import { Ops } from "@typeonce/ritmo-math"

import { terrainZ } from "../map/ground.ts"
import type { Road } from "../map/index.ts"
import { waterUnder } from "../water/rivers.ts"

/**
 * Asserts that every point of the bridges among `roads` about the verge pedestrians walk (w/2 + 0.8 m off the
 * centreline) over the water at `discharge` is on the deck, not in the water; returns how many such points it checked.
 */
export const assertVergesDry = (roads: ReadonlyArray<Road>, discharge: number): number => {
  let checked = 0
  for (const road of roads.filter((r) => r.bridge === true))
    for (let k = 0; k + 1 < road.pts.length / 2; k++) {
      const ax = road.pts[2 * k]!,
        ay = road.pts[2 * k + 1]!,
        dx = road.pts[2 * k + 2]! - ax,
        dy = road.pts[2 * k + 3]! - ay,
        l = Ops.hypot(dx, dy)
      for (let t = 0; t <= 1; t += 0.05)
        for (const off of [-1.2, -0.9, -0.6, 0.6, 0.9, 1.2].map(
          (e) => Math.sign(e) * (road.w / 2) + e,
        )) {
          const x = ax + dx * t - (dy / l) * off,
            y = ay + dy * t + (dx / l) * off,
            under = waterUnder(x, y, true, discharge),
            deck = road.z[k]! + (road.z[k + 1]! - road.z[k]!) * t
          // Where the deck stands clear of the ground: at a bridge's foot the flood may reach the path.
          if (under === undefined || deck < terrainZ(x, y) + 0.5) continue
          checked++
          assert.equal(
            waterUnder(x, y, false, discharge),
            undefined,
            `bridge ${road.id} verge at ${x}, ${y}`,
          )
        }
    }
  return checked
}
