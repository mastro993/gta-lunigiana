import assert from "node:assert/strict"
import { test } from "node:test"

import { waterAt, waterUnder } from "../../water/rivers.ts"
import { atGrade, deckNear, drawnZ, footZ, groundZ, roadLevel, terrainZ } from "../ground.ts"
import { MAP } from "../index.ts"
import { HALO, tileKey } from "../kinds.ts"
import { readMapFile, tileUrl } from "../packed.ts"
import { surfaceAt } from "../surface.ts"
import { dropTile, placeAt, provideTile, residentTiles, setTileSource } from "../tiles.ts"

// ground.map-test.ts checks these lookups against the whole map's broad phases over every tile;
// this reads only the tiles round Monzone station, whose corner (0, 0) lies 650 m east of it.
const fromDisk = (key: string) => readMapFile(tileUrl(MAP.name, key))
const KEYS = MAP.tiles.map(({ i, j }) => tileKey(i, j))
const STATION = { x: -493.8, y: 436.9 }

/** Every tile out of memory, then the source back. */
const emptied = () => {
  for (const key of KEYS) dropTile(key)
  setTileSource(fromDisk)
}

/** Points every 3.7 m over the station and out across the x = 0 and y = 0 seams, and on every road and river vertex of the tiles there. */
const POINTS = (() => {
  const out: Array<readonly [number, number, number?]> = []
  for (let x = STATION.x - 60; x <= 60; x += 3.7)
    for (let y = -60; y <= STATION.y + 60; y += 3.7) out.push([x, y])
  const inBox = (x: number, y: number) => x >= -560 && x <= 60 && y >= -60 && y <= 500
  for (const [x, y] of [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ] as const) {
    const { roads, water } = placeAt(x, y).vectors
    roads.items.forEach(({ pts }, n) => {
      for (let k = 0; k + 1 < pts.length; k += 2)
        if (inBox(pts[k]!, pts[k + 1]!)) out.push([pts[k]!, pts[k + 1]!, roads.ids[n]!])
    })
    for (const { pts } of water.items)
      for (let k = 0; k + 1 < pts.length; k += 2)
        if (inBox(pts[k]!, pts[k + 1]!)) out.push([pts[k]! + 0.6, pts[k + 1]! - 0.4])
  }
  return out
})()

/** Every lookup at every point, and a road's level at its own vertices. */
const answer = () =>
  POINTS.map(([x, y, road]) => {
    const ground = groundZ(x, y),
      terrain = terrainZ(x, y)
    return [
      ground,
      groundZ(x, y, terrain + 6, true),
      footZ(x, y),
      footZ(x, y, terrain),
      atGrade(x, y),
      deckNear(x, y, 1),
      drawnZ(x, y, ground),
      surfaceAt(x, y),
      surfaceAt(x, y, terrain + 30),
      waterAt(x, y, ground - 1, 0.6),
      waterUnder(x, y, true, 0.6),
      waterUnder(x, y, false, 0.6),
      road === undefined ? undefined : roadLevel(road, x, y),
    ]
  })

test("the ground, the surface and the water give the same answers whatever tiles are in memory and in whichever order they came", () => {
  emptied()
  const lazy = answer()
  const touched = residentTiles()
  assert.deepEqual(touched, ["-1_-1", "0_-1", "-1_0", "0_0"])
  for (const order of [touched, [...touched].reverse()]) {
    emptied()
    for (const key of order) provideTile(fromDisk(key))
    // nothing else may be read: a lookup reading another tile throws
    setTileSource(undefined)
    try {
      assert.deepStrictEqual(answer(), lazy)
    } finally {
      setTileSource(fromDisk)
    }
  }
  // the points cover roads, a deck, rivers and land
  const kinds = (k: number) => new Set(lazy.map((a) => a[k] === undefined))
  assert.deepEqual(kinds(5), new Set([true, false]), "on a deck and off")
  assert.deepEqual(kinds(9), new Set([true, false]), "in the water and out")
  assert.ok(new Set(lazy.map((a) => a[7])).size >= 4, "on several surfaces")
})

test("a road's level is its surface's within the halo of it, and none farther off: nothing stands on it there", () => {
  const { ids, items } = placeAt(STATION.x, STATION.y).vectors.roads,
    n = ids.findIndex((id) => MAP.roads[id]!.name === "Via Cesare Battisti"),
    road = ids[n]!,
    [x, y] = items[n]!.pts
  assert.ok(Number.isFinite(roadLevel(road, x!, y!)))
  assert.ok(Number.isFinite(roadLevel(road, x! + HALO - 0.1, y!)))
  assert.equal(roadLevel(road, -1990, 1990), undefined, "2 km off in its own tile")
  assert.equal(roadLevel(road, 4000, -5000), undefined, "in a tile far from it")
})
