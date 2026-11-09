import assert from "node:assert/strict"
import { test } from "node:test"

import type { MonzoneMap } from "../../index.ts"
import { decodeMap, encodeMap } from "../global-file.ts"
import { MAP_VERSION } from "../sections.ts"
import { plain } from "./plain.ts"

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

test("encodeMap and decodeMap round-trip the global file (a newline inside a name, the coarse grid); a file of another version throws", () => {
  assert.deepEqual(plain(decodeMap(encodeMap(map).file)), plain(map))
  // encodeMap stamps the current version: a file of another version comes from another build
  const old = Buffer.from(`${JSON.stringify({ version: 2 })}\n`)
  assert.throws(
    () => decodeMap(old),
    new RegExp(`the global map file is version 2, this decoder reads ${MAP_VERSION}; run pnpm map`),
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
  const file = encodeMap({ ...map, graph, lanes, derived: { ...map.derived, residents } }).file
  const decoded = decodeMap(file)
  assert.deepEqual(decoded.graph, graph)
  assert.deepEqual(Object.entries(decoded.lanes), Object.entries(lanes))
  assert.deepEqual(decoded.derived.residents, residents)
  const line = JSON.parse(new TextDecoder().decode(file.subarray(0, file.indexOf(10)))) as {
    readonly graph: unknown
    readonly lanes: unknown
    readonly derived: { readonly residents: number }
  }
  assert.deepEqual(line.graph, { xy: 6, edges: 9, traffic: 2, walk: 3 })
  // each lane is its value's index in the table on the line, its distinct values ascending
  assert.deepEqual(line.lanes, {
    table: [-1, 0, 0.30000000000000004, 1.8, 2.05, 2.0500000000000003],
    counts: { ape: 4, panda: 0, truck: 4, carabinieri: 4 },
  })
  assert.equal(line.derived.residents, 3)
})

test("encodeMap throws on a graph coordinate off the decimetre, a resident that is no float32 and lanes of more values than their indices hold", () => {
  assert.throws(
    () => encodeMap({ ...map, graph: { ...map.graph, xy: [0, 0.15] } }),
    /graph xy: 0.15 at 1 is not a whole number of decimetres/,
  )
  assert.throws(
    () => encodeMap({ ...map, derived: { ...map.derived, residents: [0, 1.3] } }),
    /residents: 1.3 at 1 is not a float32/,
  )
  // with the other models' -1, 0, 1.5 and 1.6, one past what the indices hold
  const many = Array.from({ length: 32_765 }, (_, k) => k + 0.25)
  assert.throws(
    () => encodeMap({ ...map, lanes: { ...map.lanes, panda: many } }),
    /lanes: 32769 distinct values, past the 32768 their 2-byte indices hold/,
  )
})
