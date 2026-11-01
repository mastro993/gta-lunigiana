// Reads a map from disk whole (Node only): its global file and every tile it lists, joined back
// into one heightmap, wall list, tree list, land-cover raster and list of each layer of vectors
// (`joinTiles`, the cut of tile-map.ts undone). The tools that draw or compare a whole map and the
// map tests read it this way. A region's map as built, a test region's too, is handed to the sim
// with `loadBuiltMap`.
import type { Area, Barrier, Building, MonzoneMap, Road, Water } from "../sim/map/index.ts"
import { TILE, tileKey } from "../sim/map/kinds.ts"
import {
  decodeMap,
  decodeTile,
  MAP_URL,
  MAP_VERSION,
  provideMap,
  readMapFile,
  TILE_CELLS,
  TILE_NODES,
  type Layer,
  type TileData,
  type TileVectors,
  type VectorLayer,
} from "../sim/map/packed.ts"
import { relined } from "./pack.ts"
import { mapDir, type Region } from "./region.ts"
import { mergeTrees } from "./trees.ts"

/** The whole map joined back from its global map and tiles: the dense layers and the vectors whole again, next to everything global. */
export interface JoinedMap extends Omit<
  MonzoneMap,
  "heightmap" | "walls" | "vectors" | "derived" | "roads"
> {
  /** Every road, its attributes (global) and its line (the tiles'). */
  readonly roads: ReadonlyArray<Road>
  readonly buildings: ReadonlyArray<Building>
  readonly water: ReadonlyArray<Water>
  readonly areas: ReadonlyArray<Area>
  readonly barriers: ReadonlyArray<Barrier>
  /** `cols` × `rows` nodes, decimetres, row-major from the south-west node. */
  readonly heightmap: MonzoneMap["heightmap"] & { readonly data: ArrayLike<number> }
  /** The global walls' broad-phase facts, and every flat (ax, ay, bx, by) wall in the whole map's order. */
  readonly walls: MonzoneMap["walls"] & {
    readonly walk: ArrayLike<number>
    readonly shore: ArrayLike<number>
    readonly drive: ArrayLike<number>
  }
  /** Flat (x, y, scale) triples in the whole map's order: by id. */
  readonly trees: ArrayLike<number>
  /** Each tree's id (its look's seed, trees.ts), ascending. */
  readonly treeIds: ArrayLike<number>
  /** Every land-cover cell, `(cols − 1) × (rows − 1)`. */
  readonly cover: ArrayLike<number>
}

/**
 * The whole map back from the global map and its decoded tiles: what the tools and the map tests
 * read. `vectors` are the layers of a build before the vectors' cut, which its global file held
 * (`readWholeMap`); else they are joined from the tiles.
 */
export const joinTiles = (
  global: MonzoneMap,
  tiles: ReadonlyArray<TileData>,
  vectors?: Pick<JoinedMap, VectorLayer>,
): JoinedMap => {
  const { cell, cols, rows, x0, y0 } = global.heightmap
  const n = TILE / cell,
    cx = Math.round(x0 / cell),
    cy = Math.round(y0 / cell)
  const data = new Int16Array(cols * rows),
    cover = new Uint8Array((cols - 1) * (rows - 1))
  const byKey = new Map(tiles.map((t) => [tileKey(t.i, t.j), t]))
  const listed = global.tiles.map(({ i, j }) => {
    const t = byKey.get(tileKey(i, j))
    if (t === undefined) throw new Error(`join: tile ${tileKey(i, j)} missing`)
    if (t.hash !== global.hash)
      throw new Error(
        `join: tile ${tileKey(i, j)} is from another build (${t.hash}, not ${global.hash})`,
      )
    return t
  })
  const flat = (kind: "walk" | "shore" | "drive") => {
    const out = new Float64Array(listed.reduce((sum, t) => sum + t.walls[kind].length, 0))
    for (const t of listed)
      t.wallIds[kind].forEach((id, k) => out.set(t.walls[kind].subarray(4 * k, 4 * k + 4), 4 * id))
    return out
  }
  for (const t of listed) {
    const { i, j } = t
    for (let r = 0; r < TILE_NODES; r++)
      for (let c = 0; c < TILE_NODES; c++) {
        const gi = n * i + c - cx,
          gj = n * j + r - cy
        if (gi >= 0 && gi < cols && gj >= 0 && gj < rows)
          data[gj * cols + gi] = t.heights[r * TILE_NODES + c]!
      }
    for (let r = 0; r < TILE_CELLS; r++)
      for (let c = 0; c < TILE_CELLS; c++) {
        const ci = n * i + c - cx,
          cj = n * j + r - cy
        if (ci >= 0 && ci < cols - 1 && cj >= 0 && cj < rows - 1)
          cover[cj * (cols - 1) + ci] = t.cover[r * TILE_CELLS + c]!
      }
  }
  const { trees, ids } = mergeTrees(listed)
  const { heightmap, vectors: _, derived: __, ...rest } = global
  return {
    ...rest,
    ...(vectors ?? joinVectors(global, listed)),
    heightmap: { ...heightmap, data },
    walls: { ...global.walls, walk: flat("walk"), shore: flat("shore"), drive: flat("drive") },
    trees,
    treeIds: ids,
    cover,
  }
}

