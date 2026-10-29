// Cuts the map the build makes (one heightmap, every wall and tree, the land cover rasterised once)
// into the global map and its 2 km tiles (src/sim/map/packed.ts), and joins them back for the tools
// that read a whole map (map-diff, preview-map, the map tests). The cut is exact: joining the tiles
// gives back every node, wall, tree and cover cell, in order.
import { createHash } from "node:crypto"

import type { MonzoneMap, Spawn, Water } from "../sim/map/index.ts"
import { TILE, tileKey, tileRange } from "../sim/map/kinds.ts"
import { TILE_CELLS, TILE_NODES, type TileData } from "../sim/map/packed.ts"
import { placeFrom } from "../sim/sky/place.ts"
import { packMap, packTile } from "./pack.ts"

/** The map as the build makes it: the global map's sparse parts with the dense layers whole, before the tables baked from them. */
export interface BuiltMap extends Omit<
  MonzoneMap,
  | "name"
  | "hash"
  | "heightmap"
  | "tiles"
  | "place"
  | "coarse"
  | "walls"
  | "water"
  | "spawns"
  | "lanes"
  | "farms"
  | "lamps"
> {
  /** `cols` × `rows` nodes, decimetres, row-major from the south-west node (x0, y0). */
  readonly heightmap: MonzoneMap["heightmap"] & { readonly data: ArrayLike<number> }
  readonly walls: {
    readonly walk: ArrayLike<number>
    readonly shore: ArrayLike<number>
    readonly drive: ArrayLike<number>
  }
  /** Flat (x, y, scale) triples. */
  readonly trees: ArrayLike<number>
  /** Every land-cover cell (`rasterCover`), `(cols − 1) × (rows − 1)`. */
  readonly cover: ArrayLike<number>
  readonly water: ReadonlyArray<Omit<Water, "floor">>
  readonly spawns: { readonly player: Spawn; readonly parked: ReadonlyArray<Spawn> }
}

/** The tables the build bakes from the dense layers (src/tools/bake.ts): what `cutMap` leaves empty. */
export type Bakes = Pick<MonzoneMap, "lanes" | "farms" | "lamps"> & {
  readonly floors: ReadonlyArray<ReadonlyArray<number>>
  readonly parked: MonzoneMap["spawns"]["parked"]
}

/** No baked tables yet: what the bake itself runs on. */
export const NO_BAKES: Bakes = {
  lanes: { panda: [], ape: [], truck: [], carabinieri: [] },
  farms: [],
  lamps: [],
  floors: [],
  parked: [],
}

/** A tile before packing: its data with the build hash still to stamp. */
type Cut = Omit<TileData, "hash" | "heights" | "cover"> & {
  readonly heights: Int16Array
  readonly cover: Uint8Array
}

/** Lattice step of the coarse grid (`MonzoneMap.coarse`), m. */
const COARSE = 64

/** The tile index holding lattice step `n` (cells from the origin), clamped to the list, as src/sim/map/tiles.ts reads it. */
const indexOf = (n: number, lo: number, hi: number, nodes: number) =>
  Math.min(hi, Math.max(lo, Math.floor(n / nodes)))

