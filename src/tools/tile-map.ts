// Cuts the map the build makes (one heightmap, every wall and tree, the land cover rasterised tile
// by tile) into the global map and its 2 km tiles (src/sim/map/packed.ts), one tile at a time, and
// joins them back for the tools that read a whole map (map-diff, preview-map, the map tests). The
// cut is exact: joining the tiles gives back every node, wall, tree and cover cell, in order.
import { createHash } from "node:crypto"

import type { PixelBlock } from "../sim/collide.ts"
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
  /** The land cover of a block of the heightmap's `(cols − 1) × (rows − 1)` cells (`rasterCover`), row-major. */
  readonly cover: (block: PixelBlock) => ArrayLike<number>
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

/** Lattice step of the coarse grid (`MonzoneMap.coarse`), m. */
const COARSE = 64

/** The tile index holding lattice step `n` (cells from the origin), clamped to the list, as src/sim/map/tiles.ts reads it. */
const indexOf = (n: number, lo: number, hi: number, nodes: number) =>
  Math.min(hi, Math.max(lo, Math.floor(n / nodes)))

/** The items of each of `slots` slots, in order: a stable counting sort of `slotOf` over `count` items. */
const bySlot = (count: number, slots: number, slotOf: (item: number) => number) => {
  const slot = new Int32Array(count),
    starts = new Int32Array(slots + 1)
  for (let k = 0; k < count; k++) starts[(slot[k] = slotOf(k)) + 1]!++
  for (let s = 0; s < slots; s++) starts[s + 1]! += starts[s]!
  const items = new Int32Array(count),
    next = starts.slice(0, -1)
  for (let k = 0; k < count; k++) items[next[slot[k]!]!++] = k
  return (s: number) => items.subarray(starts[s], starts[s + 1])
}

/** A map cut into its tiles: each tile packed with no hash yet, and the global map the bakes complete. */
export interface MapCut {
  /** Each tile's gunzipped file with an empty hash, by key, south to north then west to east. */
  readonly tiles: ReadonlyMap<string, Buffer>
  /** The global map with `bakes`, before its hash. */
  readonly global: (bakes: Bakes) => Omit<MonzoneMap, "hash">
  /** The bytes of each part of the tiles, summed (`json` with the hash still empty). */
  readonly sizes: Readonly<Record<string, number>>
}

/**
 * `map` named `name` cut into its tiles, one at a time, each packed as it is cut: its terrain nodes,
 * its land cover (asked of `map.cover` for its cells alone), and its walls and trees in the whole
 * map's order. The global map keeps only the sparse parts, so the dense layers can go once the cut
 * is done. Deterministic.
 */