/**
 * Each layer of vectors back in the whole map's order from the tiles holding its features (the first
 * that holds one: every copy is the same), each road its global attributes with its line.
 */
const joinVectors = (
  global: MonzoneMap,
  listed: ReadonlyArray<TileData>,
): Pick<JoinedMap, VectorLayer> => {
  const layer = <T>(name: VectorLayer, of: (v: TileVectors) => Layer<T>): Array<T> => {
    const out: Array<T | undefined> = Array.from({ length: global.vectors.counts[name] })
    for (const t of listed) {
      const { ids, items } = of(t.vectors)
      ids.forEach((id, k) => (out[id] ??= items[k]))
    }
    return out.map((item, k) => {
      if (item === undefined) throw new Error(`join: ${name} ${k} is in no tile`)
      return item
    })
  }
  return {
    roads: layer("roads", (v) => v.roads).map((line, k) => ({ ...global.roads[k]!, ...line })),
    buildings: layer("buildings", (v) => v.buildings),
    water: layer("water", (v) => v.water),
    areas: layer("areas", (v) => v.areas),
    barriers: layer("barriers", (v) => v.barriers),
  }
}

/** The map whose global file is at `url` (its tiles in the directory named after it beside it), whole. */
export const readWholeMap = (url: URL): JoinedMap => {
  const file = readMapFile(url)
  // A build before the vectors' cut (version 3, issue #63) holds them all in its global file and
  // none in its tiles: read as one, so map-diff compares it with a tiled build.
  const line = JSON.parse(new TextDecoder().decode(file.subarray(0, file.indexOf(10)))) as {
    readonly version?: unknown
  } & Pick<JoinedMap, VectorLayer>
  const v3 = line.version === 3,
    read = (f: Uint8Array) => (v3 ? relined(f, { version: MAP_VERSION }) : f)
  const global = decodeMap(read(file))
  const { roads, buildings, water, areas, barriers } = line
  return joinTiles(
    global,
    global.tiles.map(({ i, j }) =>
      decodeTile(read(readMapFile(new URL(`${global.name}/${tileKey(i, j)}.bin`, url)))),
    ),
    v3 ? { roads, buildings, water, areas, barriers } : undefined,
  )
}

const read = new Map<string, JoinedMap>()
/** The shipped map `name` (`monzone`, `cesena`) whole, read once per process. */
export const wholeMap = (name = "monzone"): JoinedMap => {
  let map = read.get(name)
  if (map === undefined) {
    map = readWholeMap(new URL(`${name}.bin`, MAP_URL))
    read.set(name, map)
  }
  return map
}

/** Where `region`'s global file is built: in src/sim/map, or a test region's in test-maps (its tiles in the directory named after it beside it). */
export const builtMapUrl = (region: Region): URL =>
  new URL(`../../${mapDir(region)}/${region.file}.bin`, import.meta.url)

/**
 * Hands the sim `region`'s map as built: its global file, and its tiles as a lookup finds them
 * missing. Call it before anything imports src/sim/map/index.ts.
 */
export const loadBuiltMap = async (region: Region): Promise<void> => {
  const url = builtMapUrl(region)
  provideMap(readMapFile(url))
  const { setTileSource } = await import("../sim/map/tiles.ts")
  setTileSource((key) => readMapFile(new URL(`${region.file}/${key}.bin`, url)))
}
