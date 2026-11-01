import assert from "node:assert/strict"
import { test } from "node:test"

import { ringBox } from "../../../tools/geometry.ts"
import { wholeMap } from "../../../tools/map-file.ts"
import { pointInRing, staticGrid } from "../../collide.ts"
import { MAP, TILE } from "../../map/index.ts"
import { buildingsNear, farmBuilding, farmsNear, indoors } from "../farms.ts"

// Map checks (pnpm test:map): the buildings the animal spawns read, at points all over the map and
// along every tile seam, against one broad phase over the whole map's buildings (`staticGrid`, as
// the sim had before the map's vectors were cut into tiles).
const WHOLE = wholeMap()
const boxes = WHOLE.buildings.map((b) => ringBox(b.outer))
const grid = staticGrid(boxes.length, (i) => boxes[i]!, 64)

test("the buildings near a point come in the order one broad phase over the whole map gives, and a point is indoors where that finds it inside a building", () => {
  const near = (x: number, y: number, r: number) => {
    const found: Array<number> = []
    grid(x - r, y - r, x + r, y + r, (i) => {
      const [x0, y0, x1, y1] = boxes[i]!
      if (
        WHOLE.buildings[i]!.ruins !== true &&
        Math.max(x0 - x, 0, x - x1) ** 2 + Math.max(y0 - y, 0, y - y1) ** 2 <= r * r
      )
        found.push(i)
    })
    return found.map((i) => WHOLE.buildings[i]!)
  }
  const inside = (x: number, y: number) => {
    let is = false
    grid(x, y, x, y, (i) => {
      const { outer, holes } = WHOLE.buildings[i]!
      is ||= pointInRing(x, y, outer) && !(holes ?? []).some((h) => pointInRing(x, y, h))
    })
    return is
  }
  // Points anywhere, half of them within 40 m of a seam, and the farms (where the dogs and pigs are put).
  const { minX, minY, maxX, maxY } = MAP.bounds
  let seed = 3,
    houses = 0,
    indoorsAt = 0
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const points = Array.from({ length: 20_000 }, (_, k): [number, number] => {
    const x = minX + next() * (maxX - minX),
      y = minY + next() * (maxY - minY),
      off = (next() - 0.5) * 80
    if (k % 2 === 1) return [x, y]
    return k % 4 === 0
      ? [TILE * Math.round(x / TILE) + off, y]
      : [x, TILE * Math.round(y / TILE) + off]
  })
  for (const [x, y] of [
    ...points,
    ...farmsNear(0, 0, 1e7).map((f): [number, number] => [f.x + 6, f.y]),
  ]) {
    for (const r of [10, 25, 40]) {
      const got = buildingsNear(x, y, r)
      assert.deepEqual(got, near(x, y, r), `${x}, ${y}, ${r}`)
      houses += got.length
    }
    const is = indoors(x, y)
    assert.equal(is, inside(x, y), `${x}, ${y}`)
    if (is) indoorsAt++
  }
  assert.ok(
    houses > 10_000 && indoorsAt > 100,
    `${houses} buildings near, ${indoorsAt} points indoors`,
  )
})

test("each farm's building, read at its baked centre, is the one its index names", () => {
  const farms = farmsNear(0, 0, 1e7)
  assert.equal(farms.length, MAP.farms.length)
  for (const f of farms) assert.deepEqual(farmBuilding(f), WHOLE.buildings[f.building])
})
