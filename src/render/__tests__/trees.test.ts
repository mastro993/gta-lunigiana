import assert from "node:assert/strict"
import { test } from "node:test"

import { MeshBasicMaterial } from "three"

import { type Cover, coverAt } from "../../sim/map/cover.ts"
import { isWood, MAP, TILE } from "../../sim/map/index.ts"
import { tilesOver, tileTrees } from "../../sim/map/tiles.ts"
import { hash01 } from "../../tools/geometry.ts"
import { bucketTileTrees, kindAt, speciesAt, treeMeshes, type TreeKind } from "../trees.ts"
import { assertChunkTrees } from "./chunk-trees.ts"

// trees.map-test.ts (pnpm test:map) checks every tile and every chunk; this, the tiles round Monzone and on the west edge.
test("trees: each chunk's from the tiles it reads are the whole map's bucket for it, by Monzone and in the west edge's apron", () => {
  const { minX } = MAP.bounds
  const keys = [
    ...new Set([
      // The four tiles meeting at (0, 0), by Monzone.
      ...tilesOver(-1, -1, 1, 1),
      // The two meeting the west edge at y = 0, whose apron chunks hold the trees mirrored across it.
      ...tilesOver(minX, -1, minX, 1),
    ]),
  ]
  assert.equal(keys.length, 6, keys.join(" "))
  const { checked, mirrored } = assertChunkTrees(keys)
  assert.ok(checked > 500, `${checked} chunks hold trees`)
  assert.ok(mirrored > 30, `${mirrored} apron chunks hold mirrored trees`)
})

/** The share of `N` evenly spread draws of `speciesAt` on `cover` at `z` and `northness` that come out `kind`. */
const N = 2000
const shareOf = (kind: TreeKind, cover: Cover, z: number, northness: number): number => {
  let n = 0
  for (let k = 0; k < N; k++) if (speciesAt(cover, z, northness, (k + 0.5) / N) === kind) n++
  return n / N
}
const FACES = [-1, -0.5, 0, 0.5, 1]

test("speciesAt: in the broadleaf woods the beech's share rises with the height, under 5% below 700 m and over 85% above 1250 m", () => {
  for (const northness of FACES) {
    let before = -1
    for (let z = 0; z <= 1800; z += 50) {
      const beech = shareOf("beech", "forest", z, northness)
      assert.ok(beech >= before, `${z} m, northness ${northness}: ${beech} after ${before}`)
      before = beech
      if (z <= 700) assert.ok(beech < 0.05, `${z} m, northness ${northness}: ${beech}`)
      if (z >= 1250) assert.ok(beech > 0.85, `${z} m, northness ${northness}: ${beech}`)
    }
  }
  // The belt starts lower on a north face.
  assert.ok(shareOf("beech", "forest", 900, 1) > 1.5 * shareOf("beech", "forest", 900, -1))
})

test("speciesAt: a conifer wood is conifers, pines below 600 m; a mixed wood 45% of them; a tree out of the woods a broadleaf", () => {
  assert.equal(shareOf("conifer", "conifer", 1000, 0), 1)
  assert.equal(shareOf("pine", "conifer", 300, 0), 1)
  assert.ok(Math.abs(shareOf("conifer", "mixed", 700, 0) - 0.45) < 0.02)
  assert.ok(Math.abs(shareOf("pine", "mixed", 300, 0) - 0.45) < 0.02)
  for (const cover of ["meadow", "pebble", "grassland"] as const)
    for (const z of [100, 900, 1500]) assert.equal(shareOf("broadleaf", cover, z, -1), 1)
})

