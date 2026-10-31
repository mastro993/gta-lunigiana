import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeMap } from "../../../tools/map-file.ts"
import { MAP } from "../../map/index.ts"
import { place, placeFrom } from "../place.ts"

// Map check (pnpm test:map): the place fitted again over every node of the map.
test("place: the sky's place is the one fitted over the whole heightmap, its floor the 5th-percentile height", () => {
  const { heightmap } = wholeMap()
  const where = place()
  assert.deepEqual(where, placeFrom(MAP.origin, heightmap))
  const heights = Array.from(heightmap.data, (z) => z / 10).sort((a, b) => a - b)
  assert.equal(where.floor, heights[Math.floor(0.05 * (heights.length - 1))])
})
