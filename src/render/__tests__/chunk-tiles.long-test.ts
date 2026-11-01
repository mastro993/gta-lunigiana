import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { buildsWithSomeTiles } from "./chunk-tile-checks.ts"

// chunk-tiles.map-test.ts (pnpm test:map) checks every tile, chunk and spot of the map; these, the
// tiles and spots round Monzone.

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }
const near = ([x, y]: readonly [number, number]) => Math.hypot(x - STATION.x, y - STATION.y) < 1000

test("chunk tiles: with only some of the tiles in, every chunk that builds reads only those and builds as with every tile in, by Monzone", () => {
  // The tile corner (0, 0) by Monzone, the x = 0 seam east of its station, and the level crossing and platforms by it.
  const spots: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [0, STATION.y],
    ...MAP.railway.crossings.map(({ x, y }) => [x, y] as const).filter(near),
    ...MAP.railway.platforms.map(({ axis }) => [axis[0]!, axis[1]!] as const).filter(near),
  ]
  assert.ok(spots.length >= 3, `${spots.length} spots`)
  const built = buildsWithSomeTiles(spots)
  assert.ok(built > 100, `${built} chunks built with some tiles out`)
})