test("speciesAt: oaks most on south faces and none above 1200 m, pines among the broadleaf only below 300 m, scattered conifers most in the plantations' belt", () => {
  assert.ok(shareOf("oak", "forest", 200, -1) > 1.5 * shareOf("oak", "forest", 200, 1))
  assert.ok(shareOf("oak", "forest", 200, -1) > shareOf("oak", "forest", 600, -1))
  assert.ok(shareOf("oak", "forest", 900, -1) > 1.5 * shareOf("oak", "forest", 900, 1))
  assert.equal(shareOf("oak", "forest", 1250, -1), 0)
  assert.ok(Math.abs(shareOf("pine", "forest", 200, 0) - 0.1 * (1 - 0.03)) < 0.01)
  assert.equal(shareOf("pine", "forest", 400, 0), 0)
  assert.ok(shareOf("conifer", "forest", 900, 0) > 1.5 * shareOf("conifer", "forest", 500, 0))
})

test("treeMeshes: a chunk draws each tree as its kind (kindAt), and a tree mirrored into the apron as the tree", () => {
  const { minX } = MAP.bounds
  const material = new MeshBasicMaterial()
  // The west edge's tile at y = 0, and the chunks holding its trees and their mirrors past the edge.
  const [key] = tilesOver(minX, 1, minX, 1)
  let mirrors = 0
  for (const trees of bucketTileTrees(key!).values()) {
    const kinds: Array<TreeKind> = []
    for (let n = 0; n < trees.length; n += 4) {
      const seed = trees[n + 3]!,
        mirror = seed % 3 === 1
      if (mirror) mirrors++
      kinds.push(
        kindAt(mirror ? 2 * minX - trees[n]! : trees[n]!, trees[n + 1]!, seed - (seed % 3)),
      )
    }
    const drawn = treeMeshes(trees, material),
      expected = treeMeshes(trees, material, undefined, kinds)
    const look = (meshes: typeof drawn) =>
      meshes.map((m) => [
        m.geometry.uuid,
        m.count,
        Array.from(m.instanceMatrix.array),
        Array.from(m.instanceColor!.array),
      ])
    assert.deepEqual(look(drawn), look(expected))
    assert.equal(
      drawn.reduce((n, m) => n + m.count, 0),
      trees.length / 4,
    )
  }
  assert.ok(mirrors > 100, `${mirrors} mirrors`)
})

test("kindAt: a tree's species takes its height and aspect from its tile's 20 m squares, ground falling north facing north", () => {
  // The first tree of a wood in the tile north-east of (0, 0), by Monzone, on planes through 900 m.
  const [key] = tilesOver(1, 1, 1, 1)
  const { trees, ids } = tileTrees(key!)
  let k = 0
  while (!isWood(coverAt(trees[3 * k]!, trees[3 * k + 1]!))) k++
  const x = trees[3 * k]!,
    y = trees[3 * k + 1]!,
    cover = coverAt(x, y)
  // Along the tile from its south-west corner, in kindAt's 20 m squares.
  const fx = (x - TILE * Math.floor(x / TILE)) / 20,
    fy = (y - TILE * Math.floor(y / TILE)) / 20
  const planes = [
    {
      name: "falling north",
      height: (_i: number, _j: number, _a: number, b: number) => 900 - 10 * b,
      northness: 1,
      z: 900 - 10 * fy,
    },
    {
      name: "falling south",
      height: (_i: number, _j: number, _a: number, b: number) => 900 + 10 * b,
      northness: -1,
      z: 900 + 10 * fy,
    },
    {
      name: "falling east",
      height: (_i: number, _j: number, a: number) => 900 - 10 * a,
      northness: 0,
      z: 900 - 10 * fx,
    },
    { name: "flat", height: () => 900, northness: 0, z: 900 },
  ]
  const drawn = planes.map(({ name, height, northness, z }) =>
    Array.from({ length: 400 }, (_, n) => {
      const seed = 3 * (ids[k]! + n),
        kind = kindAt(x, y, seed, height)
      assert.equal(kind, speciesAt(cover, z, northness, hash01(seed, 11)), `${name}, seed ${seed}`)
      return kind
    }),
  )
  assert.notDeepEqual(drawn[0], drawn[1], "the faces draw apart")
})
