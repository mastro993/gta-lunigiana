import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { readMapFile, tileUrl } from "../../sim/map/packed.ts"
import {
  dropTile,
  isResident,
  provideTile,
  residentTiles,
  setTileSource,
  tilesOver,
} from "../../sim/map/tiles.ts"
import { locationAt } from "../location.ts"
import { roadOracle } from "./road-oracle.ts"
import { layersAround } from "./tile-paint.ts"

/** Takes into memory, from disk, the tiles a lookup at each point reads: the host keeps those round the player. */
const residentAt = (...points: ReadonlyArray<readonly [number, number]>) => {
  for (const [x, y] of points)
    for (const key of tilesOver(x, y, x, y))
      if (!isResident(key)) provideTile(readMapFile(tileUrl(MAP.name, key)))
}

test("the Carabinieri station is on Via Cesare Battisti, by the station", () => {
  residentAt([-414.4, 433.1])
  assert.deepEqual(locationAt(-414.4, 433.1), {
    road: "Via Cesare Battisti",
    district: "Monzone (Stazione)",
  })
})

test("deep in the woods there is no road", () => {
  residentAt([300, -300])
  assert.equal(locationAt(300, -300).road, undefined)
})

// Regression: only named roads were searched, so on an unnamed road the HUD showed a side street within 15 m.
test("on an unnamed road, the side street beside it is not named", () => {
  residentAt([-689, 852])
  assert.equal(locationAt(-689, 852).road, undefined)
})

/** The box round Monzone station the check below reads, m: across the x = 0 and y = 0 tile seams. */
const BOX = { minX: -1500, minY: -500, maxX: 500, maxY: 1500 }
/** Points 25 m apart over `BOX`, and along both seams 3 m apart. */
const GRID = [
  ...Array.from(
    { length: 81 * 81 },
    (_, k) => [-1500 + 25 * (k % 81), -500 + 25 * Math.floor(k / 81)] as const,
  ),
  ...Array.from({ length: 667 }, (_, k) =>
    [-0.05, 0, 0.05, 14].flatMap((d) => [[d, -500 + 3 * k] as const, [-1500 + 3 * k, d] as const]),
  ).flat(),
]

test("round Monzone the road named is the old answer over every road near it, whichever tiles are in memory, and none where its tile is not", () => {
  // the roads of the tiles round the station's (every road within 2 km of its tile), in the whole map's order
  const { roads } = layersAround(-1, 0)
  const old = roadOracle(roads)
  // the grid, and every road vertex in the box: where roads meet, the nearest are tied
  const points = [
    ...GRID,
    ...roads.flatMap(({ pts }) =>
      Array.from(
        { length: pts.length / 2 },
        (_, k) => [pts[2 * k]!, pts[2 * k + 1]!] as const,
      ).filter(([x, y]) => x >= BOX.minX && x <= BOX.maxX && y >= BOX.minY && y <= BOX.maxY),
    ),
  ]
  const want = points.map(([x, y]) => old(x, y))
  assert.ok(new Set(want).size > 20, "many roads named")
  const keys = [...new Set(points.flatMap(([x, y]) => tilesOver(x, y, x, y)))]
  setTileSource(undefined) // a read of a tile not in memory throws, as in the browser
  try {
    for (const order of [keys, [...keys].reverse()]) {
      for (const key of residentTiles()) dropTile(key)
      for (const key of order) provideTile(readMapFile(tileUrl(MAP.name, key)))
      assert.deepEqual(
        points.map(([x, y]) => locationAt(x, y).road),
        want,
      )
    }
    dropTile("-1_0")
    assert.equal(
      locationAt(-414.4, 433.1).road,
      undefined,
      "its tile not in memory: no name, no read",
    )
  } finally {
    setTileSource((key) => readMapFile(tileUrl(MAP.name, key)))
  }
})
