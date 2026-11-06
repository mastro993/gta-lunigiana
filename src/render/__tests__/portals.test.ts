// Lunigiana with its outline's east side moved west onto its easternmost tunnel mouth, as a region
// whose outline cuts a tunnel gives (the build clips the tunnel's piece there, issue #7): an end on
// the play area's edge is where a line runs on past it, not a mouth, the railway's or a road's.
import assert from "node:assert/strict"
import { test } from "node:test"

import { editMap } from "../../sim/map/__tests__/edit-map.ts"
import type { Road } from "../../sim/map/index.ts"

/** Each tunnel mouth in the global file's railway: an end of a tunnel piece no other tunnel piece goes on from. */
let mouths: Array<readonly [number, number]> = []
/** The mouth the outline's east side runs through. */
let cut: readonly [number, number] = [0, 0]
/** The bounds' east side, m. */
let maxX = 0
editMap((json) => {
  const tunnels = json.rail.filter((rail) => rail.tunnel === true)
  const ends = tunnels.flatMap(({ pts, z }) =>
    [0, z.length - 1].map((k) => [pts[2 * k]!, pts[2 * k + 1]!] as const),
  )
  mouths = ends.filter(([x, y]) => ends.filter(([ox, oy]) => ox === x && oy === y).length === 1)
  cut = mouths.reduce((east, m) => (m[0] > east[0] ? m : east))
  const { minX, minY, maxY } = json.bounds
  maxX = json.bounds.maxX
  // The road tunnels' portals left out: the railway's alone are drawn.
  return {
    ...json,
    outline: [[minX, minY, cut[0], minY, cut[0], maxY, minX, maxY]],
    derived: { ...json.derived, mouths: [] },
  }
})
const { bakeMouths, portalPieces } = await import("../portals.ts")

test("a tunnel ending on the play area's edge has no portal there, every other mouth has one", () => {
  assert.ok(cut[0] < maxX - 100, `the cut at ${cut[0]}, 100 m or more inside the bounds' edge`)
  const drawn = portalPieces().map(({ pts }) => [pts[0]!, pts[1]!] as const)
  assert.ok(drawn.length >= 4, `${drawn.length} portals`)
  assert.deepEqual(
    drawn,
    mouths.filter((m) => m !== cut),
  )
})

test("a road tunnel ending on the play area's edge has no mouth there, and one at its other end", () => {
  const [x, y] = cut,
    road: Road = {
      id: 1,
      cls: "track",
      w: 3,
      surface: "unpaved",
      tunnel: true,
      pts: [x - 60, y, x, y],
      z: [0, 0],
    }
  assert.deepEqual(
    bakeMouths({ ids: [7], items: [road] }).map((mouth) => [mouth.road, mouth.x, mouth.y]),
    [[7, x - 60, y]],
  )
})
