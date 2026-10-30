import assert from "node:assert/strict"
import { test } from "node:test"

import { decodeMap, decodeTile, MAP_VERSION } from "../../sim/map/packed.ts"
import { packTile } from "../pack.ts"
import { type BuiltMap, cutMap, joinTiles, NO_BAKES, stampMap } from "../tile-map.ts"

/** The 6 × 6 cells' land cover. */
const cover = Array.from({ length: 36 }, (_, k) => k % 22)

/** A 24 m map on the origin: its four tiles meet at (0, 0). */
const built = (data: ReadonlyArray<number>): BuiltMap => ({
  version: MAP_VERSION,
  origin: { lat: 44.2, lon: 10.1 },
  mPerDeg: { lat: 111_000, lon: 80_000 },
  bounds: { minX: -12, minY: -12, maxX: 12, maxY: 12 },
  outline: [[-12, -12, 12, -12, 12, 12, -12, 12]],
  heightmap: { cell: 4, cols: 7, rows: 7, x0: -12, y0: -12, data: Int16Array.from(data) },
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
  cover: (b) =>
    Array.from({ length: b.cols * b.rows }, (_, k) => {
      const c = b.c0 + (k % b.cols),
        r = b.r0 + Math.floor(k / b.cols)
      return cover[r * 6 + c]!
    }),
  spawns: { player: { x: 1, y: 2, angle: 0 }, parked: [] },
})
const data = Array.from({ length: 49 }, (_, k) => 2000 + 13 * k)

/** The stamped global map and the files of `map` cut as the build cuts it: the global file under "", each tile under its key. */
const filesOf = (map: BuiltMap) => {
  const cut = cutMap(map, "test")
  const stamped = stampMap(cut.global(NO_BAKES), cut.tiles.values())
  const files = new Map<string, Uint8Array>([["", stamped.file]])
  for (const [key, file] of cut.tiles) files.set(key, stamped.tile(file))
  return { global: stamped.global, files, unstamped: cut.tiles }
}

test("cutMap cuts the dense layers into tiles that joinTiles puts back as they were, walls and trees in order", () => {
  const { global, files } = filesOf(built(data))
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
  assert.deepEqual(Array.from(whole.cover), cover)
  assert.equal(global.walls.reach, 13) // the 24 m shore wall on the edge reaches 12 m past its midpoint, plus the margin
})

test("joinTiles refuses a tile from another build", () => {
  const a = filesOf(built(data)),
    b = filesOf(built(data.map((z) => z + 1)))
  const tiles = a.global.tiles.map(({ i, j }) =>
    decodeTile((i === 0 && j === 0 ? b : a).files.get(`${i}_${j}`)!),
  )
  assert.throws(
    () => joinTiles(decodeMap(a.files.get("")!), tiles),
    new RegExp(`join: tile 0_0 is from another build \\(${b.global.hash}, not ${a.global.hash}\\)`),
  )
})

test("stamping a tile gives the file packTile packs with the build hash", () => {
  const { global, files, unstamped } = filesOf(built(data))
  for (const [key, file] of unstamped) {
    const tile = decodeTile(file)
    assert.equal(tile.hash, "")
    assert.deepEqual(files.get(key), packTile({ ...tile, hash: global.hash }).file)
  }
})
