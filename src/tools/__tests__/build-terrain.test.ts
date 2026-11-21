import assert from "node:assert/strict"
import { test } from "node:test"

import { roadsNear } from "../../sim/map/__tests__/vectors-near.ts"
import { ROAD_LIFT, roadZ, terrainZ } from "../../sim/map/ground.ts"
import { MAP, roadClassOf } from "../../sim/map/index.ts"

// Regression (#20, round 3): a path or steps at grade follows the terrain as the game draws it
// (`finishTerrain`). Read bilinearly off the finished grid, the footways 1462688623 and 1484690678
// beside Sarzana's service tunnel 376037643 took the share of a corner the mouths' hold sinks to
// the bore's floor where the drawn mesh does not, lay 0.92 and 0.96 m under it at a vertex, and
// climbed 1.2 m in a metre out of the dip. Found by geometry: the mouths baked nearest the points.

/** How far round each mouth (m) the paths are read: past the cells held behind it. */
const REACH = 12

test("paths at grade: round the mouths of Sarzana's service tunnel 376037643, every vertex on the terrain as drawn, and the way climbing 0.5 m at most in a metre", () => {
  const mouths = [
    { x: -14489.6, y: -4827.4 },
    { x: -14472.3, y: -4822.1 },
  ].map((at) => {
    const mouth = MAP.derived.mouths.find((m) => Math.hypot(m.x - at.x, m.y - at.y) < 5)
    assert.ok(mouth !== undefined, `a road tunnel's mouth by (${at.x}, ${at.y})`)
    return mouth
  })
  let vertices = 0
  for (const mouth of mouths)
    for (const road of roadsNear(mouth.x, mouth.y, REACH)) {
      const cls = roadClassOf(road)
      if ((cls !== "path" && cls !== "steps") || road.bridge === true || road.tunnel === true)
        continue
      // Its surface every 0.1 m within reach (m along it, m a.s.l.), as a walker reads it.
      const surface: Array<readonly [number, number]> = []
      let s = 0
      for (let k = 0; k + 1 < road.z.length; k++) {
        const ax = road.pts[2 * k]!,
          ay = road.pts[2 * k + 1]!,
          bx = road.pts[2 * k + 2]!,
          by = road.pts[2 * k + 3]!,
          len = Math.hypot(bx - ax, by - ay),
          n = Math.max(1, Math.ceil(len / 0.1))
        if (Math.hypot(ax - mouth.x, ay - mouth.y) <= REACH) {
          vertices++
          const off = road.z[k]! - terrainZ(ax, ay)
          assert.ok(
            Math.abs(off) <= 0.05 + 1e-9,
            `${cls} ${road.id}'s vertex ${k} ${off.toFixed(2)} m off the terrain`,
          )
        }
        for (let q = 0; q < n; q++) {
          const x = ax + ((bx - ax) * q) / n,
            y = ay + ((by - ay) * q) / n
          if (Math.hypot(x - mouth.x, y - mouth.y) > REACH) continue
          const z = road.z[k]! + ((road.z[k + 1]! - road.z[k]!) * q) / n
          surface.push([s + (len * q) / n, roadZ(z, x, y, ROAD_LIFT[cls], false)])
        }
        s += len
      }
      for (let i = 0; i < surface.length; i++)
        for (let j = i + 1; j < surface.length && surface[j]![0] - surface[i]![0] <= 1; j++)
          assert.ok(
            Math.abs(surface[j]![1] - surface[i]![1]) <= 0.5,
            `${cls} ${road.id} climbs ${Math.abs(surface[j]![1] - surface[i]![1]).toFixed(2)} m from ${surface[i]![0].toFixed(1)} to ${surface[j]![0].toFixed(1)} m along it`,
          )
    }
  assert.ok(vertices > 4, `${vertices} vertices read`)
})