export const cutMap = (map: BuiltMap, name: string): MapCut => {
  const { cell, cols, rows, x0, y0, data } = map.heightmap
  const n = TILE / cell,
    cx = Math.round(x0 / cell),
    cy = Math.round(y0 / cell)
  if (n !== TILE_CELLS || cx * cell !== x0 || cy * cell !== y0)
    throw new Error(`the ${cell} m heightmap at (${x0}, ${y0}) does not line up with the tiles`)
  const range = tileRange(map.bounds),
    across = range.i1 - range.i0 + 1,
    slots = across * (range.j1 - range.j0 + 1)
  // Every tile and coarse node passes here before an Int16Array would wrap it: one that does not fit fails the build.
  const node = (gi: number, gj: number) => {
    const v =
      data[Math.min(rows - 1, Math.max(0, gj)) * cols + Math.min(cols - 1, Math.max(0, gi))]!
    if (!Number.isInteger(v) || v < -32768 || v > 32767)
      throw new Error(`heightmap: ${v} at node (${gi}, ${gj}) does not fit int16`)
    return v
  }
  const slotAt = (x: number, y: number) =>
    (indexOf(y / cell, range.j0, range.j1, n) - range.j0) * across +
    indexOf(x / cell, range.i0, range.i1, n) -
    range.i0
  // Each wall in the tile of its midpoint, and each kind's lattice corner: the lowest corner of any
  // of its walls, where the whole map's broad phase put it.
  let reach = 0
  const low = {
    walk: [Infinity, Infinity],
    shore: [Infinity, Infinity],
    drive: [Infinity, Infinity],
  }
  const wallsOf = Object.fromEntries(
    (["walk", "shore", "drive"] as const).map((kind) => {
      const flat = map.walls[kind]
      return [
        kind,
        bySlot(flat.length / 4, slots, (w) => {
          const ax = flat[4 * w]!,
            ay = flat[4 * w + 1]!,
            bx = flat[4 * w + 2]!,
            by = flat[4 * w + 3]!
          reach = Math.max(reach, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2)
          low[kind][0] = Math.min(low[kind][0]!, ax, bx)
          low[kind][1] = Math.min(low[kind][1]!, ay, by)
          return slotAt((ax + bx) / 2, (ay + by) / 2)
        }),
      ]
    }),
  ) as Record<"walk" | "shore" | "drive", (s: number) => Int32Array>
  let treeLow: readonly [number, number] = [Infinity, Infinity]
  const treesOf = bySlot(map.trees.length / 3, slots, (t) => {
    const x = map.trees[3 * t]!,
      y = map.trees[3 * t + 1]!
    treeLow = [Math.min(treeLow[0], x), Math.min(treeLow[1], y)]
    return slotAt(x, y)
  })
  // The coarse grid: every COARSE m on the origin's multiples, over the bounds; its cover is read in
  // the tile whose cells hold each node's cell.
  const gx0 = COARSE * Math.floor(map.bounds.minX / COARSE),
    gy0 = COARSE * Math.floor(map.bounds.minY / COARSE),
    gcols = (COARSE * Math.ceil(map.bounds.maxX / COARSE) - gx0) / COARSE + 1,
    grows = (COARSE * Math.ceil(map.bounds.maxY / COARSE) - gy0) / COARSE + 1
  const coarseHeights = new Int16Array(gcols * grows),
    coarseCover = new Uint8Array(gcols * grows)
  const coarseCell = (c: number, r: number) =>
    [
      Math.min(cols - 2, Math.max(0, (gx0 + c * COARSE - x0) / cell)),
      Math.min(rows - 2, Math.max(0, (gy0 + r * COARSE - y0) / cell)),
    ] as const
  const coarseOf = bySlot(gcols * grows, slots, (k) => {
    const [ci, cj] = coarseCell(k % gcols, Math.floor(k / gcols))
    return slotAt((ci + cx) * cell, (cj + cy) * cell)
  })
  const files = new Map<string, Buffer>(),
    sizes: Record<string, number> = {},
    list: Array<MonzoneMap["tiles"][number]> = []
  for (let j = range.j0; j <= range.j1; j++)
    for (let i = range.i0; i <= range.i1; i++) {
      const s = (j - range.j0) * across + i - range.i0
      const heights = new Int16Array(TILE_NODES * TILE_NODES),
        cover = new Uint8Array(TILE_CELLS * TILE_CELLS)
      let zmin = Number.MAX_SAFE_INTEGER,
        zmax = -Number.MAX_SAFE_INTEGER
      for (let r = 0; r < TILE_NODES; r++)
        for (let c = 0; c < TILE_NODES; c++) {
          const z = node(n * i + c - cx, n * j + r - cy)
          heights[r * TILE_NODES + c] = z
          ;[zmin, zmax] = [Math.min(zmin, z), Math.max(zmax, z)]
        }
      // The tile's cells on the heightmap; cells past the bounds stay 0.
      const c0 = Math.max(0, n * i - cx),
        r0 = Math.max(0, n * j - cy)
      const block = {
        c0,
        r0,
        cols: Math.min(cols - 1, n * (i + 1) - cx) - c0,
        rows: Math.min(rows - 1, n * (j + 1) - cy) - r0,
      }
      const cells = map.cover(block)
      for (let r = 0; r < block.rows; r++)
        for (let c = 0; c < block.cols; c++)
          cover[(r0 + r + cy - n * j) * TILE_CELLS + c0 + c + cx - n * i] =
            cells[r * block.cols + c]!
      for (const k of coarseOf(s)) {
        const [ci, cj] = coarseCell(k % gcols, Math.floor(k / gcols))
        coarseCover[k] = cover[(cj + cy - n * j) * TILE_CELLS + ci + cx - n * i]!
      }
      const flatOf = (from: ArrayLike<number>, items: Int32Array, stride: number) => {
        const out = new Float64Array(items.length * stride)
        items.forEach((k, m) => {
          for (let d = 0; d < stride; d++) out[m * stride + d] = from[k * stride + d]!
        })
        return out
      }
      const walk = wallsOf.walk(s),
        shore = wallsOf.shore(s),
        drive = wallsOf.drive(s),
        trees = treesOf(s)
      const tile = packTile({
        hash: "",
        i,
        j,
        heights,
        walls: {
          walk: flatOf(map.walls.walk, walk, 4),
          shore: flatOf(map.walls.shore, shore, 4),
          drive: flatOf(map.walls.drive, drive, 4),
        },
        wallIds: { walk, shore, drive },
        trees: flatOf(map.trees, trees, 3),
        ids: trees,
        cover,
      })
      files.set(tileKey(i, j), tile.file)
      for (const [part, bytes] of Object.entries(tile.sizes))
        sizes[part] = (sizes[part] ?? 0) + bytes
      list.push({ i, j, zmin, zmax })
    }
  for (let r = 0; r < grows; r++)
    for (let c = 0; c < gcols; c++)
      coarseHeights[r * gcols + c] = node(
        (gx0 + c * COARSE - x0) / cell,
        (gy0 + r * COARSE - y0) / cell,
      )
  const corner = (
    ...kinds: ReadonlyArray<"walk" | "shore" | "drive">
  ): readonly [number, number] => [
    Math.min(...kinds.map((k) => low[k][0]!)),
    Math.min(...kinds.map((k) => low[k][1]!)),
  ]
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
  const place = placeFrom(map.origin, map.heightmap)
  const header = {
    version: map.version,
    name,
    origin: map.origin,
    mPerDeg: map.mPerDeg,
    bounds: map.bounds,
    heightmap: { cell, cols, rows, x0, y0 },
    tiles: list,
    place: { floor: place.floor, downslope: place.downslope },
    coarse: {
      cell: COARSE,
      cols: gcols,
      rows: grows,
      x0: gx0,
      y0: gy0,
      heights: coarseHeights,
      cover: coarseCover,
    },
  }
  const {
    roads,
    buildings,
    water,
    rail,
    railway,
    areas,
    barriers,
    pois,
    districts,
    graph,
    spawns,
  } = map
  return {
    tiles: files,
    sizes,
    global: globalOf(
      header,
      { roads, buildings, rail, railway, areas, barriers, pois, districts, graph, walls },
      water,
      spawns,
    ),
  }
}

