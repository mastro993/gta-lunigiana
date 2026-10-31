import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { tileVectors } from "../../sim/map/tiles.ts"
import { chunkTiles } from "../chunk-tiles.ts"
import { CHUNKS } from "../chunks.ts"
import { Pieces } from "../pieces.ts"
import { buildsWithSomeTiles, checkPlan } from "./chunk-tile-checks.ts"

// Map checks (pnpm test:map): every chunk and every spot of the map where a chunk's build reads
// past its square; chunk-tiles.test.ts checks a few near Monzone.
const count = CHUNKS.x * CHUNKS.y
const plan = chunkTiles()

test("chunk tiles: a chunk's base holds its terrain's tiles; one tile plans each chunk, its box round the chunk's", () => {
  checkPlan(
    plan,
    plan.keys.map((_, t) => t),
    Array.from({ length: count }, (_, key) => key),
  )
})

test("chunk tiles: a chunk's build reads its base, and a crossing's chunk the ground under the road ribbons it lies over", () => {
  const pieces = new Pieces(plan)
  for (const [t, key] of plan.keys.entries()) pieces.provide(t, tileVectors(key))
  let past = 0
  for (let key = 0; key < count; key++) {
    const entries = pieces.entries(key),
      needs = plan.needs(key, entries, (n) => pieces.piece(entries[n]!))
    for (const t of plan.base[key]!) assert.ok(needs.includes(t))
    if (needs.length > plan.base[key]!.length) past++
  }
  assert.ok(past > 0, "some chunk reads past its square")
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

test("chunk tiles: with only some of the tiles in, every chunk that builds reads only those and builds as with every tile in, at every crossing, platform, tunnel mouth and corner", () => {
  const built = buildsWithSomeTiles(SPOTS)
  assert.ok(built > 100, `${built} chunks built with some tiles out`)
})
