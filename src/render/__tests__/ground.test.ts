import assert from "node:assert/strict"
import { test } from "node:test"

import { coarseHeightAt } from "../../sim/map/coarse.ts"
import { ROAD_LIFT } from "../../sim/map/ground.ts"
import { MAP } from "../../sim/map/index.ts"
import { readMapFile, tileUrl } from "../../sim/map/packed.ts"
import { dropTile, nodeAt, setTileSource } from "../../sim/map/tiles.ts"
import { farTerrainY, groundY, terrainResident, terrainY, yOf } from "../ground.ts"
import { residentAround, vectorsAround } from "../testing.ts"
import { assertBridgesCarry } from "./bridges.ts"

const hm = MAP.heightmap
/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }
/** The roads of the tiles within 2 km of it, in the map's order. */
const ROADS = vectorsAround([STATION], 2000).roads.items

test("terrainY hits the heightmap nodes (row 0 = south) and stays planar inside a triangle", () => {
  for (const [i, j] of [
    [0, 0],
    [10, 3],
    [200, 100],
    [479, 347],
    [300, 340],
  ] as const) {
    assert.ok(
      Math.abs(terrainY(hm.x0 + i * hm.cell, hm.y0 + j * hm.cell) - yOf(nodeAt(i, j) / 10)) < 1e-6,
    )
  }
  // South-east triangle of cell (100, 100): the centroid is the mean of its corners.
  const x = hm.x0 + 100 * hm.cell,
    y = hm.y0 + 100 * hm.cell,
    node = (i: number, j: number) => yOf(nodeAt(i, j) / 10)
  const mean = (node(100, 100) + node(101, 100) + node(101, 101)) / 3
  assert.ok(Math.abs(terrainY(x + (2 / 3) * hm.cell, y + (1 / 3) * hm.cell) - mean) < 1e-6)
})

test("farTerrainY is terrainY where the terrain is in memory and the coarse grid's height where not, even in a cell whose east nodes lie in a tile out", () => {
  // The last cell west of the x = 0 seam, by Monzone's station: its east nodes are tile 0_0's.
  const x = -1,
    y = 500
  residentAround([{ x, y }], 200)
  assert.equal(farTerrainY(x, y), terrainY(x, y))
  assert.equal(farTerrainY(100, y), terrainY(100, y))
  setTileSource(undefined)
  dropTile("0_0")
  try {
    assert.equal(terrainResident(-5, y), true, "a cell all in tile -1_0")
    assert.equal(farTerrainY(-5, y), terrainY(-5, y))
    assert.equal(terrainResident(x, y), false)
    assert.throws(() => terrainY(x, y), /map tile 0_0 not loaded/)
    assert.equal(farTerrainY(x, y), yOf(coarseHeightAt(x, y)))
    assert.equal(farTerrainY(100, y), yOf(coarseHeightAt(100, y)))
  } finally {
    setTileSource((key) => readMapFile(tileUrl(MAP.name, key)))
  }
})

test("groundY stands on a bridge deck from above and on the river bank from below", () => {
  const bridge = ROADS.find((r) => r.bridge === true && r.cls === "tertiary")!
  const x = (bridge.pts[0]! + bridge.pts[2]!) / 2,
    y = (bridge.pts[1]! + bridge.pts[3]!) / 2
  const deck = yOf((bridge.z[0]! + bridge.z[1]!) / 2) + ROAD_LIFT.tertiary
  assert.ok(
    Math.abs(groundY(x, y) - deck) < 0.5,
    "no previous height: the highest surface, the deck",
  )
  assert.ok(Math.abs(groundY(x, y, deck - 0.2) - deck) < 0.5, "already on the deck: stays there")
  assert.equal(
    groundY(x, y, terrainY(x, y)),
    terrainY(x, y),
    "under the bridge: stays on the ground",
  )
  assert.ok(deck - terrainY(x, y) > 2)
})

test("groundY stands on an at-grade road when arriving from the terrain beside it", () => {
  const road = ROADS.find((r) => r.bridge !== true && r.tunnel !== true && r.cls === "tertiary")!
  const x = (road.pts[0]! + road.pts[2]!) / 2,
    y = (road.pts[1]! + road.pts[3]!) / 2
  assert.ok(groundY(x, y) > terrainY(x, y), "the road surface floats above the terrain")
  assert.equal(groundY(x, y, terrainY(x, y)), groundY(x, y))
  assert.equal(
    groundY(-388.6, 429.6, terrainY(-388.6, 429.6)),
    groundY(-388.6, 429.6),
    "the reviewer's sunk player",
  )
})

// Regression: on the steep little bridge on Via Provinciale near Colognola (OSM 810591030) the gully below stayed
// nearer than the climbing deck, so the car (and walkers) dropped 1.9 m under it (ground.map-test.ts crosses every bridge
// of the map).
test("a car's wheels and a walker crossing every drivable bridge within 2 km of Monzone, Colognola's among them, both ways, from 12 m before it, stay on the deck", () => {
  const near = ROADS.filter(
    (r) => r.bridge === true && Math.hypot(r.pts[0]! - STATION.x, r.pts[1]! - STATION.y) < 2000,
  )
  assert.ok(
    near.some((r) => r.id === 810591030),
    "the bridge near Colognola",
  )
  const passes = assertBridgesCarry(near, ROADS)
  assert.ok(passes >= 10, `${passes} passes`)
})