/** The global map's parts that come before the vectors, in file order. */
type Header = Pick<
  MonzoneMap,
  "version" | "name" | "origin" | "mPerDeg" | "bounds" | "heightmap" | "tiles" | "place" | "coarse"
>

/**
 * The global map with the bakes, from its parts (in the file's key order): made apart from
 * `cutMap`, so the closure holds these alone and not the dense layers the cut read.
 */
const globalOf =
  (
    header: Header,
    v: Pick<
      MonzoneMap,
      | "roads"
      | "buildings"
      | "rail"
      | "railway"
      | "areas"
      | "barriers"
      | "pois"
      | "districts"
      | "graph"
      | "walls"
    >,
    water: BuiltMap["water"],
    { player, parked }: BuiltMap["spawns"],
  ) =>
  (bakes: Bakes): Omit<MonzoneMap, "hash"> => ({
    ...header,
    roads: v.roads,
    buildings: v.buildings,
    water: water.map((w, i) => ({ ...w, floor: bakes.floors[i] ?? [] })),
    rail: v.rail,
    railway: v.railway,
    areas: v.areas,
    barriers: v.barriers,
    pois: v.pois,
    districts: v.districts,
    graph: v.graph,
    walls: v.walls,
    spawns: { player, parked: parked.map((s, i) => bakes.parked[i] ?? { ...s, rest: {} }) },
    lanes: bakes.lanes,
    farms: bakes.farms,
    lamps: bakes.lamps,
  })

/** A file's JSON line with `hash` set, the packed sections after it unchanged: what packing it with that hash gives. */
const restamp = (file: Uint8Array, hash: string): Buffer => {
  const end = file.indexOf(10)
  const json = JSON.parse(Buffer.from(file.subarray(0, end)).toString()) as { hash: string }
  json.hash = hash
  return Buffer.concat([Buffer.from(JSON.stringify(json)), file.subarray(end)])
}

/**
 * The build hash of `global` and its unstamped `tiles` (16 hex digits of SHA-256 over the global
 * file, then each tile's, all unstamped and in order), the global map and its file stamped with it,
 * and `tile`, which stamps a tile's file.
 */
export const stampMap = (
  global: Omit<MonzoneMap, "hash">,
  tiles: Iterable<Uint8Array>,
): {
  readonly global: MonzoneMap
  readonly file: Buffer
  readonly sizes: Readonly<Record<string, number>>
  readonly tile: (file: Uint8Array) => Buffer
} => {
  const sha = createHash("sha256")
  sha.update(packMap({ ...global, hash: "" }).file)
  for (const file of tiles) sha.update(file)
  const hash = sha.digest("hex").slice(0, 16)
  const stamped: MonzoneMap = { ...global, hash }
  const { file, sizes } = packMap(stamped)
  return { global: stamped, file, sizes, tile: (tile) => restamp(tile, hash) }
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
