/**
 * A tile file, `<name>/<i>_<j>.bin` (docs/map.md, "A tile"): its line is `TileJson`, which holds the
 * vectors round its square (`TileVectors`, as JSON: their doubles come back exact) with a vertex
 * count in place of each of their xy arrays; its sections, `TILE_LAYOUT`, hold those coordinates
 * first, then the dense layers of its square. Decoding is exact: every vector and wall coordinate
 * and every wall level is an integer number of decimetres divided by 10, the same double JSON would
 * give for a one-decimal number. The host hands each tile to `provideTile` (`../tiles.ts`).
 *
 * @module map/format/tile-file
 */
import type { Area, Barrier, Building, RoadLine, Water } from "../index.ts"
import { TILE } from "../kinds.ts"
import {
  decodeFile,
  decodeHead,
  encodeFile,
  fromRowDeltas,
  type Layout,
  lineOf,
  MAP_VERSION,
  onGrid,
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

/** `TileVectors` with each xy array (a road's, a river's and a barrier's `pts`, a building's `outer` and `holes`, an area's `rings`) a `P`. */
interface VectorsWith<P> {
  readonly roads: Layer<Omit<RoadLine, "pts"> & { readonly pts: P }>
  readonly buildings: Layer<
    Omit<Building, "outer" | "holes"> & { readonly outer: P; readonly holes?: ReadonlyArray<P> }
  >
  readonly water: Layer<Omit<Water, "pts"> & { readonly pts: P }>
  readonly areas: Layer<Omit<Area, "rings"> & { readonly rings: ReadonlyArray<P> }>
  readonly barriers: Layer<Omit<Barrier, "pts"> & { readonly pts: P }>
}

/**
 * `vectors` with each xy array what `xy` makes of it, called in the order the coordinates section
 * holds them: layer by layer (`VECTOR_LAYERS`), feature by feature, a building's outer ring before
 * its holes. Every feature keeps its keys in their order (a building's `holes` are its last).
 */
const mapXy = <A, B>(vectors: VectorsWith<A>, xy: (a: A) => B): VectorsWith<B> => {
  const { roads, buildings, water, areas, barriers } = vectors
  return {
    roads: { ...roads, items: roads.items.map((f) => ({ ...f, pts: xy(f.pts) })) },
    buildings: {
      ...buildings,
      items: buildings.items.map(({ holes, ...f }) => ({
        ...f,
        outer: xy(f.outer),
        ...(holes === undefined ? {} : { holes: holes.map((h) => xy(h)) }),
      })),
    },
    water: { ...water, items: water.items.map((f) => ({ ...f, pts: xy(f.pts) })) },
    areas: {
      ...areas,
      items: areas.items.map((f) => ({ ...f, rings: f.rings.map((r) => xy(r)) })),
    },
    barriers: { ...barriers, items: barriers.items.map((f) => ({ ...f, pts: xy(f.pts) })) },
  }
}

/** A tile file's JSON line: the build it belongs to, which tile it is, how many walls, trees and vector coordinates its sections hold, and its vectors, each xy array's vertex count in its place. */
interface TileJson {
  readonly version: number
  /** `MonzoneMap.hash` of the build that wrote it: a tile from another build is refused. */
  readonly hash: string
  readonly i: number
  readonly j: number
  readonly walls: { readonly walk: number; readonly shore: number; readonly drive: number }
  readonly trees: number
  readonly coordinates: number
  readonly vectors: VectorsWith<number>
}

/** The line's `coordinates` and `vectors` for `vectors`: each xy array's vertex count in its place; an array of an odd length throws. */
const vectorsLine = (
  vectors: TileVectors,
  what: string,
): Pick<TileJson, "coordinates" | "vectors"> => {
  let coordinates = 0
  const counted = mapXy(vectors, (xy) => {
    if (xy.length % 2 !== 0) throw new Error(`${what}: an xy array of ${xy.length} values`)
    coordinates += xy.length
    return xy.length / 2
  })
  return { coordinates, vectors: counted }
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

/** Where a tile's wall and vector coordinates count from, decimetres: 100 m south-west of its corner (outline walls stick out). */
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

/**
 * Every xy array of the vectors in `mapXy`'s order, each vertex (x, y) in decimetres from
 * `wallOrigin`, each from the previous x or y: 4 bytes, as a feature lies whole in every tile it
 * comes near and an area reaches kilometres past its tile. It decodes, with the line's vectors, into
 * the vectors whole.
 */
const COORDINATES: Section<Pick<TileInput, "vectors">, TileJson, TileVectors> = {
  label: "coordinates",
  bytes: 4,
  stride: 2,
  count: (line) => line.coordinates,
  encode: (tile, line, what) => {
    const o = wallOrigin(line),
      all: Array<number> = []
    mapXy(tile.vectors, (xy) => {
      for (const v of xy) all.push(v)
    })
    return onGrid(all, 10, "decimetres", what).map((dm, k) => dm - (k % 2 === 0 ? o.x : o.y))
  },
  decode: (dm, line) => {
    const o = wallOrigin(line)
    let at = 0
    const vectors = mapXy(line.vectors, (n) => {
      const xy: Array<number> = []
      for (const stop = at + 2 * n; at < stop; at++)
        xy.push((dm[at]! + (at % 2 === 0 ? o.x : o.y)) / 10)
      // of its length, as `JSON.parse` gives it: a pushed array keeps up to half its length again spare
      return xy.slice()
    })
    if (at !== dm.length)
      throw new Error(
        `map: tile ${line.i}_${line.j}'s vectors hold ${at} of its ${dm.length} coordinates`,
      )
    return vectors
  },
}

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

/** A tile file's sections, in file order (docs/map.md, "A tile"): the vectors' coordinates first, so the vectors decode alone (`decodeTileVectors`). */
const TILE_LAYOUT = {
  coordinates: COORDINATES,
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
  const { hash, i, j, walls, trees, vectors } = tile,
    prefix = `tile ${i}_${j} `
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
    ...vectorsLine(vectors, `${prefix}coordinates`),
  }
  return encodeFile(TILE_LAYOUT, line, tile, prefix)
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
    vectors: values.coordinates,
  }
}

