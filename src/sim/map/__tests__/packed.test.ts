import assert from "node:assert/strict"
import { test } from "node:test"

import { packMap, packTile } from "../../../tools/pack.ts"
import type { MonzoneMap } from "../index.ts"
import {
  decodeMap,
  decodeTile,
  decodeTileVectors,
  MAP_VERSION,
  type MonzoneMapJson,
  TILE_CELLS,
  TILE_NODES,
} from "../packed.ts"

/** The value with its typed arrays as plain arrays, for deepEqual. */
const plain = (value: unknown): unknown =>
  ArrayBuffer.isView(value)
    ? Array.from(value as unknown as ArrayLike<number>)
    : Array.isArray(value)
      ? value.map(plain)
      : typeof value === "object" && value !== null
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]))
        : value

const map: MonzoneMap = {
  version: MAP_VERSION,
  name: "monzone",
  hash: "0123456789abcdef",
  origin: { lat: 44.2, lon: 10.1 },
  mPerDeg: { lat: 111_000, lon: 80_000 },
  bounds: { minX: -50, minY: -20, maxX: 50, maxY: 20 },
  outline: [[-50, -20, 50, -20, 50, 20, -50, 20]],
  heightmap: { cell: 4, cols: 26, rows: 11, x0: -52, y0: -24 },
  tiles: [{ i: -1, j: -1, zmin: -510, zmax: 3010 }],
  place: { floor: 230.3, downslope: 2.1 },
  coarse: {
    cell: 64,
    cols: 3,
    rows: 2,
    x0: -64,
    y0: -64,
    heights: Int16Array.from([-500, -510, -490, 3000, 2990, 3010]),
    cover: Uint8Array.from([0, 1, 21, 3, 0, 7]),
  },
  roads: [],
  rail: [],
  railway: { lines: [], stations: [], crossings: [], platforms: [] },
  pois: [],
  districts: [{ name: "Monzone\nAlto", x: 0, y: 0, r: 30 }], // a newline in a string must not end the JSON line
  graph: { xy: [0, 0, 1, 1], edges: [0, 1, 0], traffic: [0], walk: [0] },
  walls: {
    reach: 33,
    lattice: {
      walk: [-50, -20],
      land: [-50, -20],
      drive: [-52.5, -21],
      traffic: [-52.5, -21],
      trees: [-49, -19],
    },
    counts: { walk: 12, drive: 9 },
  },
  vectors: {
    halo: 32,
    counts: { roads: 0, buildings: 0, water: 0, areas: 0, barriers: 0 },
    lattice: { buildings: [0, 0], water: [0, 0] },
  },
  spawns: {
    player: { x: 1, y: 2, angle: -0.5 },
    parked: [{ x: 3, y: 4, angle: 1, rest: { panda: [301.2, 0.01, -0.02] }, truck: true }],
  },
  lanes: { panda: [1.8, -1], ape: [1.6, 1.6], truck: [-1, -1], carabinieri: [1.5, 0] },
  farms: [{ building: 0, rural: true, pen: false }],
  lamps: [{ x: 1, y: 2, z: 304.5, nx: 0, ny: 1, kind: "wall" }],
  derived: {
    crossings: [],
    platforms: [],
    stations: [],
    bells: [{ id: 7, x: 1.5, y: 2.25, z: 320.5, h: 18 }],
    residents: [0, Math.fround(1.3)],
    farms: [3.5, 4.25],
    mouths: [
      { road: 0, x: 1, y: 2, z: 160.06, angle: 2.6, crown: 6.75, throat: 12, back: 2 },
      { road: 0, x: 5, y: 6, z: 157.36, angle: -0.5, open: true },
    ],
  },
}

test("packMap and decodeMap round-trip the global file (a newline inside a name, the coarse grid); a file of another version throws", () => {
  assert.deepEqual(plain(decodeMap(packMap(map).file)), plain(map))
  // packMap stamps the current version: a file of another version comes from another build
  const old = Buffer.from(`${JSON.stringify({ version: 2 })}\n`)
  assert.throws(
    () => decodeMap(old),
    /the global map file is version 2, this decoder reads 6; run pnpm map/,
  )
})

/** `map`'s graph, lanes and residents as the build bakes them: coordinates on decimetres, lanes with the fit's float noise, residents float32. */
const tables = {
  graph: {
    // negative, one decimal, jumps across Lunigiana's box (deltas past 2 bytes)
    xy: [-11500, 13000.3, 0.1, -0.5, -11499.9, -6100],
    edges: [0, 1, 0, 1, 2, 3, 0, 2, 3],
    traffic: [1, 2],
    walk: [0, 1, 2],
  },
  // models out of their usual order, which the decoded record keeps; a model with no lanes yet
  lanes: {
    ape: [2.0500000000000003, 2.05, -1, 0.1 + 0.2],
    panda: [],
    truck: [-1, -1, -1, -1],
    carabinieri: [0, 1.8, 1.8, 0],
  },
  residents: [0, Math.fround(1.3), Math.fround(1e-7)],
}

test("the graph, the lanes and the residents travel as sections after the JSON line, which holds their counts, and come back to the bit", () => {
  const { graph, lanes, residents } = tables
  const file = packMap({ ...map, graph, lanes, derived: { ...map.derived, residents } }).file
  const decoded = decodeMap(file)
  assert.deepEqual(decoded.graph, graph)
  assert.deepEqual(Object.entries(decoded.lanes), Object.entries(lanes))
  assert.deepEqual(decoded.derived.residents, residents)
  const line = JSON.parse(
    Buffer.from(file.subarray(0, file.indexOf(10))).toString(),
  ) as MonzoneMapJson
  assert.deepEqual(line.graph, { xy: 6, edges: 9, traffic: 2, walk: 3 })
  // each lane is its value's index in the table on the line, its distinct values ascending
  assert.deepEqual(line.lanes, {
    table: [-1, 0, 0.30000000000000004, 1.8, 2.05, 2.0500000000000003],
    counts: { ape: 4, panda: 0, truck: 4, carabinieri: 4 },
  })
  assert.equal(line.derived.residents, 3)
})

