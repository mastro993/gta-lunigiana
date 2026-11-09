// Lunigiana's road tunnels the tests of their mouths (mouths.test.ts) and of their drawing
// (src/render/__tests__/tunnels.test.ts) share, found by geometry: the SR445's 172 m tunnel by
// Groppoli, west of Gragnola, the 196 m track tunnel south-east of Equi Terme, the 87 m path under
// the line at Equi Terme, Pieve San Lorenzo's 29 m underpass under the station and Via Casola's
// building passage in Casola.
import assert from "node:assert/strict"

import { segDist2 } from "../../../sim/collide.ts"
import { MAP, type MouthEntry, type Road } from "../../../sim/map/index.ts"
import { type Vectors, vectorsAround } from "../../testing.ts"

/** Inside each: the SR445's tunnel, the track's, the path's, Pieve San Lorenzo's underpass and Via Casola's passage. */
export const SR445 = { x: -2330, y: 4420 },
  TRACK = { x: 2855, y: 65 },
  PATH = { x: 1969, y: 920 },
  PIEVE = { x: 5040, y: 3620 },
  CASOLA = { x: 3577, y: 4152 }

let around: Vectors | undefined
/** The roads and buildings of the tiles round them (every one within 300 m), read when first asked: a test that only names a point reads no tile. */
export const aroundTunnels = (): Vectors =>
  (around ??= vectorsAround([SR445, TRACK, PATH, PIEVE, CASOLA], 300))

/** The road in a tunnel whose line passes nearest `at`, within 20 m, and its index in the whole map's roads. */
export const tunnelAt = (at: {
  readonly x: number
  readonly y: number
}): readonly [Road, number] => {
  let best = 20 ** 2,
    found: readonly [Road, number] | undefined
  const { roads } = aroundTunnels()
  roads.items.forEach((road, k) => {
    if (road.tunnel !== true) return
    for (let i = 0; i + 3 < road.pts.length; i += 2) {
      const { d2 } = segDist2(
        at.x,
        at.y,
        road.pts[i]!,
        road.pts[i + 1]!,
        road.pts[i + 2]!,
        road.pts[i + 3]!,
      )
      if (d2 < best) [best, found] = [d2, [road, roads.ids[k]!]]
    }
  })
  assert.ok(found !== undefined, `a road in a tunnel by (${at.x}, ${at.y})`)
  return found
}

/** Where the build stood the portal or head wall at road `id`'s mouth `end` (within 45 m: stood back into the tunnel at most 40 m). */
export const bakedAt = (
  end: { readonly x: number; readonly y: number },
  id: number,
): Exclude<MouthEntry, { readonly open: true }> => {
  const baked = MAP.derived.mouths.find(
    (mouth) =>
      mouth.road === id && !("open" in mouth) && Math.hypot(mouth.x - end.x, mouth.y - end.y) < 45,
  )
  assert.ok(
    baked !== undefined && !("open" in baked),
    `a portal or head wall at road ${id}'s mouth (${end.x}, ${end.y})`,
  )
  return baked
}
