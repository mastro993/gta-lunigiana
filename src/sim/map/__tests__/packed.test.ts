import assert from "node:assert/strict"
import { test } from "node:test"

import { packMap, packTile } from "../../../tools/pack.ts"
import type { MonzoneMap } from "../index.ts"
import { decodeMap, decodeTile, MAP_VERSION, TILE_CELLS, TILE_NODES } from "../packed.ts"

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
  buildings: [],
  water: [],
  rail: [],
  railway: { lines: [], stations: [], crossings: [], platforms: [] },
  areas: [],
  barriers: [],
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
  spawns: {
    player: { x: 1, y: 2, angle: -0.5 },
    parked: [{ x: 3, y: 4, angle: 1, rest: { panda: [301.2, 0.01, -0.02] }, truck: true }],
  },
  lanes: { panda: [1.8, -1], ape: [1.6, 1.6], truck: [-1, -1], carabinieri: [1.5, 0] },
  farms: [{ building: 0, rural: true, pen: false }],
  lamps: [{ x: 1, y: 2, z: 304.5, nx: 0, ny: 1, kind: "wall" }],
}

test("packMap and decodeMap round-trip the global file (a newline inside a name, the coarse grid); a file of another version throws", () => {
  assert.deepEqual(plain(decodeMap(packMap(map).file)), plain(map))
  // packMap stamps the current version: a file of another version comes from another build
  const old = Buffer.from(`${JSON.stringify({ version: 2 })}\n`)
  assert.throws(
    () => decodeMap(old),
    /the global map file is version 2, this decoder reads 3; run pnpm map/,
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
  // tree x from the origin: 0 then 32767 m, the widest 2-byte delta; scales in hundredths
  trees: Float64Array.from([-2100, -100, 0.8, 30667, 1999, 1.3]),
  ids: Int32Array.from([5, 1_000_000]),
  cover: Uint8Array.from({ length: TILE_CELLS * TILE_CELLS }, (_, k) => (k * 13) % 22),
}

test("packTile and decodeTile round-trip a tile (negative values, the widest deltas, an empty section); a value too far throws", () => {
  assert.deepEqual(plain(decodeTile(packTile(tile).file)), plain(tile))
  assert.throws(
    () =>
      packTile({
        ...tile,
        walls: { ...tile.walls, drive: Float64Array.from([-2100, -100, 1176.8, 0]) },
        wallIds: { ...tile.wallIds, drive: Int32Array.from([0]) },
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
})
