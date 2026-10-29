import assert from "node:assert/strict"
import { test } from "node:test"

import { decodeMap, decodeTile, MAP_VERSION } from "../../sim/map/packed.ts"
import { type BuiltMap, cutMap, joinTiles, NO_BAKES } from "../tile-map.ts"

/** A 24 m map on the origin: its four tiles meet at (0, 0). */
const built = (data: ReadonlyArray<number>): BuiltMap => ({
  version: MAP_VERSION,
  origin: { lat: 44.2, lon: 10.1 },
  mPerDeg: { lat: 111_000, lon: 80_000 },
  bounds: { minX: -12, minY: -12, maxX: 12, maxY: 12 },
  heightmap: { cell: 4, cols: 7, rows: 7, x0: -12, y0: -12, data },
  roads: [],
  buildings: [],
  water: [],
  rail: [],
  railway: { lines: [], stations: [], crossings: [], platforms: [] },
  areas: [],
  barriers: [],
  pois: [],
  districts: [],
  graph: { xy: [], edges: [], traffic: [], walk: [] },
  // A wall across the x = 0 seam (its midpoint east of it), one in the south-west tile, a shore wall on the edge.
  walls: {
    walk: [-3, 5, 1, 5, -10, -10, -8, -9],
    shore: [12, -12, 12, 12],
    drive: [-3, 5, 1, 5],
  },
  trees: [-5, -5, 1.2, 0, 0, 0.9, 7, -3, 1],
  cover: Array.from({ length: 36 }, (_, k) => k % 22),
  spawns: { player: { x: 1, y: 2, angle: 0 }, parked: [] },
})
const data = Array.from({ length: 49 }, (_, k) => 2000 + 13 * k)

test("cutMap cuts the dense layers into tiles that joinTiles puts back as they were, walls and trees in order", () => {
  const { global, files } = cutMap(built(data), "test", NO_BAKES)
  assert.deepEqual(
    global.tiles.map(({ i, j }) => `${i}_${j}`),
    ["-1_-1", "0_-1", "-1_0", "0_0"],
  )
  const tiles = global.tiles.map(({ i, j }) => decodeTile(files.get(`${i}_${j}`)!))
  const whole = joinTiles(decodeMap(files.get("")!), tiles)
  assert.deepEqual(Array.from(whole.heightmap.data), data)
  for (const kind of ["walk", "shore", "drive"] as const)
    assert.deepEqual(Array.from(whole.walls[kind]), built(data).walls[kind])
  assert.deepEqual(Array.from(whole.trees), built(data).trees)
  assert.deepEqual(Array.from(whole.cover), built(data).cover)
  assert.equal(global.walls.reach, 13) // the 24 m shore wall on the edge reaches 12 m past its midpoint, plus the margin
})

test("cutMap throws for a height that does not fit int16 decimetres, rather than wrapping it", () => {
  for (const bad of [40000, -40000, Number.NaN, 2000.5])
    assert.throws(
      () => cutMap(built(data.map((z, k) => (k === 10 ? bad : z))), "test", NO_BAKES),
      /heightmap: .* at node \(3, 1\) does not fit int16/,
    )
})

test("joinTiles refuses a tile from another build", () => {
  const a = cutMap(built(data), "test", NO_BAKES),
    b = cutMap(built(data.map((z) => z + 1)), "test", NO_BAKES)
  const tiles = a.global.tiles.map(({ i, j }) =>
    decodeTile((i === 0 && j === 0 ? b : a).files.get(`${i}_${j}`)!),
  )
  assert.throws(
    () => joinTiles(decodeMap(a.files.get("")!), tiles),
    new RegExp(`join: tile 0_0 is from another build \\(${b.global.hash}, not ${a.global.hash}\\)`),
  )
})
