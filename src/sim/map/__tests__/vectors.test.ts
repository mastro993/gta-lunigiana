import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../index.ts"
import { TILE, tileKey } from "../kinds.ts"
import { readMapFile, tileUrl } from "../packed.ts"
import {
  dropTile,
  placeAt,
  provideTile,
  residentTiles,
  setTileSource,
  tilesOver,
} from "../tiles.ts"
import { buildingsIn, roadLine } from "../vectors.ts"

// The checks over every tile's vectors live in vectors.map-test.ts (pnpm test:map); these read only
// the tiles round Monzone station.
const fromDisk = (key: string) => readMapFile(tileUrl(MAP.name, key))
const KEYS = MAP.tiles.map(({ i, j }) => tileKey(i, j))

/** Every tile out of memory, then the source back. */
const emptied = () => {
  for (const key of KEYS) dropTile(key)
  setTileSource(fromDisk)
}

test("buildingsIn gives the same buildings, in the same order, whatever is in memory and in whichever order it came", () => {
  // Boxes across the x = 0 and y = 0 seams by Monzone station, round the tile corner (0, 0), and 300 m across it.
  const boxes = [
    [0, 30, 40],
    [-25, 0, 64],
    [0, 0, 150],
    [-400, 400, 120],
  ] as const
  const answer = () =>
    boxes.map(([x, y, r]) => {
      const found: Array<number> = []
      buildingsIn(x - r, y - r, x + r, y + r, (i) => found.push(i))
      return found
    })
  emptied()
  const lazy = answer()
  const touched = residentTiles()
  const around = [
    ...new Set(boxes.flatMap(([x, y]) => tilesOver(x - TILE, y - TILE, x + TILE, y + TILE))),
  ]
  for (const order of [around, [...around].reverse()]) {
    emptied()
    for (const key of order) provideTile(fromDisk(key))
    assert.deepEqual(answer(), lazy)
  }
  assert.ok(touched.length >= 4, touched.join(" "))
  assert.ok(lazy.every((found) => found.length > 0))
  // each building once, though the tiles round a seam all hold it
  for (const found of lazy) assert.equal(new Set(found).size, found.length)
})

test("a lookup at a point reads the vectors of the point's tile: a road's line there, and none far from it", () => {
  emptied()
  const place = placeAt(-414.4, 433.1)
  assert.deepEqual(residentTiles(), ["-1_0"])
  const k = place.vectors.roads.ids.find((id) => MAP.roads[id]!.name === "Via Cesare Battisti")!
  assert.deepEqual(roadLine(k, -414.4, 433.1), { pts: MAP.roads[k]!.pts, z: MAP.roads[k]!.z })
  assert.throws(
    () => roadLine(k, 4000, -5000),
    new RegExp(`map: road ${k} lies nowhere near \\(4000, -5000\\)`),
  )
  setTileSource(undefined)
  dropTile("1_-3")
  assert.throws(() => placeAt(3000, -5000), /map tile 1_-3 not loaded/)
  setTileSource(fromDisk)
})
