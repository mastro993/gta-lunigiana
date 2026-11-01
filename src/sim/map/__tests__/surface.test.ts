import assert from "node:assert/strict"
import { test } from "node:test"

import { surfaceAt } from "../surface.ts"
import { roadsNear } from "./vectors-near.ts"

const FOREST = { x: 500, y: -400 },
  MEADOW = { x: -329, y: 1078 }
/** The roads of the four tiles round Monzone station (-493.8, 436.9) and the tiles' corner (0, 0). */
const ROADS = roadsNear(-493.8, 436.9, 1500)

test("surfaces: road carriageways by their OSM surface, the forest floor, a meadow", () => {
  // Midway along the longest segment of the first road of each surface, away from any junction.
  const cases = [
    ["tertiary", "asphalt", "asphalt"],
    ["path", "paving_stones", "stone"],
    ["track", "unpaved", "dirt"],
    ["track", "gravel", "gravel"],
  ] as const
  for (const [cls, surface, expected] of cases) {
    const { pts } = ROADS.find(
      (r) => r.cls === cls && r.surface === surface && r.tunnel !== true && r.bridge !== true,
    )!
    const length = (i: number) => (pts[i + 2]! - pts[i]!) ** 2 + (pts[i + 3]! - pts[i + 1]!) ** 2
    let k = 0
    for (let i = 0; i + 3 < pts.length; i += 2) if (length(i) > length(k)) k = i
    assert.equal(
      surfaceAt((pts[k]! + pts[k + 2]!) / 2, (pts[k + 1]! + pts[k + 3]!) / 2),
      expected,
      surface,
    )
  }
  assert.equal(surfaceAt(FOREST.x, FOREST.y), "leaves")
  assert.equal(surfaceAt(MEADOW.x, MEADOW.y), "grass")
})

test("surfaces by level: the hillside over a tunnel is its own cover, the deck only on the deck", () => {
  const tunnel =
    ROADS.find((r) => r.tunnel === true && r.surface === "unpaved" && r.cls === "track") ??
    ROADS.find((r) => r.tunnel === true && r.cls === "track")!
  const k = Math.floor(tunnel.z.length / 2) - 1
  const x = (tunnel.pts[2 * k]! + tunnel.pts[2 * k + 2]!) / 2,
    y = (tunnel.pts[2 * k + 1]! + tunnel.pts[2 * k + 3]!) / 2,
    floor = (tunnel.z[k]! + tunnel.z[k + 1]!) / 2
  assert.notEqual(surfaceAt(x, y, floor + 30), surfaceAt(x, y, floor), "30 m up the hillside")
  assert.equal(surfaceAt(x, y, floor), surfaceAt(x, y), "in the tunnel, as without a level")
})
