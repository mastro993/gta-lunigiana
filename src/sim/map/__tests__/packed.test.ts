import assert from "node:assert/strict"
import { test } from "node:test"

import { packMap } from "../../../tools/pack.ts"
import type { MonzoneMap } from "../index.ts"
import { decodeMap, MAP_VERSION } from "../packed.ts"

/** The map with its typed arrays as plain arrays, for deepEqual. */
const plain = (m: MonzoneMap) => ({
  ...m,
  heightmap: { ...m.heightmap, data: Array.from(m.heightmap.data) },
  walls: { walk: Array.from(m.walls.walk), drive: Array.from(m.walls.drive) },
  trees: Array.from(m.trees),
})

test("packMap and decodeMap round-trip the map file (negative values, the widest deltas, an empty section); another version throws", () => {
  // packOrigin is (-1500, -1200) dm and treeOrigin (-150, -120) m: the first wall and tree lie south-west of them
  const map: MonzoneMap = {
    version: MAP_VERSION,
    origin: { lat: 44.2, lon: 10.1 },
    mPerDeg: { lat: 111_000, lon: 80_000 },
    bounds: { minX: -50, minY: -20, maxX: 50, maxY: 20 },
    heightmap: {
      cell: 4,
      cols: 3,
      rows: 2,
      x0: -52,
      y0: -24,
      data: [-500, -510, -490, 3000, 2990, 3010],
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
      walk: [-1000.5, -20.3, 50.1, 9.9, 100000.7, -200000.1, 0, 0],
      shore: [1.5, 2.5, 3.5, 4.5],
      drive: [],
    },
    // tree x from the origin: -32768 then -1, deltas -32768 and +32767, the widest 2-byte zigzag codes
    trees: [-32918, -120, 0.8, -151, 19, 1.3],
    spawns: { player: { x: 1, y: 2, angle: -0.5 }, parked: [{ x: 3, y: 4, angle: 1 }] },
  }
  assert.deepEqual(plain(decodeMap(packMap(map).file)), plain(map))
  assert.throws(
    () => decodeMap(packMap({ ...map, version: MAP_VERSION - 1 }).file),
    /monzone.bin is version 1, this decoder reads 2/,
  )
  assert.throws(
    () => packMap({ ...map, trees: [...Array.from(map.trees), 32617, 0, 1] }),
    /trees: 32767 at 6 is 32768 from the value 3 back, too far for 2 bytes/,
  )
  assert.throws(
    () => packMap({ ...map, heightmap: { ...map.heightmap, data: [0, 0, 0, 0, 0, 40000] } }),
    /heightmap: 40000 at 5 does not fit int16/,
  )
})
