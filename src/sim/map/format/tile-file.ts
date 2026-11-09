/**
 * A tile file, `<name>/<i>_<j>.bin` (docs/map.md, "A tile"): its line is `TileJson`, which holds the
 * vectors round its square (`TileVectors`, as JSON: their doubles come back exact); its sections,
 * `TILE_LAYOUT`, hold the dense layers of its square. Decoding is exact: every wall coordinate and level is
 * an integer number of decimetres divided by 10, the same double JSON would give for a one-decimal
 * number. The host hands each tile to `provideTile` (`../tiles.ts`).
 *
 * @module map/format/tile-file
 */
import type { Area, Barrier, Building, RoadLine, Water } from "../index.ts"
import { TILE } from "../kinds.ts"
import {
  decodeFile,
  encodeFile,
  fromRowDeltas,
  type Layout,
  lineOf,
  MAP_VERSION,
  relined,
  rowDeltas,
  type Section,
} from "./sections.ts"

/** Nodes along a tile's side (its border nodes are its neighbours' too). */
export const TILE_NODES = 501
/** Land-cover cells along a tile's side. */
export const TILE_CELLS = 500

/** The layers of vectors the tiles hold (`TileVectors`). */
export const VECTOR_LAYERS = ["roads", "buildings", "water", "areas", "barriers"] as const
/** A layer of vectors. */
export type VectorLayer = (typeof VECTOR_LAYERS)[number]

/** A tile's features of one layer: each one's index in the whole map's list (ascending), and the feature. */
export interface Layer<T> {
  readonly ids: ReadonlyArray<number>
  readonly items: ReadonlyArray<T>
}

/**
 * The vectors a tile holds: every road line, river, barrier, building and area with a segment (a
 * ring's box) within `HALO` of its square (on the map's edge tiles, beyond the edge too; for an
 * unlisted tile round it, a listed one round that holds them), whole, in the whole map's order.
 */
export interface TileVectors {
  readonly roads: Layer<RoadLine>
  readonly buildings: Layer<Building>
  readonly water: Layer<Water>
  readonly areas: Layer<Area>
  readonly barriers: Layer<Barrier>
}

/** A tile file's JSON line: the build it belongs to, which tile it is, how many walls and trees its sections hold, and its vectors. */
interface TileJson {
  readonly version: number
  /** `MonzoneMap.hash` of the build that wrote it: a tile from another build is refused. */
  readonly hash: string
  readonly i: number
  readonly j: number
  readonly walls: { readonly walk: number; readonly shore: number; readonly drive: number }
  readonly trees: number
  readonly vectors: TileVectors
}

/** A decoded tile: its square's terrain nodes, walls, trees and land cover, and the vectors round it. */
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
  /** Each walk and drive wall's level, m a.s.l. (a bridge's parapet's: its deck's top), NaN for one that stands at every level; the shore's have none. */
  readonly wallLevels: { readonly walk: Float64Array; readonly drive: Float64Array }
  /** Flat (x, y, scale) triples of the trees standing in the tile, in the whole map's order. */
  readonly trees: Float64Array
  /** Each tree's id (its lattice cell's number, or its bank cell's past them; src/tools/trees.ts), ascending. */
  readonly ids: Int32Array
  /** `TILE_CELLS` × `TILE_CELLS` land-cover indices, row-major from the south-west cell (0 past the map's bounds, never read). */
  readonly cover: Uint8Array
  readonly vectors: TileVectors
}

/** What a tile file is packed from: a decoded tile, its dense layers as any arrays of numbers. */
type TileInput = Omit<TileData, "heights" | "cover" | "wallLevels"> & {
  readonly heights: ArrayLike<number>
  readonly cover: ArrayLike<number>
  readonly wallLevels: { readonly walk: ArrayLike<number>; readonly drive: ArrayLike<number> }
}

/** A wall's level in a tile file where it has none, and stands at every level: below any ground (int16's least, decimetres). */
const NO_LEVEL = -32768

/** Where a tile's wall coordinates count from, decimetres: 100 m south-west of its corner (outline walls stick out). */
const wallOrigin = (line: TileJson): { readonly x: number; readonly y: number } => ({
  x: Math.round(line.i * TILE * 10) - 1000,
  y: Math.round(line.j * TILE * 10) - 1000,
})

/** Where a tile's tree coordinates count from, whole metres (they are planted on whole metres): `wallOrigin` rounded down to the metre. */
const treeOrigin = (line: TileJson): { readonly x: number; readonly y: number } => {
  const o = wallOrigin(line)
  return { x: Math.floor(o.x / 10), y: Math.floor(o.y / 10) }
}

type WallKind = keyof TileData["walls"]

/** A kind's walls: (ax, ay, bx, by) in decimetres from `wallOrigin`, each delta from the previous x or y. */
const walls = (kind: WallKind): Section<TileInput, TileJson, Float64Array> => ({
  label: `${kind} walls`,
  bytes: 2,
  stride: 2,
  count: (line) => 4 * line.walls[kind],
  encode: (tile, line) => {
    const o = wallOrigin(line)
    return Array.from(tile.walls[kind], (v, k) => Math.round(v * 10) - (k % 2 === 0 ? o.x : o.y))
  },
  decode: (dm, line) => {
    const out = new Float64Array(dm.length),
      o = wallOrigin(line)
    for (let k = 0; k < dm.length; k++) out[k] = (dm[k]! + (k % 2 === 0 ? o.x : o.y)) / 10
    return out
  },
})

