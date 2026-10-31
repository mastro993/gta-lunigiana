// Reads a map from disk whole (Node only): its global file and every tile it lists, joined back
// into one heightmap, wall list, tree list and land-cover raster (`joinTiles`, the cut of
// tile-map.ts undone). The tools that draw or compare a whole map and the map tests read it this
// way. A region's map as built, a test region's too, is handed to the sim with `loadBuiltMap`.
import type { MonzoneMap } from "../sim/map/index.ts"
import { TILE, tileKey } from "../sim/map/kinds.ts"
import {
  decodeMap,
  decodeTile,
  MAP_URL,
  provideMap,
  readMapFile,
  TILE_CELLS,
  TILE_NODES,
  type TileData,
} from "../sim/map/packed.ts"
import { mapDir, type Region } from "./region.ts"
import { mergeTrees } from "./trees.ts"

/** The whole map joined back from its global map and tiles: the dense layers whole again, next to everything global. */
export interface JoinedMap extends Omit<MonzoneMap, "heightmap" | "walls"> {
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

/** The whole map back from the global map and its decoded tiles: what the tools and the map tests read. */
export const joinTiles = (global: MonzoneMap, tiles: ReadonlyArray<TileData>): JoinedMap => {
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
  const { heightmap, ...rest } = global
  return {
    ...rest,
    heightmap: { ...heightmap, data },
    walls: { ...global.walls, walk: flat("walk"), shore: flat("shore"), drive: flat("drive") },
    trees,
    treeIds: ids,
    cover,
  }
}

/** The map whose global file is at `url` (its tiles in the directory named after it beside it), whole. */
export const readWholeMap = (url: URL): JoinedMap => {
  const global = decodeMap(readMapFile(url))
  return joinTiles(
    global,
    global.tiles.map(({ i, j }) =>
      decodeTile(readMapFile(new URL(`${global.name}/${tileKey(i, j)}.bin`, url))),
    ),
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
