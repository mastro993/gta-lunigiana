import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { tileTrees } from "../../sim/map/tiles.ts"
import { chunkTiles } from "../chunk-tiles.ts"
import { APRON, CHUNKS, chunkOf } from "../chunks.ts"
import { bucketTileTrees, chunkTrees } from "../trees.ts"

test("trees: each chunk's from the tiles it reads are the whole map's bucket for it, apron mirrors and order included", () => {
  const count = CHUNKS.x * CHUNKS.y
  // The whole map's list, in its order, as the map held it before the tiles.
  const trees: Array<readonly [number, number, number, number]> = []
  for (const key of MAP.tiles.map(({ i, j }) => `${i}_${j}`)) {
    const { trees: flat, ids } = tileTrees(key)
    for (let k = 0; k < ids.length; k++)
      trees.push([flat[3 * k]!, flat[3 * k + 1]!, flat[3 * k + 2]!, ids[k]!])
  }
  trees.sort((a, b) => a[3] - b[3])
  assert.ok(
    trees.every(([, , , id], k) => id === k),
    "ids number the whole map's list",
  )
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
  const tiles = chunkTiles(
      [],
      Array.from({ length: count }, () => []),
    ),
    buckets = tiles.keys.map(bucketTileTrees)
  let mirrored = 0
  for (let key = 0; key < count; key++) {
    const got = chunkTrees(tiles.needs[key]!.map((t) => buckets[t]!.get(key)))
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
    if (expected.some((v, i) => i % 4 === 3 && v % 3 === 1)) mirrored++
  }
  assert.ok(mirrored > 100, `${mirrored} apron chunks hold mirrored trees`)
})
