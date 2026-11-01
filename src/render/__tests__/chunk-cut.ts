// The check rail.test.ts (the chunks by Monzone station) and rail.map-test.ts (every chunk of the map) share: a chunk
// built from the pieces of the map tiles under it keeps exactly its cut of the whole-map build.
import assert from "node:assert/strict"

import { MAP } from "../../sim/map/index.ts"
import { buildingPiece } from "../buildings.ts"
import { chunkRect, chunkOf } from "../chunks.ts"
import { boxOver, type Piece, type Sink, Triangles, WaterTriangles } from "../geometry.ts"
import { roadPieces, waterPiece } from "../lines.ts"
import type { Pieces } from "../pieces.ts"
import { railPieces } from "../rail.ts"
import { lampPieces } from "../sky/lamps.ts"
import { stationPieces } from "../stations.ts"
import { type Vectors, vectorsAround } from "../testing.ts"

const sink = (): Sink => ({
  solid: new Triangles(),
  decal: new Triangles(),
  water: new WaterTriangles(),
  glow: new Triangles(),
  pieces: [],
})

/** Every road, building and river of the map, joined from every tile (map tests only), each by its index. */
export const wholeVectors = (): Vectors => {
  const { minX, minY, maxX, maxY } = MAP.bounds,
    vectors = vectorsAround(
      [{ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }],
      Math.max(maxX - minX, maxY - minY),
    )
  for (const layer of ["roads", "buildings", "water"] as const)
    assert.equal(vectors[layer].ids.length, MAP.vectors.counts[layer], `every one of the ${layer}`)
  return vectors
}

/** The road and river pieces of `vectors`, in draw order. */
export const linesOf = ({ roads, water }: Vectors): Array<Piece> => [
  ...roads.items.flatMap(roadPieces),
  ...water.items.map(waterPiece),
]

/**
 * Every piece of `vectors` (all of the map's, or all of them round a spot) in the whole map's draw order, as a whole-map
 * build makes them: the buildings, each road's ribbons and deck, the rivers, then the railway (its crossings laid over
 * every road ribbon of `vectors`), the stations and the lamps.
 */
export const wholeBuild = (vectors: Vectors): Array<Piece> => {
  const lines = linesOf(vectors)
  return [
    ...vectors.buildings.items.map(buildingPiece),
    ...lines,
    ...railPieces(() => lines),
    ...stationPieces(),
    ...lampPieces(),
  ]
}

/** How far past its points a piece draws, m: a ribbon's mitred edge, a lamp's arm, a building's sills (with room to spare). */
const MARGIN = 100

/**
 * Asserts that each chunk of `chunks` draws from the pieces of the tiles under it (`pieces`, which must hold them)
 * exactly the triangles and extrusions, in the same order, that a whole build of `whole` (`wholeBuild`) sends it, and
 * nothing where the whole build sends nothing; only the pieces of `whole` whose points come within `MARGIN` of the chunks
 * are drawn. Returns how many of the chunks draw something.
 */
export const assertChunkCut = (
  whole: ReadonlyArray<Piece>,
  pieces: Pieces,
  chunks: ReadonlyArray<number>,
): number => {
  const rects = chunks.map(chunkRect),
    minX = Math.min(...rects.map((r) => r.minX)),
    minY = Math.min(...rects.map((r) => r.minY)),
    maxX = Math.max(...rects.map((r) => r.maxX)),
    maxY = Math.max(...rects.map((r) => r.maxY))
  const near = (piece: Piece) => {
    const [x0, y0, x1, y1] = boxOver(piece.pts)
    return x1 >= minX - MARGIN && x0 <= maxX + MARGIN && y1 >= minY - MARGIN && y0 <= maxY + MARGIN
  }
  // The pieces drawn whole once, each triangle into the chunk `at` sends it to.
  const cut = new Map<number, Sink>()
  for (const piece of whole.filter(near))
    piece.draw(
      (x, y) => {
        const key = chunkOf(x, y)
        let s = cut.get(key)
        if (s === undefined) cut.set(key, (s = sink()))
        return s
      },
      0,
      Math.max(0, piece.pts.length / 2 - 2),
    )
  let drawn = 0
  for (const key of chunks) {
    const entries = pieces.entries(key),
      mine = sink(),
      elsewhere = sink()
    for (let n = 0; n < entries.length; n += 3)
      pieces
        .piece(entries[n]!)
        .draw(
          (x, y) => (chunkOf(x, y) === key ? mine : elsewhere),
          entries[n + 1]!,
          entries[n + 2]!,
        )
    const expected = cut.get(key) ?? sink()
    for (const layer of ["solid", "decal", "water", "glow"] as const) {
      assert.deepEqual(mine[layer].position, expected[layer].position, `chunk ${key} ${layer}`)
      assert.deepEqual(mine[layer].color, expected[layer].color, `chunk ${key} ${layer} colours`)
    }
    assert.deepEqual(mine.water.stage, expected.water.stage, `chunk ${key} stage`)
    assert.deepEqual(mine.water.flow, expected.water.flow, `chunk ${key} flow`)
    // A building's walls are an extrusion of its own.
    assert.deepEqual(
      mine.pieces.map((g) => g.getAttribute("position").array),
      expected.pieces.map((g) => g.getAttribute("position").array),
      `chunk ${key} extrusions`,
    )
    if (entries.length > 0) drawn++
  }
  return drawn
}
