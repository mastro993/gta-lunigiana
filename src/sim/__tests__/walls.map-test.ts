import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeMap } from "../../tools/map-file.ts"
import { assertTrunkCorners } from "./trunk-corners.ts"

// Map checks (pnpm test:map): every tree of the map; walls.test.ts checks those by Monzone.
test("wallsNear: a box touching only the corner of a tree's trunk square returns its four edges, across tile seams too, all over the map", () => {
  const { trees } = wholeMap()
  assert.ok(trees.length / 3 > 1000, `${trees.length / 3} trees`)
  const onSeams = assertTrunkCorners(trees)
  assert.ok(onSeams > 100, `${onSeams} trees on the seams`)
})
