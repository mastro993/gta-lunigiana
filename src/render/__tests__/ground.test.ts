import assert from "node:assert/strict"
import { test } from "node:test"

import { coarseHeightAt } from "../../sim/map/coarse.ts"
import { groundZ, ROAD_LIFT } from "../../sim/map/ground.ts"
import { isDrivable, MAP, roadClassOf } from "../../sim/map/index.ts"
import { readMapFile, tileUrl } from "../../sim/map/packed.ts"
import { dropTile, nodeAt, setTileSource } from "../../sim/map/tiles.ts"
import { VEHICLES } from "../../sim/vehicles.ts"
import { farTerrainY, groundY, terrainResident, terrainY, yOf } from "../ground.ts"
import { everyTileIn } from "../testing.ts"

const hm = MAP.heightmap

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
  everyTileIn()
  // The last cell west of the x = 0 seam, by Monzone's station: its east nodes are tile 0_0's.
  const x = -1,
    y = 500
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
  const bridge = MAP.roads.find((r) => r.bridge === true && r.cls === "tertiary")!
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
  const road = MAP.roads.find(
    (r) => r.bridge !== true && r.tunnel !== true && r.cls === "tertiary",
  )!
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
// nearer than the climbing deck, so the car (and walkers) dropped 1.9 m under it. The car's wheels are the sim's: each
// keeps to the level of its previous contact, as the drive physics does; walkers stand where the renderer puts them.
test("a car's wheels and a walker crossing every drivable bridge, both ways, from 12 m before it, stay on the deck", () => {
  const { wheels } = VEHICLES.carabinieri
  // The straight approach out of a tunnel runs through the hillside (the old marble road up the Solco di Equi bends between its tunnels and bridges).
  const tunnelEnd = (x: number, y: number) =>
    MAP.roads.some(
      (q) =>
        q.tunnel === true &&
        [0, q.pts.length - 2].some((i) => Math.hypot(q.pts[i]! - x, q.pts[i + 1]! - y) < 0.1),
    )
  let passes = 0
  for (const r of MAP.roads) {
    if (r.bridge !== true || !isDrivable(r.cls)) continue
    for (const reverse of [false, true]) {
      const pts = Array.from(
        { length: r.z.length },
        (_, k) => [r.pts[2 * k]!, r.pts[2 * k + 1]!, r.z[k]!] as const,
      )
      if (reverse) pts.reverse()
      const [x0, y0] = pts[0]!,
        [x1, y1] = pts[1]!,
        d = Math.hypot(x1 - x0, y1 - y0),
        ux = (x1 - x0) / d,
        uy = (y1 - y0) / d
      if (tunnelEnd(x0, y0)) continue
      let contacts: ReadonlyArray<number> | undefined, feet: number | undefined
      const place = (x: number, y: number, angle: number) => {
        const c = Math.cos(angle),
          s = Math.sin(angle)
        contacts = wheels.map((w, i) =>
          groundZ(x + w.x * c - w.y * s, y + w.x * s + w.y * c, contacts?.[i]),
        )
        feet = groundY(x, y, feet)
      }
      for (let s = -12; s < 0; s += 0.4) place(x0 + ux * s, y0 + uy * s, Math.atan2(uy, ux))
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay, az] = pts[i]!,
          [bx, by, bz] = pts[i + 1]!,
          len = Math.hypot(bx - ax, by - ay)
        for (let s = 0; s < len; s += 0.4) {
          const x = ax + ((bx - ax) * s) / len,
            y = ay + ((by - ay) * s) / len
          place(x, y, Math.atan2(by - ay, bx - ax))
          const deck = az + ((bz - az) * s) / len + ROAD_LIFT[roadClassOf(r)],
            car = contacts!.reduce((a, b) => a + b) / contacts!.length
          assert.ok(
            Math.abs(car - deck) < 0.5 && Math.abs(feet! - yOf(deck)) < 0.5,
            `road ${r.id} ${reverse ? "b -> a" : "a -> b"} at ${x.toFixed(1)},${y.toFixed(1)}: deck ${deck.toFixed(2)}, wheels ${car.toFixed(2)}, walker ${(feet! - yOf(0)).toFixed(2)} m a.s.l.`,
          )
        }
      }
      passes++
    }
  }
  assert.ok(passes >= 40, `${passes} passes`)
})
