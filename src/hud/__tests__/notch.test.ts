// The maps on Lunigiana with its north-east tiles unlisted and an L outline (`notchMap`): the
// minimap paints only listed tiles, and both maps lay their grass on the L and clip to it.
import assert from "node:assert/strict"
import { test } from "node:test"

import { L, notchMap } from "../../sim/map/__tests__/edit-map.ts"

notchMap()
const { paintMap, tilesNear } = await import("../minimap.ts")

test("an L: the minimap paints only listed tiles, and the maps lay their grass on the L and clip to it", () => {
  // 500 m off the notch's south and west sides: the notch's own two tiles in reach are left out
  assert.deepEqual(
    tilesNear(2500, 500, 1500).map((t) => t.key),
    ["1_-1", "0_0", "0_-1"],
  )
  /** A stand-in for the browser's Path2D: it keeps the points it is given. */
  class Points {
    readonly pts: Array<number> = []
    moveTo(x: number, y: number) {
      this.pts.push(x, y)
    }
    lineTo(x: number, y: number) {
      this.pts.push(x, y)
    }
    closePath() {}
  }
  const clips: Array<Points> = [],
    fills: Array<Points> = []
  const ctx = new Proxy(
    {
      save: () => {},
      restore: () => {},
      clip: (p: Points) => clips.push(p),
      fill: (p: Points) => fills.push(p),
      stroke: () => {},
    },
    { set: () => true },
  )
  Object.assign(globalThis, { Path2D: Points })
  // the full map's fit, painting only what reaches a box in the notch
  paintMap(
    ctx as unknown as CanvasRenderingContext2D,
    0.1,
    { minX: -2900, maxY: 3900 },
    {
      overview: true,
      within: [2500, 500, 2600, 600],
    },
  )
  const px = L.map((v, k) => (k % 2 === 0 ? (v + 2900) * 0.1 : (3900 - v) * 0.1))
  assert.deepEqual(
    clips.map((p) => p.pts),
    [px],
  )
  assert.deepEqual(fills[0]!.pts, px)
})
