// The check walls.test.ts (the trees of the tiles by Monzone) and walls.map-test.ts (every tree of
// the map) share: trees are indexed as points and their trunk squares made on query, and the broad
// phase must still return them.
import assert from "node:assert/strict"

import { wallsNear } from "../map/index.ts"
import { pushTrunk, TILE } from "../map/kinds.ts"

/**
 * Asserts, for every tenth of `trees` (flat x, y, scale triples) and every one within a metre of a
 * tile seam, that a box touching only a corner of its trunk square returns the square's four edges;
 * returns how many trees on a seam it checked.
 */
export const assertTrunkCorners = (trees: ArrayLike<number>): number => {
  const count = trees.length / 3,
    square: Array<number> = []
  pushTrunk(square, 0, 0)
  const reach = Math.max(...square)
  // Every tenth tree (hundreds of them have a corner box in a grid cell the tree is not in), and every tree within a metre
  // of a tile seam, whose corner box lies in the next tile.
  const seam = (v: number) => Math.abs(v - TILE * Math.round(v / TILE)) <= 1
  let onSeams = 0
  for (let i = 0; i < count; i++) {
    const x = trees[3 * i]!,
      y = trees[3 * i + 1]!
    if (seam(x) || seam(y)) onSeams++
    else if (i % 10 !== 0) continue
    square.length = 0
    pushTrunk(square, x, y)
    for (const [minX, minY, maxX, maxY] of [
      [x + reach, y + reach, x + reach + 0.5, y + reach + 0.5],
      [x - reach - 0.5, y - reach - 0.5, x - reach, y - reach],
    ] as const) {
      for (const kind of ["walk", "drive"] as const) {
        let edges = 0 // one bit per edge of the square
        for (const s of wallsNear(kind, minX, minY, maxX, maxY)) {
          for (let k = 0; k < 16; k += 4)
            if (
              s.ax === square[k] &&
              s.ay === square[k + 1] &&
              s.bx === square[k + 2] &&
              s.by === square[k + 3]
            )
              edges |= 1 << (k / 4)
        }
        assert.equal(edges, 0b1111, `${kind}: tree ${i} at ${x},${y}`)
      }
    }
  }
  return onSeams
}
