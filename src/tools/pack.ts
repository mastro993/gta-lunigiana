// Encoders of the map files (before gzip); the format and the decoders (`decodeMap`, `decodeTile`)
// are in src/sim/map/packed.ts. Every value must fit its section, or the build throws.
import type { MonzoneMap } from "../sim/map/index.ts"
import {
  type MonzoneMapJson,
  NO_LEVEL,
  packOrigin,
  TILE_CELLS,
  TILE_NODES,
  type TileData,
  type TileJson,
  tileCorner,
  treeOrigin,
  MAP_VERSION,
} from "../sim/map/packed.ts"

interface Corner {
  readonly minX: number
  readonly minY: number
}

/** One past the largest zigzag delta that fits in 1, 2 or 4 bytes. */
const BYTES_LIMIT = { 1: 0x100, 2: 0x1_0000, 4: 0x1_0000_0000 } as const

/** `values` as `size` byte planes of zigzag deltas from the value `stride` back (`Infinity`: each value itself), each an int32 whose delta fits. */
const pack = (values: ArrayLike<number>, size: 1 | 2 | 4, stride: number, what: string): Buffer => {
  const n = values.length,
    out = Buffer.alloc(n * size)
  for (let k = 0; k < n; k++) {
    const v = values[k]!,
      d = v - (k >= stride ? values[k - stride]! : 0),
      z = d < 0 ? -2 * d - 1 : 2 * d
    if ((v | 0) !== v) throw new Error(`${what}: ${v} at ${k} is not an int32`)
    if (z >= BYTES_LIMIT[size])
      throw new Error(
        `${what}: ${v} at ${k} is ${d} from the value ${stride} back, too far for ${size} bytes`,
      )
    for (let p = 0; p < size; p++) out[p * n + k] = (z >>> (8 * p)) & 255
  }
  return out
}

/** Integer decimetres (int16: the game keeps them in an `Int16Array`), rows of `cols` values each delta-coded from its first. */
const packRows = (dm: ArrayLike<number>, cols: number, what: string): Buffer =>
  pack(
    Array.from(dm, (v, k) => {
      if (v < -32768 || v > 32767) throw new Error(`${what}: ${v} at ${k} does not fit int16`)
      return k % cols === 0 ? v : v - dm[k - 1]!
    }),
    2,
    cols,
    what,
  )

/** Wall segments (ax, ay, bx, by) as decimetres from `packOrigin(corner)`. */
const packWalls = (flat: ArrayLike<number>, corner: Corner, what: string): Buffer => {
  const o = packOrigin(corner)
  return pack(
    Array.from(flat, (v, k) => Math.round(v * 10) - (k % 2 === 0 ? o.x : o.y)),
    2,
    2,
    what,
  )
}

/** Walls' levels (m a.s.l., NaN for none) as decimetres, `NO_LEVEL` for none: each must fit int16 above it, as the terrain does. */
const packLevels = (levels: ArrayLike<number>, what: string): Buffer =>
  pack(
    Array.from(levels, (v, k) => {
      if (Number.isNaN(v)) return NO_LEVEL
      const dm = Math.round(v * 10)
      if (dm <= NO_LEVEL || dm > 32767) throw new Error(`${what}: ${v} at ${k} does not fit int16`)
      return dm
    }),
    4,
    1,
    what,
  )

/** Trees (x, y, scale) on whole metres: metres from `treeOrigin(corner)`, the scale in hundredths. */
const packTrees = (flat: ArrayLike<number>, corner: Corner): Buffer => {
  const o = treeOrigin(corner)
  return pack(
    Array.from(flat, (v, k) => {
      const c = k % 3
      return c === 2 ? Math.round(v * 100) : v - (c === 0 ? o.x : o.y)
    }),
    2,
    3,
    "trees",
  )
}

