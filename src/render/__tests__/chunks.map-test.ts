import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { tileKey } from "../../sim/map/kinds.ts"
import { tilesOver } from "../../sim/map/tiles.ts"
import { boundBox, CHUNKS, chunkRect, exactBox } from "../chunks.ts"

// Map check (pnpm test:map): every chunk of the map; chunks.test.ts checks those of the four tiles by Monzone.
test("chunk boxes: the one from the tiles' lowest and highest nodes holds the exact one, for every chunk", () => {
  const count = CHUNKS.x * CHUNKS.y,
    tiles = new Map(MAP.tiles.map((tile) => [tileKey(tile.i, tile.j), tile]))
  const exact = new Float32Array(count * 6),
    bound = new Float32Array(count * 6)
  for (let key = 0; key < count; key++) {
    const { minX, minY, maxX, maxY } = chunkRect(key)
    exactBox(exact, key)
    boundBox(
      bound,
      key,
      tilesOver(minX, minY, maxX, maxY).map((k) => tiles.get(k)!),
    )
    for (let k = 0; k < 4; k++) assert.equal(bound[key * 6 + k], exact[key * 6 + k])
    assert.ok(bound[key * 6 + 4]! <= exact[key * 6 + 4]!, `chunk ${key} low`)
    assert.ok(bound[key * 6 + 5]! >= exact[key * 6 + 5]!, `chunk ${key} high`)
  }
})
