import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../map/index.ts"
import { tileKey } from "../../map/kinds.ts"
import { readMapFile, tileUrl } from "../../map/packed.ts"
import { dropTile, provideTile, residentTiles, setTileSource } from "../../map/tiles.ts"
import { residentsNear } from "../density.ts"

// The check against one broad phase over the whole map is in density.map-test.ts (pnpm test:map);
// this one reads only the tiles round Monzone station.
const fromDisk = (key: string) => readMapFile(tileUrl(MAP.name, key))

/** Every tile out of memory, then the source back. */
const emptied = () => {
  for (const { i, j } of MAP.tiles) dropTile(tileKey(i, j))
  setTileSource(fromDisk)
}

/** Round Monzone station every 50 m, out to 600 m: over the x = 0 and y = 0 seams east and south of it. */
const POINTS = Array.from({ length: 25 * 25 }, (_, k) => [
  -493.8 + 50 * ((k % 25) - 12),
  436.9 + 50 * (Math.floor(k / 25) - 12),
])

test("the residents round a point add up to the same bits whatever tiles are in memory and in whichever order they came", () => {
  const sums = () => POINTS.map(([x, y]) => [45, 60, 140].map((r) => residentsNear(x!, y!, r)))
  emptied()
  const lazy = sums()
  const touched = residentTiles()
  // Just the tiles the sums read, handed over in key order and the other way round, with no source to read more.
  for (const order of [touched, [...touched].reverse()]) {
    emptied()
    for (const key of order) provideTile(fromDisk(key))
    setTileSource(undefined)
    assert.deepEqual(sums(), lazy)
  }
  setTileSource(fromDisk)
  assert.ok(touched.length >= 4, touched.join(" "))
  assert.ok(lazy.filter(([, , wide]) => wide! > 0).length > 300, "people live round the station")
})
