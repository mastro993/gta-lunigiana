// Encoders of the map files (before gzip); the format and the decoders (`decodeMap`, `decodeTile`)
// are in src/sim/map/packed.ts. Every value must fit its section, or the build throws.
import type { MonzoneMap, MonzoneMapJson } from "../sim/map/index.ts"
import {
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

/** `values` as `size` byte planes of zigzag deltas from the value `stride` back, each an int32 whose delta fits. */
const pack = (values: ArrayLike<number>, size: 1 | 2 | 4, stride: number, what: string): Buffer => {
  const n = values.length,
    out = Buffer.alloc(n * size)
  for (let k = 0; k < n; k++) {
    const v = values[k]!,
      d = v - (k >= stride ? values[k - stride]! : 0),
      z = d < 0 ? -2 * d - 1 : 2 * d
    if (!Number.isInteger(v) || v < -(2 ** 31) || v >= 2 ** 31)
      throw new Error(`${what}: ${v} at ${k} is not an int32`)
    if (z >= 2 ** (8 * size))
      throw new Error(
        `${what}: ${v} at ${k} is ${d} from the value ${stride} back, too far for ${size} bytes`,
      )
    for (let p = 0; p < size; p++) out[p * n + k] = Math.floor(z / 256 ** p) % 256
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

/** The gunzipped global file `decodeMap` reads back into `map`, and the bytes of each of its parts. */
export const packMap = (
  map: MonzoneMap,
): { readonly file: Buffer; readonly sizes: Readonly<Record<string, number>> } => {
  const {
    coarse: { heights, cover, ...coarse },
  } = map
  const json: MonzoneMapJson = { ...map, version: MAP_VERSION, coarse }
  const parts = {
    // file order
    json: Buffer.from(`${JSON.stringify(json)}\n`),
    heights: packRows(heights, coarse.cols, "coarse heights"),
    cover: pack(cover, 1, coarse.cols, "coarse cover"),
  }
  return {
    file: Buffer.concat(Object.values(parts)),
    sizes: Object.fromEntries(Object.entries(parts).map(([part, b]) => [part, b.length])),
  }
}

/** The gunzipped tile file `decodeTile` reads back into `tile`, and the bytes of each of its parts. */
export const packTile = (
  tile: Omit<TileData, "heights" | "cover"> & {
    readonly heights: ArrayLike<number>
    readonly cover: ArrayLike<number>
  },
): { readonly file: Buffer; readonly sizes: Readonly<Record<string, number>> } => {
  const { hash, i, j, heights, walls, wallIds, trees, ids, cover } = tile
  if (heights.length !== TILE_NODES * TILE_NODES || cover.length !== TILE_CELLS * TILE_CELLS)
    throw new Error(`tile ${i}_${j}: ${heights.length} nodes and ${cover.length} cells`)
  for (const kind of ["walk", "shore", "drive"] as const)
    if (4 * wallIds[kind].length !== walls[kind].length)
      throw new Error(
        `tile ${i}_${j}: ${walls[kind].length / 4} ${kind} walls, ${wallIds[kind].length} ids`,
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
  }
  return {
    file: Buffer.concat(Object.values(parts)),
    sizes: Object.fromEntries(Object.entries(parts).map(([part, b]) => [part, b.length])),
  }
}
