import assert from "node:assert/strict"
import { test } from "node:test"

import { Random } from "@typeonce/ritmo-math"

import { MAP } from "../../map/index.ts"
import { tileKey } from "../../map/kinds.ts"
import { readMapFile, tileUrl } from "../../map/packed.ts"
import { dropTile, provideTile, residentTiles, setTileSource } from "../../map/tiles.ts"
import {
  buildingsNear,
  farmBuilding,
  farmsNear,
  grazing,
  indoors,
  offWall,
  openGround,
  pasture,
} from "../farms.ts"

// The checks against one broad phase over the whole map are in farms.map-test.ts (pnpm test:map);
// these read only the tiles round Monzone station.
const fromDisk = (key: string) => readMapFile(tileUrl(MAP.name, key))

/** Every tile out of memory, then the source back. */
const emptied = () => {
  for (const { i, j } of MAP.tiles) dropTile(tileKey(i, j))
  setTileSource(fromDisk)
}

/** Round Monzone station every 25 m, out to 600 m: over the x = 0 and y = 0 seams east and south of it. */
const POINTS = Array.from({ length: 49 * 49 }, (_, k) => [
  -493.8 + 25 * ((k % 49) - 24),
  436.9 + 25 * (Math.floor(k / 49) - 24),
])

/** What the animal and people spawns read of the buildings at each point: the ground checks, the houses and farms by it, a spot off a wall of each. */
const answers = () =>
  POINTS.map(([x, y]) => {
    const houses = buildingsNear(x!, y!, 25),
      farms = farmsNear(x!, y!, 140).map(farmBuilding)
    return {
      ground: [indoors(x!, y!), openGround(x!, y!), grazing(x!, y!), pasture(x!, y!)],
      houses,
      farms,
      walls: [...houses, ...farms].map((b) => offWall(b, 1.5, Random.make(7))),
    }
  })

test("the ground checks, the buildings near a point, the farms' buildings and the spots off their walls are the same whatever tiles are in memory and in whichever order they came", () => {
  emptied()
  const lazy = answers()
  const touched = residentTiles()
  // Just the tiles the answers read, handed over in key order and the other way round, with no source to read more.
  for (const order of [touched, [...touched].reverse()]) {
    emptied()
    for (const key of order) provideTile(fromDisk(key))
    setTileSource(undefined)
    assert.deepEqual(answers(), lazy)
  }
  setTileSource(fromDisk)
  assert.ok(touched.length >= 4, touched.join(" "))
  const some = (pick: (a: (typeof lazy)[number]) => boolean) => lazy.filter(pick).length
  assert.ok(some((a) => a.ground[0]!) > 10, "indoors")
  assert.ok(some((a) => a.ground[3]!) > 10, "pasture")
  assert.ok(some((a) => a.houses.length > 1) > 100, "houses")
  assert.ok(some((a) => a.farms.length > 1) > 100, "farms")
})
