// The check rail.test.ts (the pieces by Monzone) and rail.map-test.ts (every piece of the map) share: a chunk build keeps
// exactly its cut of the whole build.
import assert from "node:assert/strict"

import { chunkOf, chunkRect } from "../chunks.ts"
import { boxOver, type Piece, type Sink, Triangles, WaterTriangles } from "../geometry.ts"
import { bucketPieces } from "../world.ts"

const sink = (): Sink => ({
  solid: new Triangles(),
  decal: new Triangles(),
  water: new WaterTriangles(),
  glow: new Triangles(),
  pieces: [],
})

/** How far past its points a piece draws, m: a ribbon's mitred edge, a lamp's arm, a building's sills (with room to spare). */
const MARGIN = 100

/**
 * Asserts that each chunk wholly inside `box` (all of the map when none) builds from its bucket of `list` exactly the
 * triangles and extrusions a whole build of those pieces sends it, and that nothing lands in a chunk that does not
 * build it; with a box, only the pieces whose points come within `MARGIN` of it are drawn. Returns how many chunks it
 * compared.
 */
export const assertChunkCut = (
  list: ReadonlyArray<Piece>,
  box?: {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
  },
): number => {
  const near = (piece: Piece) => {
    if (box === undefined) return true
    const [minX, minY, maxX, maxY] = boxOver(piece.pts)
    return (
      maxX >= box.minX - MARGIN &&
      minX <= box.maxX + MARGIN &&
      maxY >= box.minY - MARGIN &&
      minY <= box.maxY + MARGIN
    )
  }
  const inside = (key: number) => {
    if (box === undefined) return true
    const r = chunkRect(key)
    return r.minX >= box.minX && r.maxX <= box.maxX && r.minY >= box.minY && r.maxY <= box.maxY
  }
  // The pieces drawn whole once, each triangle into the chunk `at` sends it to.
  const cut = new Map<number, Sink>()
  for (const piece of list.filter(near))
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
  const byChunk = bucketPieces(list)
  let built = 0
  for (const [key, entries] of byChunk.entries()) {
    if (entries.length === 0 || !inside(key)) continue
    const mine = sink(),
      elsewhere = sink()
    for (let n = 0; n < entries.length; n += 3)
      list[entries[n]!]!.draw(
        (x, y) => (chunkOf(x, y) === key ? mine : elsewhere),
        entries[n + 1]!,
        entries[n + 2]!,
      )
    const expected = cut.get(key) ?? sink()
    for (const layer of ["solid", "decal", "water", "glow"] as const) {
      assert.deepEqual(mine[layer].position, expected[layer].position, `chunk ${key} ${layer}`)
      assert.deepEqual(mine[layer].color, expected[layer].color, `chunk ${key} ${layer} colours`)
    }
    // A building's walls are an extrusion of its own.
    assert.deepEqual(
      mine.pieces.map((g) => g.getAttribute("position").array),
      expected.pieces.map((g) => g.getAttribute("position").array),
      `chunk ${key} extrusions`,
    )
    built++
  }
  assert.equal(
    [...cut.keys()].filter((key) => inside(key) && byChunk[key]!.length === 0).length,
    0,
    "nothing lands in a chunk that does not build it",
  )
  return built
}
