/**
 * The map files and their decoders (encoders: `src/tools/pack.ts`). A map is a global file,
 * `<name>.bin`, and one file per 2 km tile, `<name>/<i>_<j>.bin` (`TILE` in `./kinds.ts`). Each is
 * gzip of one JSON line, a newline, then packed sections in file order. A section holds n integers as
 * the zigzag-coded difference from the value `stride` places back (from 0 for the first `stride`),
 * split into byte planes: the low byte of every value, then the next byte of every value. Neighbours
 * differ little and like bytes sit together, which is what gzip compresses best.
 *
 * The global file's line is `MonzoneMapJson` (everything sparse: the vectors, the graph, the
 * railway, the tile list, the baked tables); its sections are the coarse grid's heights and cover.
 * A tile's line is `TileJson`; its sections hold the dense layers of its square:
 *
 * | Section | Integers | Bytes | Stride |
 * |---|---|---|---|
 * | heightmap | 501 × 501 nodes, decimetres, each row delta-coded from its first node | 2 | 501 (the node to the south) |
 * | walk, shore, drive walls | (ax, ay, bx, by) decimetres from `packOrigin` (100 m south-west of the tile's corner: bounds walls stick out) | 2 | 2 (the previous x or y) |
 * | walk, shore, drive wall ids | each wall's index in the whole map's list of its kind (the broad phases answer in that order) | 4 | 1 |
 * | trees | (x, y) whole metres from `treeOrigin` (they are planted on whole metres), the scale in hundredths | 2 | 3 (the previous tree) |
 * | tree ids | each tree's index in the whole map's tree list (its look's seed) | 4 | 1 |
 * | cover | 500 × 500 cells, the land-cover index (`./cover.ts`) | 1 | 500 (the cell to the south) |
 *
 * Decoding is exact: every coordinate is an integer number of decimetres divided by 10, the same
 * double JSON would give for a one-decimal number. The sim never fetches: the browser host downloads
 * and gunzips the global file and hands it to `provideMap` before anything imports `./index.ts`, then
 * hands each tile to `provideTile` (`./tiles.ts`); under Node (tests, tools, the Ritmo lint) `mapFile`
 * and the tile store read them from disk.
 *
 * @module map/packed
 */
import type { MonzoneMap, MonzoneMapJson } from "./index.ts"
import { TILE } from "./kinds.ts"

interface Corner {
  readonly minX: number
  readonly minY: number
}

/** The map files' format version (`MonzoneMap.version`): 3 cut the dense layers into tiles and baked the tables built from them. */
export const MAP_VERSION = 3

/** Where wall coordinates count from, decimetres: 100 m south-west of the corner. */
export const packOrigin = (corner: Corner): { readonly x: number; readonly y: number } => ({
  x: Math.round(corner.minX * 10) - 1000,
  y: Math.round(corner.minY * 10) - 1000,
})

/** Where tree coordinates count from, whole metres: `packOrigin` rounded down to the metre. */
export const treeOrigin = (corner: Corner): { readonly x: number; readonly y: number } => {
  const o = packOrigin(corner)
  return { x: Math.floor(o.x / 10), y: Math.floor(o.y / 10) }
}

/** The south-west corner of tile (i, j), m. */
export const tileCorner = (i: number, j: number): Corner => ({ minX: i * TILE, minY: j * TILE })

/** The global file's URL in Node: beside this module, named after the default map. */
export const MAP_URL: URL = new URL("./monzone.bin", import.meta.url)

/** A tile file's URL in Node, `<name>/<key>.bin` beside the global file (the browser host has its own, hashed by Vite: src/maps.ts). */
export const tileUrl = (name: string, key: string): URL => new URL(`${name}/${key}.bin`, MAP_URL)

/** The gunzipped global file the host handed over, until `./global.ts` decodes it. */
let provided: Uint8Array | undefined