/** The sections `decodeTileVectors` reads: the first. */
const VECTORS_HEAD = { coordinates: COORDINATES }

/** A tile's vectors alone from its gunzipped file, with which tile and build it is: its line and its coordinates read, its dense layers left unread. */
export const decodeTileVectors = (
  file: Uint8Array,
): Pick<TileData, "hash" | "i" | "j" | "vectors"> => {
  const { line, values } = decodeHead<TileJson, typeof VECTORS_HEAD>(
    file,
    VECTORS_HEAD,
    "a tile file",
  )
  return { hash: line.hash, i: line.i, j: line.j, vectors: values.coordinates }
}

/**
 * A tile file with its build hash or its vectors set, its dense layers' sections unchanged: what
 * `encodeTile` gives with them. New vectors write its line and its coordinates again; a hash alone,
 * its line.
 */
export const relineTile = (
  file: Uint8Array,
  { vectors, ...patch }: Partial<Pick<TileData, "hash" | "vectors">>,
): Uint8Array => {
  if (vectors === undefined) return relined(file, patch)
  const old = lineOf(file, "a tile file") as TileJson,
    prefix = `tile ${old.i}_${old.j} `,
    line: TileJson = { ...old, ...patch, ...vectorsLine(vectors, `${prefix}coordinates`) },
    head = encodeFile(VECTORS_HEAD, line, { vectors }, prefix).file,
    dense = file.subarray(file.indexOf(10) + 1 + COORDINATES.bytes * old.coordinates),
    out = new Uint8Array(head.length + dense.length)
  out.set(head)
  out.set(dense, head.length)
  return out
}