/** Graph coordinates (m) as integer decimetres: each must be a whole number of them, as the build rounds the map to 0.1 m. */
const toDecimetres = (values: ArrayLike<number>, what: string): Array<number> =>
  Array.from(values, (v, k) => {
    const dm = Math.round(v * 10)
    if (dm / 10 !== v) throw new Error(`${what}: ${v} at ${k} is not a whole number of decimetres`)
    return dm
  })

/** How many distinct lane offsets the table holds at most: an index fits 2 bytes zigzag-coded. */
const LANE_TABLE = 0x8000

/** Every distinct lane offset ascending, and each model's lanes as indices into it, model by model. */
const laneIndices = (lanes: MonzoneMap["lanes"]) => {
  const all = Object.values(lanes).flat(),
    table = [...new Set(all)].sort((a, b) => a - b)
  if (table.length > LANE_TABLE)
    throw new Error(
      `lanes: ${table.length} distinct values, past the ${LANE_TABLE} their 2-byte indices hold`,
    )
  const index = new Map(table.map((v, k) => [v, k]))
  return { table, indices: all.map((v) => index.get(v)!) }
}

/** Float32 values as their bit patterns (int32), so each comes back to the bit; each must be a float32. */
const float32Bits = (values: ArrayLike<number>, what: string): Int32Array => {
  const f32 = Float32Array.from(values)
  f32.forEach((v, k) => {
    if (v !== values[k]) throw new Error(`${what}: ${values[k]} at ${k} is not a float32`)
  })
  return new Int32Array(f32.buffer)
}

/**
 * The global file's sections after the coarse grid's, in file order (the graph, the lanes, the
 * residents), and what its JSON line holds in their place (`MonzoneMapJson`): their counts and the
 * lanes' table.
 */
export const packTables = (
  graph: MonzoneMap["graph"],
  lanes: MonzoneMap["lanes"],
  residents: ArrayLike<number>,
) => {
  const { table, indices } = laneIndices(lanes)
  const counts = Object.fromEntries(
    Object.entries(lanes).map(([model, sides]) => [model, sides.length]),
  ) as MonzoneMapJson["lanes"]["counts"]
  return {
    line: {
      graph: {
        xy: graph.xy.length,
        edges: graph.edges.length,
        traffic: graph.traffic.length,
        walk: graph.walk.length,
      },
      lanes: { table, counts },
      residents: residents.length,
    },
    parts: {
      xy: pack(toDecimetres(graph.xy, "graph xy"), 4, 2, "graph xy"),
      edges: pack(graph.edges, 4, 3, "graph edges"),
      traffic: pack(graph.traffic, 4, 1, "graph traffic"),
      walk: pack(graph.walk, 4, 1, "graph walk"),
      lanes: pack(indices, 2, Infinity, "lanes"),
      residents: pack(float32Bits(residents, "residents"), 4, Infinity, "residents"),
    },
  }
}

/** The gunzipped global file `decodeMap` reads back into `map`, and the bytes of each of its parts. */
export const packMap = (
  map: MonzoneMap,
): { readonly file: Buffer; readonly sizes: Readonly<Record<string, number>> } => {
  const {
    coarse: { heights, cover, ...coarse },
  } = map
  const tables = packTables(map.graph, map.lanes, map.derived.residents)
  const json: MonzoneMapJson = {
    ...map,
    version: MAP_VERSION,
    coarse,
    graph: tables.line.graph,
    lanes: tables.line.lanes,
    derived: { ...map.derived, residents: tables.line.residents },
  }
  const parts = {
    // file order
    json: Buffer.from(`${JSON.stringify(json)}\n`),
    heights: packRows(heights, coarse.cols, "coarse heights"),
    cover: pack(cover, 1, coarse.cols, "coarse cover"),
    ...tables.parts,
  }
  return {
    file: Buffer.concat(Object.values(parts)),
    sizes: Object.fromEntries(Object.entries(parts).map(([part, b]) => [part, b.length])),
  }
}

