import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { chunkTiles } from "../chunk-tiles.ts"
import { CHUNKS } from "../chunks.ts"
import { linePieces } from "../lines.ts"
import { railPieces } from "../rail.ts"
import { stationPieces } from "../stations.ts"
import { bucketPieces } from "../world.ts"
import { buildsWithSomeTiles, checkPlan } from "./chunk-tile-checks.ts"

// Map checks (pnpm test:map): every chunk and every spot of the map where a chunk's build reads
// past its square; chunk-tiles.test.ts checks a few near Monzone.
const count = CHUNKS.x * CHUNKS.y
const empty = chunkTiles(
  [],
  Array.from({ length: count }, () => []),
)

test("chunk tiles: a chunk's build reads its terrain's tiles; one tile plans each chunk, its box round the chunk's", () => {
  checkPlan(
    empty,
    empty.keys.map((_, t) => t),
    Array.from({ length: count }, (_, key) => key),
  )
})

test("chunk tiles: a crossing's chunk reads the ground under the road ribbons it lies over", () => {
  const lines = linePieces(),
    pieces = [...lines, ...railPieces(lines), ...stationPieces()],
    tiles = chunkTiles(pieces, bucketPieces(pieces))
  for (let key = 0; key < count; key++)
    for (const t of empty.needs[key]!) assert.ok(tiles.needs[key]!.includes(t))
  assert.ok(
    tiles.needs.some((needs, key) => needs.length > empty.needs[key]!.length),
    "some chunk reads past its square",
  )
})

/** Map points round which a chunk's build reads past its square or across a tile seam. */
const SPOTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  ...MAP.railway.crossings.map(({ x, y }) => [x, y] as const),
  ...MAP.railway.platforms.map(({ axis }) => [axis[0]!, axis[1]!] as const),
  ...MAP.rail.flatMap((rail) =>
    rail.tunnel === true ? [[rail.pts[0]!, rail.pts[1]!] as const] : [],
  ),
  [MAP.bounds.minX, MAP.bounds.minY],
  [MAP.bounds.maxX, MAP.bounds.maxY],
  [MAP.bounds.minX, 0],
  [0, MAP.bounds.maxY],
]

test("chunk tiles: with only some of the tiles in, every chunk that builds reads only those, at every crossing, platform, tunnel mouth and corner", () => {
  const built = buildsWithSomeTiles(SPOTS)
  assert.ok(built > 100, `${built} chunks built with some tiles out`)
})
