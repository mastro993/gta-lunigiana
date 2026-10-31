import assert from "node:assert/strict"
import { test } from "node:test"

import { ringBox } from "../../../tools/geometry.ts"
import { wholeMap } from "../../../tools/map-file.ts"
import { staticGrid } from "../../collide.ts"
import { MAP, TILE } from "../../map/index.ts"
import { buildingCentre, residentsNear, residentsOf } from "../density.ts"

// Map checks (pnpm test:map): the residents round points all over the map and along every tile seam,
// against one broad phase over the whole map's buildings (`staticGrid`, as the sim had before the
// map's vectors were cut into tiles).
const WHOLE = wholeMap()

test("the residents round a point add up to the bits of the same homes visited by one broad phase over the whole map, across the seams too", () => {
  const boxes = WHOLE.buildings.map((b) => ringBox(b.outer))
  const grid = staticGrid(boxes.length, (i) => boxes[i]!, 64)
  const oracle = (x: number, y: number, r: number) => {
    let sum = 0
    grid(x - r, y - r, x + r, y + r, (i) => {
      const b = WHOLE.buildings[i]!,
        c = buildingCentre(b)
      if ((c.x - x) * (c.x - x) + (c.y - y) * (c.y - y) <= r * r) sum += residentsOf(b)
    })
    return sum
  }
  // Points anywhere, and half of them within 40 m of a seam; the reaches the game counts with.
  const { minX, minY, maxX, maxY } = MAP.bounds
  let seed = 5,
    found = 0
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let k = 0; k < 6000; k++) {
    const x = minX + next() * (maxX - minX),
      y = minY + next() * (maxY - minY),
      off = (next() - 0.5) * 80
    const [px, py] =
      k % 2 === 1
        ? [x, y]
        : k % 4 === 0
          ? [TILE * Math.round(x / TILE) + off, y]
          : [x, TILE * Math.round(y / TILE) + off]
    for (const r of [45, 60, 140, 250]) {
      const got = residentsNear(px, py, r)
      assert.ok(Object.is(got, oracle(px, py, r)), `${px}, ${py}, ${r}: ${got}`)
      if (got > 0) found++
    }
  }
  assert.ok(found > 3000, `${found} sums with people`)
})
