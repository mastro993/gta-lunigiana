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
import {
  checkArms,
  checkBed,
  checkCarriageways,
  checkDashes,
  checkPanelsOverRoads,
  checkPortals,
  checkReadingWidths,
  railwayNear,
} from "./rail-checks.ts"

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }
/**
 * The railway within 4 km of Monzone station: Monzone's, Gragnola's and Equi Terme's crossings,
 * and the tunnel mouths either side; rail.map-test.ts checks the whole map's.
 */
const HERE = railwayNear(STATION, 4000)
/** A chunk's side, m: the station's chunk's. */
const CHUNK = (({ minX, maxX }) => maxX - minX)(chunkRect(chunkOf(STATION.x, STATION.y)))

// rail.map-test.ts checks every chunk of the map.
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

test("rail, by Monzone station: nothing 3D stands in a crossing's carriageway (0.3 m in from its edges, which bend), and the ballast bed stops a metre short of it", () => {
  assert.ok(HERE.crossings.length >= 4, `${HERE.crossings.length} crossings`)
  checkCarriageways(HERE)
})

test("rail, by Monzone station: at each crossing the panel, its rails and the stop lines lie over the road ribbon drawn there", () => {
  checkPanelsOverRoads(HERE)
})

// Regression: a tertiary road's centre dashes lay as high as the panels, so they cut through them.
test("rail, by Monzone station: no road's centre dash lies under a crossing's panels", () => {
  checkDashes(HERE)
})

test("rail, by Monzone station: drawn at reading widths, a 0.6 m sleeper every 1.2 m and 0.24 m rails on the bed", () => {
  checkReadingWidths(HERE)
})

test("rail, by Monzone station: people walk over the bed: its top stands 0.15 m or less over the terrain on 90 % of the line at grade", () => {
  checkBed(HERE, 10_000)
})

test("rail, by Monzone station: a portal at every tunnel mouth, its dark mouth facing out of the hill", () => {
  checkPortals(HERE, 2)
})

test("crossings, by Monzone station: each arm hinged on its housing's face, the road light's black plate behind its lens, all clear of the trains", () => {
  checkArms(HERE, 2)
})