test("packMap throws on a graph coordinate off the decimetre, a resident that is no float32 and lanes of more values than their indices hold", () => {
  assert.throws(
    () => packMap({ ...map, graph: { ...map.graph, xy: [0, 0.15] } }),
    /graph xy: 0.15 at 1 is not a whole number of decimetres/,
  )
  assert.throws(
    () => packMap({ ...map, derived: { ...map.derived, residents: [0, 1.3] } }),
    /residents: 1.3 at 1 is not a float32/,
  )
  // with the other models' -1, 0, 1.5 and 1.6, one past what the indices hold
  const many = Array.from({ length: 32_765 }, (_, k) => k + 0.25)
  assert.throws(
    () => packMap({ ...map, lanes: { ...map.lanes, panda: many } }),
    /lanes: 32769 distinct values, past the 32768 their 2-byte indices hold/,
  )
})

/** A tile of tile (−1, 0): its corner is (−2000, 0) m, so walls count from (−21000, −1000) dm and trees from (−2100, −100) m. */
const tile = {
  hash: "0123456789abcdef",
  i: -1,
  j: 0,
  heights: Int16Array.from({ length: TILE_NODES * TILE_NODES }, (_, k) => ((k * 7) % 4001) - 2000),
  walls: {
    // x from the origin: 0 then 32767 dm, then back to 0: deltas +32767 and −32767, the widest 2-byte zigzag codes
    walk: Float64Array.from([-2100, -100, 1176.7, 3176.7, -2100, -99.9, -2000.5, 0.3]),
    shore: Float64Array.from([-1999.5, 2.5, -1990.5, 4.5]),
    drive: new Float64Array(),
  },
  wallIds: {
    walk: Int32Array.from([0, 7]),
    shore: Int32Array.from([3]),
    drive: new Int32Array(),
  },
  // a wall at every level, and one at the highest level that fits
  wallLevels: { walk: Float64Array.from([NaN, 3276.7]), drive: new Float64Array() },
  // tree x from the origin: 0 then 32767 m, the widest 2-byte delta; scales in hundredths
  trees: Float64Array.from([-2100, -100, 0.8, 30667, 1999, 1.3]),
  ids: Int32Array.from([5, 1_000_000]),
  cover: Uint8Array.from({ length: TILE_CELLS * TILE_CELLS }, (_, k) => (k * 13) % 22),
  // full-precision doubles (a baked floor) come back exact
  vectors: {
    roads: {
      ids: [4, 9],
      items: [
        { pts: [-1990.1, 3.4, -1980, 3.4], z: [301.2, 302.25] },
        { pts: [0, 0], z: [1] },
      ],
    },
    buildings: {
      ids: [2],
      items: [
        {
          id: -7,
          kind: "house",
          h: 6.5,
          z0: 300.1,
          style: "stone",
          tint: 2,
          outer: [0, 0, 4, 0, 4, 3],
        },
      ],
    },
    water: {
      ids: [0],
      items: [
        {
          id: 11,
          kind: "stream",
          w: 2,
          bed: 3,
          depth: 1,
          pts: [5, 5, 9, 9],
          z: [299.4, 299.1],
          area: [1.25, 1.31],
          floor: [Math.PI * 95, 0.1 + 0.2],
        },
      ],
    },
    areas: { ids: [], items: [] },
    barriers: { ids: [1], items: [{ kind: "guard_rail", pts: [1, 2, 3, 4] }] },
  },
}

test("packTile and decodeTile round-trip a tile (negative values, the widest deltas, an empty section, walls with and without a level); a value too far throws", () => {
  assert.deepEqual(plain(decodeTile(packTile(tile).file)), plain(tile))
  // The full map's detail reads the vectors alone, with which tile and build they are.
  const alone = decodeTileVectors(packTile(tile).file)
  assert.deepEqual(
    [alone.hash, alone.i, alone.j, plain(alone.vectors)],
    [tile.hash, tile.i, tile.j, plain(tile.vectors)],
  )
  assert.throws(
    () =>
      packTile({
        ...tile,
        walls: { ...tile.walls, drive: Float64Array.from([-2100, -100, 1176.8, 0]) },
        wallIds: { ...tile.wallIds, drive: Int32Array.from([0]) },
        wallLevels: { ...tile.wallLevels, drive: [NaN] },
      }),
    /tile -1_0 drive walls: 32768 at 2 is 32768 from the value 2 back, too far for 2 bytes/,
  )
  assert.throws(
    () => packTile({ ...tile, heights: Array.from(tile.heights, (h, k) => (k === 5 ? 40000 : h)) }),
    /tile -1_0 heightmap: 40000 at 5 does not fit int16/,
  )
  assert.throws(
    () => packTile({ ...tile, cover: new Uint8Array(3) }),
    /tile -1_0: 251001 nodes and 3 cells/,
  )
  assert.throws(
    () => packTile({ ...tile, wallLevels: { ...tile.wallLevels, walk: [NaN, 3276.8] } }),
    /tile -1_0 walk wall levels: 3276.8 at 1 does not fit int16/,
  )
  assert.throws(
    () => packTile({ ...tile, wallLevels: { ...tile.wallLevels, walk: [NaN] } }),
    /tile -1_0: 2 walk walls, 1 levels/,
  )
})
