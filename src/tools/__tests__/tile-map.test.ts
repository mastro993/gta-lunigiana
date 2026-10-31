import assert from "node:assert/strict"
import { test } from "node:test"

import { decodeMap, decodeTile, MAP_VERSION } from "../../sim/map/packed.ts"
import { joinTiles } from "../map-file.ts"
import { packTile } from "../pack.ts"
import { type BuiltMap, cutMap, NO_BAKES, stampMap } from "../tile-map.ts"

/** The 6 × 6 cells' land cover. */
const cover = Array.from({ length: 36 }, (_, k) => k % 22)

/** A 24 m map on the origin: its four tiles meet at (0, 0). */
const built = (data: ReadonlyArray<number>): BuiltMap => ({
  version: MAP_VERSION,
  origin: { lat: 44.2, lon: 10.1 },
  mPerDeg: { lat: 111_000, lon: 80_000 },
  bounds: { minX: -12, minY: -12, maxX: 12, maxY: 12 },
  outline: [[-12, -12, 12, -12, 12, 12, -12, 12]],
  tiles: [
    { i: -1, j: -1 },
    { i: 0, j: -1 },
    { i: -1, j: 0 },
    { i: 0, j: 0 },
  ],
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
  // Sparse ids, as the scatter numbers trees (lattice cells, bank trees past 2^28): in id order the
  // trees are not in their tiles' order (0_0's comes before 0_-1's).
  trees: [-5, -5, 1.2, 0, 0, 0.9, 7, -3, 1],
  treeIds: [12, 40_000, 2 ** 28 + 5],
  treeCorner: [-11, -11],
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

test("cutMap cuts the dense layers into tiles that joinTiles puts back as they were, walls and trees in order, trees merged by id", () => {
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
  assert.deepEqual(Array.from(whole.treeIds), built(data).treeIds)
  assert.deepEqual(
    tiles.map((t) => Array.from(t.ids)),
    [[12], [2 ** 28 + 5], [], [40_000]],
  )
  assert.deepEqual(global.walls.lattice.trees, [-11, -11]) // the region's, not the lowest tree's
  assert.deepEqual(Array.from(whole.cover), cover)
  assert.equal(global.walls.reach, 13) // the 24 m shore wall on the edge reaches 12 m past its midpoint, plus the margin
})

test("cutMap writes the listed tiles alone: a wall or tree in an unlisted one goes to the listed tile round it nearest it", () => {
  const whole = built(data)
  // (0, 0) unlisted, as an L leaves its notch; a wall and a tree in it
  const l: BuiltMap = {
    ...whole,
    tiles: whole.tiles.slice(0, 3),
    walls: { ...whole.walls, walk: [...Array.from(whole.walls.walk), 2, 2, 4, 2] },
  }
  const { global, files } = filesOf(l)
  assert.deepEqual([...files.keys()], ["", "-1_-1", "0_-1", "-1_0"])
  assert.deepEqual(
    global.tiles.map(({ i, j }) => `${i}_${j}`),
    ["-1_-1", "0_-1", "-1_0"],
  )
  const tiles = global.tiles.map(({ i, j }) => decodeTile(files.get(`${i}_${j}`)!))
  // The new wall, midpoint (3, 2), lies 2 m from 0_-1, 3 m from -1_0; 0_0's tree, at (0, 0), on all three, goes to the
  // first in key order, -1_-1.
  assert.deepEqual(
    tiles.map((t) => Array.from(t.wallIds.walk)),
    [[1], [2], [0]],
  )
  assert.deepEqual(
    tiles.map((t) => Array.from(t.ids)),
    [[12, 40_000], [2 ** 28 + 5], []],
  )
  const joined = joinTiles(decodeMap(files.get("")!), tiles)
  assert.deepEqual(Array.from(joined.walls.walk), l.walls.walk)
  assert.deepEqual(Array.from(joined.trees), l.trees)
})

test("an unlisted tile's coarse nodes and cells read the nearest listed node and cell, as the game's lookups there do", () => {
  const whole = built(data)
  const { global } = filesOf({ ...whole, tiles: whole.tiles.slice(0, 3) })
  // The coarse nodes at x, y = -64, 0, 64: the grid's nodes (clamped) at columns and rows 0, 3, 6,
  // and its cells at 0, 3, 5. Those in 0_0 (x, y ≥ 0) read the listed tiles round it nearest them,
  // the first in key order (-1_-1, 0_-1, -1_0) on a tie: the node (6, 6) is 0_-1's (6, 3), and the
  // cells (3, 3), (5, 3) and (5, 5) are 0_-1's (3, 2), (5, 2) and (5, 2), (3, 5) -1_0's (2, 5).
  // The nodes on 0_0's south and west sides are its neighbours' too.
  const node = (gi: number, gj: number) => data[gj * 7 + gi]!
  // south to north, rows of west to east
  assert.deepEqual(Array.from(global.coarse.heights), [
    node(0, 0),
    node(3, 0),
    node(6, 0),
    node(0, 3),
    node(3, 3),
    node(6, 3),
    node(0, 6),
    node(3, 6),
    node(6, 3),
  ])
  const cell = (ci: number, cj: number) => cover[cj * 6 + ci]!
  assert.deepEqual(Array.from(global.coarse.cover), [
    cell(0, 0),
    cell(3, 0),
    cell(5, 0),
    cell(0, 3),
    cell(3, 2),
    cell(5, 2),
    cell(0, 5),
    cell(2, 5),
    cell(5, 2),
  ])
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
