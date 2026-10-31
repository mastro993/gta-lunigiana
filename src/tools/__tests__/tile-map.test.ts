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
  const cut = cutMap(map, "test"),
    tiles = cut.tiles(NO_BAKES).files
  const stamped = stampMap(cut.global(NO_BAKES), tiles.values())
  const files = new Map<string, Uint8Array>([["", stamped.file]])
  for (const [key, file] of tiles) files.set(key, stamped.tile(file))
  return { global: stamped.global, files, unstamped: tiles }
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

/** `built(data)` with vectors near and far from the seams (the bounds are only the terrain's: the cut clamps a feature past them to the edge tiles, as a lookup's tile is clamped). */
const withVectors = (map: BuiltMap): BuiltMap => ({
  ...map,
  roads: [
    // across the x = 0 seam, 50 m north of y = 0: both northern tiles
    {
      id: 1,
      cls: "residential",
      w: 4.5,
      surface: "asphalt",
      pts: [-100, 50, 100, 50],
      z: [300, 301.5],
    },
    // 500 m into the south-east tile
    { id: 2, cls: "track", w: 3, surface: "gravel", pts: [500, -500, 600, -500], z: [310, 311] },
  ],
  buildings: [
    {
      id: 3,
      kind: "house",
      h: 6,
      z0: 290,
      style: "stone",
      tint: 1,
      outer: [-300, -300, -290, -300, -290, -290],
    },
    // in the north-east tile alone
    {
      id: 4,
      kind: "house",
      h: 6,
      z0: 290,
      style: "stone",
      tint: 1,
      outer: [100, 100, 110, 100, 110, 110],
    },
  ],
  // 10 m east of x = 0, south of y = 0: its bed's box within the halo of both southern tiles
  water: [
    {
      id: 5,
      kind: "stream",
      w: 2,
      bed: 3,
      depth: 1,
      pts: [10, -40, 10, -100],
      z: [280, 279],
      area: [1.5, 1.6],
    },
  ],
  // over every tile
  areas: [{ kind: "forest", rings: [[-500, -500, 500, -500, 500, 500, -500, 500]] }],
  barriers: [{ kind: "wall", pts: [40, 40, 60, 60] }],
})

test("cutMap puts each vector whole in every tile it comes within the halo of, with its index, and joinTiles puts them back", () => {
  const map = withVectors(built(data))
  const cut = cutMap(map, "test")
  const bakes = { ...NO_BAKES, floors: [[279.31, 278.123456789]] }
  const { files } = cut.tiles(bakes)
  const tiles = new Map([...files].map(([key, file]) => [key, decodeTile(file)]))
  const ids = (layer: "roads" | "buildings" | "water" | "areas" | "barriers") =>
    [...tiles].map(([key, t]) => `${key}:${t.vectors[layer].ids.join(",")}`)
  assert.deepEqual(ids("roads"), ["-1_-1:", "0_-1:1", "-1_0:0", "0_0:0"])
  assert.deepEqual(ids("buildings"), ["-1_-1:0", "0_-1:", "-1_0:", "0_0:1"])
  assert.deepEqual(ids("water"), ["-1_-1:0", "0_-1:0", "-1_0:", "0_0:"])
  assert.deepEqual(ids("areas"), ["-1_-1:0", "0_-1:0", "-1_0:0", "0_0:0"])
  assert.deepEqual(ids("barriers"), ["-1_-1:", "0_-1:", "-1_0:", "0_0:0"])
  assert.deepEqual(tiles.get("0_0")!.vectors.roads.items, [
    { pts: [-100, 50, 100, 50], z: [300, 301.5] },
  ])
  assert.deepEqual(tiles.get("0_-1")!.vectors.water.items[0]!.floor, [279.31, 278.123456789])
  const stamped = stampMap(cut.global(bakes), files.values())
  const whole = joinTiles(
    stamped.global,
    [...files.values()].map((f) => decodeTile(stamped.tile(f))),
  )
  assert.deepEqual(whole.roads, map.roads)
  assert.deepEqual(whole.buildings, map.buildings)
  assert.deepEqual(whole.water, [{ ...map.water[0]!, floor: [279.31, 278.123456789] }])
  assert.deepEqual(whole.areas, map.areas)
  assert.deepEqual(whole.barriers, map.barriers)
  assert.deepEqual(stamped.global.vectors, {
    halo: 32,
    counts: { roads: 2, buildings: 2, water: 1, areas: 1, barriers: 1 },
    lattice: { buildings: [-300, -300] },
  })
})

test("a vector by an unlisted tile goes to the listed tiles round it, which a lookup there reads", () => {
  const map = withVectors(built(data))
  const { files } = cutMap({ ...map, tiles: map.tiles.slice(0, 3) }, "test").tiles(NO_BAKES)
  const of = (key: string) => decodeTile(files.get(key)!).vectors
  // the north-east building and barrier, in the notch, are in all three tiles round it
  for (const key of ["-1_-1", "0_-1", "-1_0"]) {
    assert.ok(of(key).buildings.ids.includes(1), key)
    assert.deepEqual(of(key).barriers.ids, [0], key)
  }
})

test("cutMap refuses a road whose verge reaches past the halo", () => {
  const map = built(data)
  assert.throws(
    () =>
      cutMap(
        {
          ...map,
          roads: [
            { id: 9, cls: "motorway", w: 70, surface: "asphalt", pts: [0, 0, 1, 0], z: [1, 1] },
          ],
        },
        "test",
      ),
    /road 9 reaches 36.3 m off its centreline, past the 32 m halo/,
  )
})
