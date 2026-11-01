import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP, TILE } from "../../sim/map/index.ts"
import { readMapFile, tileUrl } from "../../sim/map/packed.ts"
import { isResident, provideTile } from "../../sim/map/tiles.ts"
import { wholeMap } from "../../tools/map-file.ts"
import { locationAt } from "../location.ts"
import { roadOracle } from "./road-oracle.ts"

// Map check (pnpm test:map): location.test.ts checks the points round Monzone against the roads of
// the tiles round it.
test("the road named is the old answer over the whole map's roads: by every road and along every tile seam", () => {
  const whole = wholeMap()
  const old = roadOracle(whole.roads)
  for (const { i, j } of MAP.tiles)
    if (!isResident(`${i}_${j}`)) provideTile(readMapFile(tileUrl(MAP.name, `${i}_${j}`)))
  const { minX, minY, maxX, maxY } = MAP.bounds
  const points: Array<readonly [number, number]> = []
  // by every fourth vertex of every road, on it and a few metres off it
  for (const road of whole.roads)
    for (let k = 0; k + 1 < road.pts.length; k += 8)
      for (const [dx, dy] of [
        [0, 0],
        [3.1, -4.2],
        [-9.7, 6.3],
      ] as const)
        points.push([road.pts[k]! + dx, road.pts[k + 1]! + dy])
  // along every seam, 4 m apart, on it and up to 39 m either side
  for (const d of [-39, -14, -0.05, 0, 0.05, 14, 39]) {
    for (let x = Math.ceil(minX / TILE) * TILE; x < maxX; x += TILE)
      for (let y = minY; y <= maxY; y += 4) points.push([x + d, y])
    for (let y = Math.ceil(minY / TILE) * TILE; y < maxY; y += TILE)
      for (let x = minX; x <= maxX; x += 4) points.push([x, y + d])
  }
  const names = new Set<string>()
  let wrong = 0
  for (const [x, y] of points) {
    const want = old(x, y)
    if (want !== undefined) names.add(want)
    if (locationAt(x, y).road !== want) wrong++
  }
  assert.equal(wrong, 0, `${wrong} of ${points.length} points`)
  assert.ok(names.size > 50, `${names.size} roads named`)
})
