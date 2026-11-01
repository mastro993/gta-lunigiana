import assert from "node:assert/strict"
import { test } from "node:test"

import { TILE } from "../../sim/map/index.ts"
import { chunkTiles } from "../chunk-tiles.ts"
import { CHUNKS, chunkOf, chunkRect } from "../chunks.ts"
import type { Piece } from "../geometry.ts"
import { bucketPieces } from "../pieces.ts"
import { checkPlan } from "./chunk-tile-checks.ts"

// chunk-tiles.map-test.ts (pnpm test:map) checks every tile, chunk and spot of the map; these, the
// tiles and spots round Monzone.
const plan = chunkTiles()
/** The tiles chunk `key` reads drawing its part of `piece` alone. */
const needsWith = (key: number, piece: Piece) =>
  plan.needs(key, bucketPieces([piece])[key]!, () => piece)

test("chunk tiles: a chunk's base holds its terrain's tiles; one tile plans each chunk, its box round the chunk's, in the four tiles round (0, 0) by Monzone", () => {
  const tiles = ["-1_-1", "0_-1", "-1_0", "0_0"].map((key) => plan.index.get(key)!),
    lo = chunkOf(-TILE, -TILE),
    hi = chunkOf(TILE, TILE),
    chunks: Array<number> = []
  // the chunks whose middle the four tiles hold
  for (let cy = Math.floor(lo / CHUNKS.x); cy <= Math.floor(hi / CHUNKS.x); cy++)
    for (let cx = lo % CHUNKS.x; cx <= hi % CHUNKS.x; cx++) {
      const key = cy * CHUNKS.x + cx,
        { minX, minY, maxX, maxY } = chunkRect(key)
      if (Math.abs(minX + maxX) / 2 < TILE && Math.abs(minY + maxY) / 2 < TILE) chunks.push(key)
    }
  assert.ok(chunks.length > 900, `${chunks.length} chunks`)
  checkPlan(plan, tiles, chunks)
})

test("chunk tiles: a chunk's build reads the ground round the segments it draws, past its square and across a seam", () => {
  // A road from mid-tile in 0_0 to 10 m short of the x = 2000 seam: its ribbon's edge lies in tile 1_0.
  const piece = { pts: [1500, 1000, 1990, 1000], draw: () => {} }
  const key = chunkOf(1500, 1000),
    east = plan.index.get("1_0")!
  assert.ok(!plan.base[key]!.includes(east), "its square reaches no other tile")
  assert.ok(needsWith(key, piece).includes(east), "the road's does")
})

// Regression (review of #5): the crossing test passed on road ribbons alone; a piece's own `reads` box must count.
test("chunk tiles: a piece that reads the ground across a seam far from what it draws makes its chunk read that tile", () => {
  // A 1 m piece mid-tile in 0_0, whose draw reads the ground up to 2100 m east: across the x = 2000 seam, in tile 1_0.
  const piece = {
    pts: [1000, 1000, 1001, 1000],
    draw: () => {},
    reads: [1000, 990, 2100, 1010] as const,
  }
  const key = chunkOf(1000, 1000),
    east = plan.index.get("1_0")!
  assert.ok(!plan.base[key]!.includes(east), "its square reaches no other tile")
  assert.ok(needsWith(key, piece).includes(east), "its reads box does")
})