/** The gunzipped tile file `decodeTile` reads back into `tile`, and the bytes of each of its parts. */
export const packTile = (
  tile: Omit<TileData, "heights" | "cover" | "wallLevels"> & {
    readonly heights: ArrayLike<number>
    readonly cover: ArrayLike<number>
    readonly wallLevels: { readonly walk: ArrayLike<number>; readonly drive: ArrayLike<number> }
  },
): { readonly file: Buffer; readonly sizes: Readonly<Record<string, number>> } => {
  const { hash, i, j, heights, walls, wallIds, wallLevels, trees, ids, cover, vectors } = tile
  if (heights.length !== TILE_NODES * TILE_NODES || cover.length !== TILE_CELLS * TILE_CELLS)
    throw new Error(`tile ${i}_${j}: ${heights.length} nodes and ${cover.length} cells`)
  for (const kind of ["walk", "shore", "drive"] as const)
    if (4 * wallIds[kind].length !== walls[kind].length)
      throw new Error(
        `tile ${i}_${j}: ${walls[kind].length / 4} ${kind} walls, ${wallIds[kind].length} ids`,
      )
  for (const kind of ["walk", "drive"] as const)
    if (4 * wallLevels[kind].length !== walls[kind].length)
      throw new Error(
        `tile ${i}_${j}: ${walls[kind].length / 4} ${kind} walls, ${wallLevels[kind].length} levels`,
      )
  if (3 * ids.length !== trees.length)
    throw new Error(`tile ${i}_${j}: ${trees.length / 3} trees, ${ids.length} ids`)
  const corner = tileCorner(i, j)
  const json: TileJson = {
    version: MAP_VERSION,
    hash,
    i,
    j,
    walls: {
      walk: walls.walk.length / 4,
      shore: walls.shore.length / 4,
      drive: walls.drive.length / 4,
    },
    trees: trees.length / 3,
    vectors,
  }
  const parts = {
    // file order
    json: Buffer.from(`${JSON.stringify(json)}\n`),
    heightmap: packRows(heights, TILE_NODES, `tile ${i}_${j} heightmap`),
    walk: packWalls(walls.walk, corner, `tile ${i}_${j} walk walls`),
    shore: packWalls(walls.shore, corner, `tile ${i}_${j} shore walls`),
    drive: packWalls(walls.drive, corner, `tile ${i}_${j} drive walls`),
    walkIds: pack(wallIds.walk, 4, 1, `tile ${i}_${j} walk wall ids`),
    shoreIds: pack(wallIds.shore, 4, 1, `tile ${i}_${j} shore wall ids`),
    driveIds: pack(wallIds.drive, 4, 1, `tile ${i}_${j} drive wall ids`),
    trees: packTrees(trees, corner),
    ids: pack(ids, 4, 1, `tile ${i}_${j} tree ids`),
    cover: pack(cover, 1, TILE_CELLS, `tile ${i}_${j} cover`),
    walkLevels: packLevels(wallLevels.walk, `tile ${i}_${j} walk wall levels`),
    driveLevels: packLevels(wallLevels.drive, `tile ${i}_${j} drive wall levels`),
  }
  return {
    file: Buffer.concat(Object.values(parts)),
    sizes: Object.fromEntries(Object.entries(parts).map(([part, b]) => [part, b.length])),
  }
}

/**
 * `file` with its JSON line's keys set to `patch`'s (in place, so the key order stays), the packed
 * sections after it unchanged: what packing it with those values gives (a tile's `hash`, its
 * `vectors`).
 */
export const relined = (file: Uint8Array, patch: object): Buffer => {
  const end = file.indexOf(10)
  const json = JSON.parse(Buffer.from(file.subarray(0, end)).toString()) as Record<string, unknown>
  return Buffer.concat([Buffer.from(JSON.stringify({ ...json, ...patch })), file.subarray(end)])
}
