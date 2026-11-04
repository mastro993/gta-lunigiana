import assert from "node:assert/strict"
import { test } from "node:test"

import { listedNodes } from "../../../tools/grid-tiles.ts"
import { wholeMap } from "../../../tools/map-file.ts"
import { MAP } from "../../map/index.ts"
import { place, placeFrom } from "../place.ts"

// Map check (pnpm test:map): the place fitted again over every node of the map's listed tiles.
test("place: the sky's place is the one fitted over the listed tiles' heightmap, its floor the 5th-percentile height", () => {
  const { heightmap } = wholeMap()
  const listed = listedNodes(heightmap, MAP.tiles)
  const where = place()
  assert.deepEqual(where, placeFrom(MAP.origin, heightmap, listed))
  const heights = Array.from(heightmap.data, (z) => z / 10)
    .filter((_, k) => listed[k] === 1)
    .sort((a, b) => a - b)
  assert.equal(where.floor, heights[Math.floor(0.05 * (heights.length - 1))])
})