/** The dense layers cut into tiles, and the global map's header and coarse grid (no bakes, no hash). */
const cut = (map: BuiltMap) => {
  const { cell, cols, rows, x0, y0, data } = map.heightmap
  const n = TILE / cell,
    cx = Math.round(x0 / cell),
    cy = Math.round(y0 / cell)
  if (n !== TILE_CELLS || cx * cell !== x0 || cy * cell !== y0)
    throw new Error(`the ${cell} m heightmap at (${x0}, ${y0}) does not line up with the tiles`)
  const range = tileRange(map.bounds)
  // Every tile and coarse node passes here before an Int16Array would wrap it: one that does not fit fails the build.
  const node = (gi: number, gj: number) => {
    const v =
      data[Math.min(rows - 1, Math.max(0, gj)) * cols + Math.min(cols - 1, Math.max(0, gi))]!
    if (!Number.isInteger(v) || v < -32768 || v > 32767)
      throw new Error(`heightmap: ${v} at node (${gi}, ${gj}) does not fit int16`)
    return v
  }
  /** A tile being cut: its walls and trees gathered in the whole map's order, with their ids. */
  interface Gathering {
    readonly i: number
    readonly j: number
    readonly heights: Int16Array
    readonly cover: Uint8Array
    readonly walls: Record<"walk" | "shore" | "drive", Array<number>>
    readonly wallIds: Record<"walk" | "shore" | "drive", Array<number>>
    readonly trees: Array<number>
    readonly ids: Array<number>
  }
  const tiles: Array<Gathering> = []
  const slot = new Map<string, number>()
  for (let j = range.j0; j <= range.j1; j++)
    for (let i = range.i0; i <= range.i1; i++) {
      const heights = new Int16Array(TILE_NODES * TILE_NODES),
        cover = new Uint8Array(TILE_CELLS * TILE_CELLS)
      for (let r = 0; r < TILE_NODES; r++)
        for (let c = 0; c < TILE_NODES; c++)
          heights[r * TILE_NODES + c] = node(n * i + c - cx, n * j + r - cy)
      for (let r = 0; r < TILE_CELLS; r++)
        for (let c = 0; c < TILE_CELLS; c++) {
          const ci = n * i + c - cx,
            cj = n * j + r - cy
          if (ci >= 0 && ci < cols - 1 && cj >= 0 && cj < rows - 1)
            cover[r * TILE_CELLS + c] = map.cover[cj * (cols - 1) + ci]!
        }
      slot.set(tileKey(i, j), tiles.length)
      tiles.push({
        i,
        j,
        heights,
        cover,
        walls: { walk: [], shore: [], drive: [] },
        wallIds: { walk: [], shore: [], drive: [] },
        trees: [],
        ids: [],
      })
    }
  const tileOf = (x: number, y: number) =>
    tiles[
      slot.get(
        tileKey(indexOf(x / cell, range.i0, range.i1, n), indexOf(y / cell, range.j0, range.j1, n)),
      )!
    ]!
  let reach = 0
  // Each kind's lattice corner: the lowest corner of any of its walls, where the whole map's broad phase put it.
  const low = {
    walk: [Infinity, Infinity],
    shore: [Infinity, Infinity],
    drive: [Infinity, Infinity],
  }
  for (const kind of ["walk", "shore", "drive"] as const) {
    const flat = map.walls[kind]
    for (let k = 0; k + 3 < flat.length; k += 4) {
      const ax = flat[k]!,
        ay = flat[k + 1]!,
        bx = flat[k + 2]!,
        by = flat[k + 3]!
      reach = Math.max(reach, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2)
      low[kind][0] = Math.min(low[kind][0]!, ax, bx)
      low[kind][1] = Math.min(low[kind][1]!, ay, by)
      const t = tileOf((ax + bx) / 2, (ay + by) / 2)
      t.walls[kind].push(ax, ay, bx, by)
      t.wallIds[kind].push(k / 4)
    }
  }
  let treeLow: readonly [number, number] = [Infinity, Infinity]
  for (let k = 0; k + 2 < map.trees.length; k += 3) {
    const t = tileOf(map.trees[k]!, map.trees[k + 1]!)
    t.trees.push(map.trees[k]!, map.trees[k + 1]!, map.trees[k + 2]!)
    t.ids.push(k / 3)
    treeLow = [Math.min(treeLow[0], map.trees[k]!), Math.min(treeLow[1], map.trees[k + 1]!)]
  }
  const corner = (
    ...kinds: ReadonlyArray<"walk" | "shore" | "drive">
  ): readonly [number, number] => [
    Math.min(...kinds.map((k) => low[k][0]!)),
    Math.min(...kinds.map((k) => low[k][1]!)),
  ]
  const cuts: Array<Cut> = tiles.map((t) => ({
    i: t.i,
    j: t.j,
    heights: t.heights,
    cover: t.cover,
    walls: {
      walk: Float64Array.from(t.walls.walk),
      shore: Float64Array.from(t.walls.shore),
      drive: Float64Array.from(t.walls.drive),
    },
    wallIds: {
      walk: Int32Array.from(t.wallIds.walk),
      shore: Int32Array.from(t.wallIds.shore),
      drive: Int32Array.from(t.wallIds.drive),
    },
    trees: Float64Array.from(t.trees),
    ids: Int32Array.from(t.ids),
  }))
  const walls: MonzoneMap["walls"] = {
    // Every wall reaches at most this far past its midpoint; the margin keeps a box's rounding inside it.
    reach: Math.ceil(reach) + 1,
    lattice: {
      walk: corner("walk"),
      land: corner("walk", "shore"),
      drive: corner("drive"),
      traffic: corner("drive", "shore"),
      trees: treeLow,
    },
    counts: { walk: map.walls.walk.length / 4, drive: map.walls.drive.length / 4 },
  }
  // The coarse grid: every COARSE m on the origin's multiples, over the bounds.
  const gx0 = COARSE * Math.floor(map.bounds.minX / COARSE),
    gy0 = COARSE * Math.floor(map.bounds.minY / COARSE),
    gcols = (COARSE * Math.ceil(map.bounds.maxX / COARSE) - gx0) / COARSE + 1,
    grows = (COARSE * Math.ceil(map.bounds.maxY / COARSE) - gy0) / COARSE + 1
  const heights = new Int16Array(gcols * grows),
    coverGrid = new Uint8Array(gcols * grows)
  for (let r = 0; r < grows; r++)
    for (let c = 0; c < gcols; c++) {
      const gi = (gx0 + c * COARSE - x0) / cell,
        gj = (gy0 + r * COARSE - y0) / cell
      heights[r * gcols + c] = node(gi, gj)
      const ci = Math.min(cols - 2, Math.max(0, gi)),
        cj = Math.min(rows - 2, Math.max(0, gj))
      coverGrid[r * gcols + c] = map.cover[cj * (cols - 1) + ci]!
    }
  return {
    tiles: cuts,
    walls,
    coarse: {
      cell: COARSE,
      cols: gcols,
      rows: grows,
      x0: gx0,
      y0: gy0,
      heights,
      cover: coverGrid,
    },
  }
}

