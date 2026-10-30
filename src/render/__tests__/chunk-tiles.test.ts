import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { chunkTiles } from "../chunk-tiles.ts"
import { CHUNKS, chunkOf } from "../chunks.ts"
import { bucketPieces } from "../world.ts"
import { buildsWithSomeTiles } from "./some-tiles.ts"

// chunk-tiles.map-test.ts (pnpm test:map) checks every chunk and every spot of the map; these, a few.
const count = CHUNKS.x * CHUNKS.y
const empty = chunkTiles(
  [],
  Array.from({ length: count }, () => []),
)

// Regression (review of #5): the crossing test passed on road ribbons alone; a piece's own `reads` box must count.
test("chunk tiles: a piece that reads the ground across a seam far from what it draws makes its chunk read that tile", () => {
  // A 1 m piece mid-tile in 0_0, whose draw reads the ground up to 2100 m east: across the x = 2000 seam, in tile 1_0.
  const piece = {
    pts: [1000, 1000, 1001, 1000],
    draw: () => {},
    reads: [1000, 990, 2100, 1010] as const,
  }
  const tiles = chunkTiles([piece], bucketPieces([piece])),
    key = chunkOf(1000, 1000)
  assert.ok(
    !empty.needs[key]!.includes(tiles.index.get("1_0")!),
    "its square reaches no other tile",
  )
  assert.ok(tiles.needs[key]!.includes(tiles.index.get("1_0")!), "its reads box does")
})

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }
const near = ([x, y]: readonly [number, number]) => Math.hypot(x - STATION.x, y - STATION.y) < 1000

test("chunk tiles: with only some of the tiles in, every chunk that builds reads only those, by Monzone", () => {
  // The tile corner (0, 0) by Monzone, and the level crossing and platforms by its station.
  const spots: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    ...MAP.railway.crossings.map(({ x, y }) => [x, y] as const).filter(near),
    ...MAP.railway.platforms.map(({ axis }) => [axis[0]!, axis[1]!] as const).filter(near),
  ]
  assert.ok(spots.length >= 3, `${spots.length} spots`)
  const built = buildsWithSomeTiles(spots)
  assert.ok(built > 100, `${built} chunks built with some tiles out`)
})
