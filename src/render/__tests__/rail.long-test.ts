import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { setTileSource, tileFromDisk } from "../../sim/map/source.ts"
import { dropTile, tileVectors } from "../../sim/map/tiles.ts"
import { chunkTiles } from "../chunk-tiles.ts"
import { chunkOf, CHUNKS, chunkRect } from "../chunks.ts"
import { Pieces } from "../pieces.ts"
import { vectorsAround } from "../testing.ts"
import { assertChunkCut, wholeBuild } from "./chunk-cut.ts"

// rail.map-test.ts (pnpm test:map) checks every chunk of the map; this, the chunks by Monzone station (0.5 s alone).

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }
/** A chunk's side, m: the station's chunk's. */
const CHUNK = (({ minX, maxX }) => maxX - minX)(chunkRect(chunkOf(STATION.x, STATION.y)))

test("buildings, roads and rivers, rail, stations and lamps: a chunk by Monzone station built from the pieces of the tiles under it keeps exactly its cut of the whole build, whichever order the tiles come in", () => {
  // Across the x = 0 and y = 0 seams by the station, and the whole build of everything the tiles round it hold. The chunks count
  // from the box's corner, so where their squares fall moves as parts join: the box reaches a chunk's side past each seam, and so
  // holds the chunks across them wherever they fall.
  const box = { minX: -1000, minY: -CHUNK, maxX: CHUNK, maxY: 900 },
    plan = chunkTiles()
  const chunks = Array.from({ length: CHUNKS.x * CHUNKS.y }, (_, key) => key).filter((key) => {
    const r = chunkRect(key)
    return r.minX >= box.minX && r.maxX <= box.maxX && r.minY >= box.minY && r.maxY <= box.maxY
  })
  const whole = wholeBuild(vectorsAround([{ x: -500, y: 400 }], 600)),
    tiles = [...new Set(chunks.flatMap((key) => plan.terrain[key]!))]
  assert.equal(tiles.length, 4, "the four tiles round (0, 0)")
  // Each time from no tile in memory: a lookup reads what it needs from disk.
  for (const order of [tiles, tiles.toReversed()]) {
    for (const { i, j } of MAP.tiles) dropTile(`${i}_${j}`)
    setTileSource(tileFromDisk)
    const pieces = new Pieces(plan)
    for (const t of order) pieces.provide(t, tileVectors(plan.keys[t]!))
    const drawn = assertChunkCut(whole, pieces, chunks)
    // A share, not a count: the chunks count from the map's west edge, so which of them fit in the box moves as parts join
    // (since Sarzana's, 49 on the 4 tiles round (0, 0), 13 of them across a seam and 43 drawing some).
    assert.ok(drawn >= 0.8 * chunks.length, `${drawn} of ${chunks.length} chunks draw some`)
  }
})