/** Hands over the gunzipped global file; the browser host calls it once, before importing `./index.ts`. */
export const provideMap = (bytes: Uint8Array): void => {
  provided = bytes
}

/** Node's fs and zlib, through `process.getBuiltinModule`, so no `node:` import reaches the browser bundle; undefined in a browser. */
const node = () =>
  globalThis.process?.getBuiltinModule === undefined
    ? undefined
    : {
        fs: process.getBuiltinModule("node:fs"),
        zlib: process.getBuiltinModule("node:zlib"),
      }

/** A gzipped map file read from disk and gunzipped (Node only). */
export const readMapFile = (url: URL): Uint8Array => {
  const builtins = node()
  if (builtins === undefined) throw new Error(`map: ${url.pathname} cannot be read here`)
  return builtins.zlib.gunzipSync(builtins.fs.readFileSync(url))
}

/** Whether map files can be read from disk here (Node). */
export const onDisk = (): boolean => node() !== undefined

/**
 * The gunzipped global file, for `./global.ts` to decode once: the bytes given to `provideMap`
 * (released here, so they do not outlive the decoded map), else, in Node, read from `MAP_URL`.
 */
export const mapFile = (): Uint8Array => {
  const file = provided
  provided = undefined
  if (file !== undefined) return file
  if (!onDisk())
    throw new Error(
      "map: the global file is not loaded; the host must call provideMap(bytes) before importing src/sim/map/index.ts",
    )
  return readMapFile(MAP_URL)
}

/** The `n` integers of the section at byte `at`: `size` byte planes of zigzag deltas from the value `stride` back. */
const unpack = (
  file: Uint8Array,
  at: number,
  n: number,
  size: number,
  stride: number,
): Int32Array => {
  const out = new Int32Array(n)
  for (let p = 0; p < size; p++)
    for (let k = 0; k < n; k++) out[k] = out[k]! | (file[at + p * n + k]! << (8 * p)) // plane by plane: a third faster
  for (let k = 0; k < n; k++) {
    const z = out[k]!
    out[k] = ((z >>> 1) ^ -(z & 1)) + (k >= stride ? out[k - stride]! : 0)
  }
  return out
}

/** Nodes in decimetres from rows of `cols` deltas (each row starts absolute). */
const unpackRows = (deltas: Int32Array, cols: number): Int16Array => {
  const out = new Int16Array(deltas.length)
  for (let k = 0; k < out.length; k++)
    out[k] = k % cols === 0 ? deltas[k]! : out[k - 1]! + deltas[k]!
  return out
}

/** Wall segments (ax, ay, bx, by) in metres from decimetres from `packOrigin(corner)`. */
const unpackWalls = (dm: Int32Array, corner: Corner): Float64Array => {
  const out = new Float64Array(dm.length),
    o = packOrigin(corner)
  for (let k = 0; k < dm.length; k++) out[k] = (dm[k]! + (k % 2 === 0 ? o.x : o.y)) / 10
  return out
}

/** Trees (x, y, scale): whole metres from `treeOrigin(corner)`, the scale in hundredths. */
const unpackTrees = (w: Int32Array, corner: Corner): Float64Array => {
  const out = new Float64Array(w.length),
    o = treeOrigin(corner)
  for (let k = 0; k < w.length; k++) {
    const c = k % 3
    out[k] = c === 2 ? w[k]! / 100 : w[k]! + (c === 0 ? o.x : o.y)
  }
  return out
}

/** A file's JSON line and a reader of its sections in file order, which checks they end with the file. */
const sectionsOf = (file: Uint8Array, what: string) => {
  const line = file.indexOf(10) // JSON.stringify escapes every newline inside strings
  const json: unknown = JSON.parse(new TextDecoder().decode(file.subarray(0, line)))
  const version = (json as { readonly version?: unknown }).version
  if (version !== MAP_VERSION)
    throw new Error(
      `map: ${what} is version ${String(version)}, this decoder reads ${MAP_VERSION}; run pnpm map`,
    )
  let at = line + 1
  return {
    json,
    section: (n: number, size: number, stride: number): Int32Array => {
      const values = unpack(file, at, n, size, stride)
      at += n * size
      return values
    },
    end: () => {
      if (at !== file.length)
        throw new Error(
          `map: ${what}'s sections end at byte ${at} of ${file.length}; the file and this decoder disagree`,
        )
    },
  }
}

