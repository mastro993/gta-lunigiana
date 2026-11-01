// The check trees.test.ts (the tiles by Monzone and on the west edge) and trees.map-test.ts (every
// tile) share: each chunk's trees, read from the tiles it reads, are the whole map's bucket for it.
import assert from "node:assert/strict"

import { MAP } from "../../sim/map/index.ts"
import { tileTrees } from "../../sim/map/tiles.ts"
import { chunkTiles } from "../chunk-tiles.ts"
import { APRON, CHUNKS, chunkOf } from "../chunks.ts"
import { bucketTileTrees, chunkTrees } from "../trees.ts"

/**
 * Asserts that every chunk reading only tiles of `keys` gets, from them, the trees standing in it
 * and those mirrored into it past the edges they stand within the apron of, each kind in seed
 * order and both together the bucket a whole-map list of those tiles' trees gives it; returns how
 * many such chunks hold trees and how many of them mirrored ones.
 */
export const assertChunkTrees = (
  keys: ReadonlyArray<string>,
): { readonly checked: number; readonly mirrored: number } => {
  const count = CHUNKS.x * CHUNKS.y
  // The tiles' trees in the whole map's order (their ids), as the map held them before the tiles.
  const trees: Array<readonly [number, number, number, number]> = []
  for (const key of keys) {
    const { trees: flat, ids } = tileTrees(key)
    for (let k = 0; k < ids.length; k++)
      trees.push([flat[3 * k]!, flat[3 * k + 1]!, flat[3 * k + 2]!, ids[k]!])
  }
  trees.sort((a, b) => a[3] - b[3])
  // Every tree, and its mirrors past the edges it stands within the apron of, bucketed by chunk in that order.
  const { minX, minY, maxX, maxY } = MAP.bounds,
    reach = APRON * MAP.heightmap.cell
  const whole = new Map<number, Array<number>>()
  const put = (x: number, y: number, scale: number, seed: number) => {
    const key = chunkOf(x, y)
    let list = whole.get(key)
    if (list === undefined) whole.set(key, (list = []))
    list.push(x, y, scale, seed)
  }
  for (const [x, y, scale, id] of trees) {
    put(x, y, scale, 3 * id)
    const xs = [
      x,
      ...(x - minX < reach ? [2 * minX - x] : []),
      ...(maxX - x < reach ? [2 * maxX - x] : []),
    ]
    const ys = [
      y,
      ...(y - minY < reach ? [2 * minY - y] : []),
      ...(maxY - y < reach ? [2 * maxY - y] : []),
    ]
    for (const mx of xs)
      for (const my of ys) if (mx !== x || my !== y) put(mx, my, scale, 3 * id + 1)
  }
  const tiles = chunkTiles(),
    given = new Set(keys.map((key) => tiles.index.get(key)!)),
    buckets = new Map([...given].map((t) => [t, bucketTileTrees(tiles.keys[t]!)]))
  let checked = 0,
    mirrored = 0
  for (let key = 0; key < count; key++) {
    if (!tiles.base[key]!.every((t) => given.has(t))) continue
    const got = chunkTrees(tiles.base[key]!.map((t) => buckets.get(t)!.get(key)))
    const expected = whole.get(key) ?? []
    if (got === undefined) {
      assert.equal(expected.length, 0, `chunk ${key} has trees`)
      continue
    }
    // Each kind in seed order, the two together the whole map's bucket.
    const quads = [got.broadleaf, got.conifer].flatMap((list) =>
      Array.from({ length: list.length / 4 }, (_, i) =>
        Array.from({ length: 4 }, (_, n) => list[4 * i + n]!),
      ),
    )
    for (const list of [got.broadleaf, got.conifer])
      for (let i = 4; i < list.length; i += 4)
        assert.ok(list[i + 3]! >= list[i - 1]!, `chunk ${key} in seed order`)
    assert.deepEqual(quads.sort((a, b) => a[3]! - b[3]!).flat(), expected, `chunk ${key}`)
    checked++
    if (expected.some((v, i) => i % 4 === 3 && v % 3 === 1)) mirrored++
  }
  return { checked, mirrored }
}