/** A kind's wall ids: each wall's index in the whole map's list of its kind (the broad phases answer in that order). */
const wallIds = (kind: WallKind): Section<TileInput, TileJson, Int32Array> => ({
  label: `${kind} wall ids`,
  bytes: 4,
  stride: 1,
  count: (line) => line.walls[kind],
  encode: (tile) => tile.wallIds[kind],
  decode: (ids) => ids,
})

/** A kind's wall levels (m a.s.l., NaN for none) in decimetres, `NO_LEVEL` for none: each must fit int16 above it, as the terrain does. */
const wallLevels = (
  kind: keyof TileData["wallLevels"],
): Section<TileInput, TileJson, Float64Array> => ({
  label: `${kind} wall levels`,
  bytes: 4,
  stride: 1,
  count: (line) => line.walls[kind],
  encode: (tile, _, what) =>
    Array.from(tile.wallLevels[kind], (v, k) => {
      if (Number.isNaN(v)) return NO_LEVEL
      const dm = Math.round(v * 10)
      if (dm <= NO_LEVEL || dm > 32767) throw new Error(`${what}: ${v} at ${k} does not fit int16`)
      return dm
    }),
  decode: (dm) => Float64Array.from(dm, (v) => (v === NO_LEVEL ? NaN : v / 10)),
})

/** A tile file's sections, in file order (docs/map.md, "A tile"). */
const TILE_LAYOUT = {
  /** 501 × 501 nodes, each row delta-coded from its first node, then from the node to the south. */
  heightmap: {
    label: "heightmap",
    bytes: 2,
    stride: TILE_NODES,
    count: () => TILE_NODES * TILE_NODES,
    encode: (tile, _, what) => rowDeltas(tile.heights, TILE_NODES, what),
    decode: (deltas) => fromRowDeltas(deltas, TILE_NODES),
  },
  walk: walls("walk"),
  shore: walls("shore"),
  drive: walls("drive"),
  walkIds: wallIds("walk"),
  shoreIds: wallIds("shore"),
  driveIds: wallIds("drive"),
  /** (x, y) whole metres from `treeOrigin`, the scale in hundredths, each from the previous tree's. */
  trees: {
    label: "trees",
    bytes: 2,
    stride: 3,
    count: (line) => 3 * line.trees,
    encode: (tile, line) => {
      const o = treeOrigin(line)
      return Array.from(tile.trees, (v, k) => {
        const c = k % 3
        return c === 2 ? Math.round(v * 100) : v - (c === 0 ? o.x : o.y)
      })
    },
    decode: (w, line) => {
      const out = new Float64Array(w.length),
        o = treeOrigin(line)
      for (let k = 0; k < w.length; k++) {
        const c = k % 3
        out[k] = c === 2 ? w[k]! / 100 : w[k]! + (c === 0 ? o.x : o.y)
      }
      return out
    },
  },
  /** Each tree's id, ascending: its look's seed (its lattice cell's number, src/tools/trees.ts). */
  ids: {
    label: "tree ids",
    bytes: 4,
    stride: 1,
    count: (line) => line.trees,
    encode: (tile) => tile.ids,
    decode: (ids) => ids,
  },
  /** 500 × 500 cells' land-cover index (`../cover.ts`), from the cell to the south. */
  cover: {
    label: "cover",
    bytes: 1,
    stride: TILE_CELLS,
    count: () => TILE_CELLS * TILE_CELLS,
    encode: (tile) => tile.cover,
    decode: (cover) => Uint8Array.from(cover),
  },
  walkLevels: wallLevels("walk"),
  driveLevels: wallLevels("drive"),
} satisfies Layout<TileInput, TileJson>

/** The gunzipped tile file `decodeTile` reads back into `tile`, and the bytes of its line (`json`) and of each section. */
export const encodeTile = (
  tile: TileInput,
): { readonly file: Uint8Array; readonly sizes: Readonly<Record<string, number>> } => {
  const { hash, i, j, walls, trees, vectors } = tile
  const line: TileJson = {
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
  return encodeFile(TILE_LAYOUT, line, tile, `tile ${i}_${j} `)
}

/** A tile from its gunzipped file. */
export const decodeTile = (file: Uint8Array): TileData => {
  const { line, values } = decodeFile<TileJson, typeof TILE_LAYOUT>(
    file,
    TILE_LAYOUT,
    "a tile file",
  )
  return {
    hash: line.hash,
    i: line.i,
    j: line.j,
    heights: values.heightmap,
    walls: { walk: values.walk, shore: values.shore, drive: values.drive },
    wallIds: { walk: values.walkIds, shore: values.shoreIds, drive: values.driveIds },
    wallLevels: { walk: values.walkLevels, drive: values.driveLevels },
    trees: values.trees,
    ids: values.ids,
    cover: values.cover,
    vectors: line.vectors,
  }
}

/** A tile's vectors alone from its gunzipped file, with which tile and build it is: its sections are left unread. */
export const decodeTileVectors = (
  file: Uint8Array,
): Pick<TileJson, "hash" | "i" | "j" | "vectors"> => lineOf(file, "a tile file") as TileJson

/** A tile file with its build hash or its vectors set, its sections unchanged: what `encodeTile` gives with them. */
export const relineTile = (
  file: Uint8Array,
  patch: Partial<Pick<TileJson, "hash" | "vectors">>,
): Uint8Array => relined(file, patch)