/** The global map and its tiles, packed and stamped with the build's hash (16 hex digits of SHA-256 over every file unstamped). */
const stamp = (
  global: Omit<MonzoneMap, "hash">,
  tiles: ReadonlyArray<Cut>,
): {
  readonly global: MonzoneMap
  readonly files: Map<string, Buffer>
  readonly sizes: Record<string, number>
} => {
  const hash = createHash("sha256")
  hash.update(packMap({ ...global, hash: "" }).file)
  for (const t of tiles) hash.update(packTile({ ...t, hash: "" }).file)
  const stamped: MonzoneMap = { ...global, hash: hash.digest("hex").slice(0, 16) }
  const files = new Map<string, Buffer>()
  const sizes: Record<string, number> = {}
  const packed = packMap(stamped)
  files.set("", packed.file)
  for (const [part, bytes] of Object.entries(packed.sizes)) sizes[`global ${part}`] = bytes
  for (const t of tiles) {
    const tile = packTile({ ...t, hash: stamped.hash })
    files.set(tileKey(t.i, t.j), tile.file)
    for (const [part, bytes] of Object.entries(tile.sizes))
      sizes[`tile ${part}`] = (sizes[`tile ${part}`] ?? 0) + bytes
  }
  return { global: stamped, files, sizes }
}

/**
 * The map files for `map` named `name`, with `bakes`: the gunzipped global file under key "" and each
 * tile under its key, the decoded global map, and the bytes of each part (tiles summed). Deterministic.
 */
export const cutMap = (map: BuiltMap, name: string, bakes: Bakes): ReturnType<typeof stamp> => {
  const { tiles, walls, coarse } = cut(map)
  const { cell, cols, rows, x0, y0 } = map.heightmap
  const place = placeFrom(map.origin, map.heightmap)
  const global: Omit<MonzoneMap, "hash"> = {
    version: map.version,
    name,
    origin: map.origin,
    mPerDeg: map.mPerDeg,
    bounds: map.bounds,
    heightmap: { cell, cols, rows, x0, y0 },
    tiles: tiles.map(({ i, j, heights }) => {
      let zmin = Number.MAX_SAFE_INTEGER,
        zmax = -Number.MAX_SAFE_INTEGER
      for (const z of heights) [zmin, zmax] = [Math.min(zmin, z), Math.max(zmax, z)]
      return { i, j, zmin, zmax }
    }),
    place: { floor: place.floor, downslope: place.downslope },
    coarse,
    roads: map.roads,
    buildings: map.buildings,
    water: map.water.map((w, i) => ({ ...w, floor: bakes.floors[i] ?? [] })),
    rail: map.rail,
    railway: map.railway,
    areas: map.areas,
    barriers: map.barriers,
    pois: map.pois,
    districts: map.districts,
    graph: map.graph,
    walls,
    spawns: {
      player: map.spawns.player,
      parked: map.spawns.parked.map((s, i) => bakes.parked[i] ?? { ...s, rest: {} }),
    },
    lanes: bakes.lanes,
    farms: bakes.farms,
    lamps: bakes.lamps,
  }
  return stamp(global, tiles)
}

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
  /** Flat (x, y, scale) triples in the whole map's order. */
  readonly trees: ArrayLike<number>
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
  const trees = new Float64Array(3 * listed.reduce((sum, t) => sum + t.ids.length, 0))
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
    t.ids.forEach((id, k) => trees.set(t.trees.subarray(3 * k, 3 * k + 3), 3 * id))
  }
  const { heightmap, ...rest } = global
  return {
    ...rest,
    heightmap: { ...heightmap, data },
    walls: { ...global.walls, walk: flat("walk"), shore: flat("shore"), drive: flat("drive") },
    trees,
    cover,
  }
}
