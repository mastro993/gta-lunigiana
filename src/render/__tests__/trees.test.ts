import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { tilesOver } from "../../sim/map/tiles.ts"
import { assertChunkTrees } from "./chunk-trees.ts"

// trees.map-test.ts (pnpm test:map) checks every tile and every chunk; this, the tiles round Monzone and on the west edge.
test("trees: each chunk's from the tiles it reads are the whole map's bucket for it, by Monzone and in the west edge's apron", () => {
  const { minX } = MAP.bounds
  const keys = [
    ...new Set([
      // The four tiles meeting at (0, 0), by Monzone.
      ...tilesOver(-1, -1, 1, 1),
      // The two meeting the west edge at y = 0, whose apron chunks hold the trees mirrored across it.
      ...tilesOver(minX, -1, minX, 1),
    ]),
  ]
  assert.equal(keys.length, 6, keys.join(" "))
  const { checked, mirrored } = assertChunkTrees(keys)
  assert.ok(checked > 500, `${checked} chunks hold trees`)
  assert.ok(mirrored > 30, `${mirrored} apron chunks hold mirrored trees`)
})