/** The global map from its gunzipped file: the JSON line, then the coarse grid's heights and cover. */
export const decodeMap = (file: Uint8Array): MonzoneMap => {
  const { json: line, section, end } = sectionsOf(file, "the global map file")
  const json = line as MonzoneMapJson
  const { cols, rows } = json.coarse
  const heights = unpackRows(section(cols * rows, 2, cols), cols)
  const cover = Uint8Array.from(section(cols * rows, 1, cols))
  end()
  return { ...json, coarse: { ...json.coarse, heights, cover } }
}

/** Nodes along a tile's side (its border nodes are its neighbours' too). */
export const TILE_NODES = 501
/** Land-cover cells along a tile's side. */
export const TILE_CELLS = 500

/** A tile file's JSON line: the build it belongs to, which tile it is, and how many walls and trees its sections hold. */
export interface TileJson {
  readonly version: number
  /** `MonzoneMap.hash` of the build that wrote it: a tile from another build is refused. */
  readonly hash: string
  readonly i: number
  readonly j: number
  readonly walls: { readonly walk: number; readonly shore: number; readonly drive: number }
  readonly trees: number
}

/** A decoded tile: its square's terrain nodes, walls, trees and land cover. */
export interface TileData {
  readonly hash: string
  readonly i: number
  readonly j: number
  /** `TILE_NODES` × `TILE_NODES` nodes, decimetres, row-major from the south-west corner; outside the map's bounds, the edge extended. */
  readonly heights: Int16Array
  /** Flat (ax, ay, bx, by) segments, m, each in the tile holding its midpoint, in the whole map's order. */
  readonly walls: {
    readonly walk: Float64Array
    readonly shore: Float64Array
    readonly drive: Float64Array
  }
  /** Each wall's index in the whole map's list of its kind. */
  readonly wallIds: {
    readonly walk: Int32Array
    readonly shore: Int32Array
    readonly drive: Int32Array
  }
  /** Flat (x, y, scale) triples of the trees standing in the tile, in the whole map's order. */
  readonly trees: Float64Array
  /** Each tree's index in the whole map's list. */
  readonly ids: Int32Array
  /** `TILE_CELLS` × `TILE_CELLS` land-cover indices, row-major from the south-west cell (0 past the map's bounds, never read). */
  readonly cover: Uint8Array
}

/** A tile from its gunzipped file. */
export const decodeTile = (file: Uint8Array): TileData => {
  const { json, section, end } = sectionsOf(file, "a tile file")
  const { hash, i, j, walls, trees } = json as TileJson
  const corner = tileCorner(i, j)
  const heights = unpackRows(section(TILE_NODES * TILE_NODES, 2, TILE_NODES), TILE_NODES)
  const walk = unpackWalls(section(4 * walls.walk, 2, 2), corner)
  const shore = unpackWalls(section(4 * walls.shore, 2, 2), corner)
  const drive = unpackWalls(section(4 * walls.drive, 2, 2), corner)
  const wallIds = {
    walk: section(walls.walk, 4, 1),
    shore: section(walls.shore, 4, 1),
    drive: section(walls.drive, 4, 1),
  }
  const treeData = unpackTrees(section(3 * trees, 2, 3), corner)
  const ids = section(trees, 4, 1)
  const cover = Uint8Array.from(section(TILE_CELLS * TILE_CELLS, 1, TILE_CELLS))
  end()
  return {
    hash,
    i,
    j,
    heights,
    walls: { walk, shore, drive },
    wallIds,
    trees: treeData,
    ids,
    cover,
  }
}
