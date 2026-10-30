import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { tileTrees } from "../../sim/map/tiles.ts"
import { assertChunkTrees } from "./chunk-trees.ts"

// Map checks (pnpm test:map): every tile's trees and every chunk; trees.test.ts checks a few tiles.
const KEYS = MAP.tiles.map(({ i, j }) => `${i}_${j}`)

test("trees: the tiles' ids number the whole map's list", () => {
  const ids = KEYS.flatMap((key) => Array.from(tileTrees(key).ids)).sort((a, b) => a - b)
  assert.ok(
    ids.every((id, k) => id === k),
    "ids number the whole map's list",
  )
})

test("trees: each chunk's from the tiles it reads are the whole map's bucket for it, apron mirrors and order included", () => {
  const { checked, mirrored } = assertChunkTrees(KEYS)
  assert.ok(checked > 1000, `${checked} chunks hold trees`)
  assert.ok(mirrored > 100, `${mirrored} apron chunks hold mirrored trees`)
})
