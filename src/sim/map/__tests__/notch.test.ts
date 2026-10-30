// The map's lookups on Lunigiana with its north-east tiles unlisted and an L outline (`notchMap`):
// they read only listed tiles, and the play area is the L.
import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP_URL, readMapFile } from "../packed.ts"
import { AROUND, notchMap } from "./edit-map.ts"

notchMap()
const { heightAt, inPlay, MAP, outlineDistance, treesIn, wallsNear } = await import("../index.ts")
const { coverAt } = await import("../cover.ts")
const { terrainZ } = await import("../ground.ts")
const tiles = await import("../tiles.ts")

const { maxX, maxY } = MAP.bounds
/** Calls `visit` on points `step` m apart over the notch, its listed neighbours' near halves and 300 m past the bounds. */
const sweep = (step: number, visit: (x: number, y: number) => void) => {
  for (let x = 1000; x <= maxX + 300; x += step)
    for (let y = -1000; y <= maxY + 300; y += step) visit(x, y)
}

test("an L: the notch's tiles are off the list, and a lookup there reads the listed tiles round it", () => {
  assert.equal(MAP.tiles.length, 26)
  assert.ok(!tiles.isListed(1, 0) && !tiles.isListed(2, 1) && tiles.isListed(0, 0))
  assert.deepEqual(tiles.tilesOver(2500, 500, 2600, 600), AROUND)
  // the far corner of the notch has no listed neighbour: the next ring's
  assert.deepEqual(tiles.tilesOver(4800, 3800, 4800, 3800), AROUND)
  assert.deepEqual(tiles.tilesOver(1500, -500, 2500, 500), ["0_-1", "1_-1", "2_-1", "0_0", "0_1"])
  sweep(250, (x, y) => {
    for (const key of tiles.tilesOver(x, y, x + 400, y + 400)) {
      const [i, j] = key.split("_").map(Number)
      assert.ok(tiles.isListed(i!, j!), `${key} read at ${x}, ${y}`)
    }
  })
})

test("an L: the notch's ground and cover extend the nearest listed tile's edge, and nothing throws", () => {
  sweep(97, (x, y) => {
    assert.ok(Number.isFinite(heightAt(x, y)) && Number.isFinite(terrainZ(x, y)), `${x}, ${y}`)
    assert.equal(typeof coverAt(x, y), "string")
  })
  // 300 m east of the notch's west side (its south side lies 1500 m off), 300 m north of its south side
  assert.equal(heightAt(2301.7, 1500.3), heightAt(2000, 1500.3))
  assert.equal(heightAt(4000.2, 300), heightAt(4000.2, 0))
  assert.equal(terrainZ(2301.7, 1500.3), terrainZ(2000, 1500.3))
  assert.equal(coverAt(2301.7, 1500.3), coverAt(1999, 1500.3))
  assert.equal(coverAt(4000.2, 300), coverAt(4000.2, -1))
  // past the bounds' north-east corner, the notch's: its nearest listed node
  assert.equal(heightAt(6000, 5000), heightAt(2000, 3900))
})

test("an L: a lookup in the notch is resident once the listed tiles round it are", () => {
  for (const { i, j } of MAP.tiles) tiles.dropTile(`${i}_${j}`)
  assert.ok(!tiles.isResidentAt(3000, 1000))
  for (const key of AROUND) {
    assert.ok(!tiles.isResidentAt(3000, 1000))
    tiles.provideTile(readMapFile(new URL(`${MAP.name}/${key}.bin`, MAP_URL)))
  }
  assert.ok(tiles.isResidentAt(3000, 1000) && tiles.isResidentAt(1999, 1000))
  tiles.setTileSource(undefined)
  try {
    assert.ok(Number.isFinite(heightAt(3000, 1000)))
    assert.equal(typeof coverAt(4800, 3800), "string")
  } finally {
    tiles.setTileSource((key) => readMapFile(new URL(`${MAP.name}/${key}.bin`, MAP_URL)))
  }
})

// The cut keeps a wall or tree whose midpoint falls in an unlisted tile (an outline wall on the notch's side, a house wall
// over it) in a listed tile round it (src/tools/tile-map.ts): a lookup there must read them.
test("an L: a wall or tree lookup over the notch reads the listed tiles round it, as the host keeps them", () => {
  const read: Array<string> = []
  for (const { i, j } of MAP.tiles) tiles.dropTile(`${i}_${j}`)
  tiles.setTileSource((key) => {
    read.push(key)
    return readMapFile(new URL(`${MAP.name}/${key}.bin`, MAP_URL))
  })
  wallsNear("walk", 2500, 500, 2510, 510)
  assert.deepEqual(read, AROUND)
  assert.deepEqual(tiles.tilesOver(2500 - 49, 500 - 49, 2510 + 49, 510 + 49), AROUND)
  read.length = 0
  for (const key of AROUND) tiles.dropTile(key)
  treesIn(3000, 1000, 3010, 1010, () => {})
  assert.deepEqual(read, AROUND)
})

test("an L: the play area is the outline's, its edge in it", () => {
  assert.ok(inPlay(1500, 500) && inPlay(2000, 1000) && inPlay(3000, 0) && inPlay(4900, -6100))
  assert.ok(!inPlay(2500, 500) && !inPlay(2000.1, 1000) && !inPlay(4800, 3800))
  assert.ok(!inPlay(1995, 1000, 6) && inPlay(1995, 1000, 5))
  assert.equal(outlineDistance(1990, 1000), 10)
  assert.equal(outlineDistance(2300, 400), 300)
})
