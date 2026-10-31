// Cuts the map the build makes (one heightmap, every wall and tree, the land cover rasterised tile
// by tile, every vector) into the global map and its 2 km tiles (src/sim/map/packed.ts), one tile at
// a time, and stamps them with the build hash. The cut is exact: joining the tiles back (`joinTiles`
// in map-file.ts, for the tools that read a whole map) gives back every node, wall, tree, cover cell
// and vector, in order (the trees in id order: merged by id, `mergeTrees` in trees.ts).
import { createHash } from "node:crypto"

import type { PixelBlock } from "../sim/collide.ts"
import type { Area, Barrier, Building, MonzoneMap, Road, Spawn, Water } from "../sim/map/index.ts"
import {
  HALO,
  TILE,
  tileKey,
  tileRange,
  tilesRound,
  vergeOf,
  WATER_VERTICES,
} from "../sim/map/kinds.ts"
import {
  TILE_CELLS,
  TILE_NODES,
  type TileVectors,
  VECTOR_LAYERS,
  type VectorLayer,
} from "../sim/map/packed.ts"
import { placeFrom } from "../sim/sky/place.ts"
import { packMap, packTile, relined } from "./pack.ts"

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
  | "vectors"
  | "derived"
  | "roads"
  | "spawns"
  | "lanes"
  | "farms"
  | "lamps"
> {
  /** Every road, its attributes and its line (the cut keeps the attributes in the global file and puts the lines in the tiles). */
  readonly roads: ReadonlyArray<Road>
  readonly buildings: ReadonlyArray<Building>
  readonly areas: ReadonlyArray<Area>
  readonly barriers: ReadonlyArray<Barrier>
  /** `cols` × `rows` nodes, decimetres, row-major from the south-west node (x0, y0) (`decimetres` in build-output.ts fits them to int16). */
  readonly heightmap: MonzoneMap["heightmap"] & { readonly data: Int16Array }
  /** The tiles to cut and write, the region's (`tiles` in region.ts): those of the bounds' box its parts leave out (an L's notch) are not. */
  readonly tiles: ReadonlyArray<{ readonly i: number; readonly j: number }>
  readonly walls: {
    readonly walk: ArrayLike<number>
    readonly shore: ArrayLike<number>
    readonly drive: ArrayLike<number>
  }
  /** Flat (x, y, scale) triples, in id order. */
  readonly trees: ArrayLike<number>
  /** Each tree's id, ascending: its lattice cell's number, or its bank cell's past them (trees.ts). */
  readonly treeIds: ArrayLike<number>
  /** The trees' broad-phase corner, `walls.lattice.trees`: fixed per region (trees.ts `treeCorner`). */
  readonly treeCorner: readonly [number, number]
  /** The land cover of a block of the heightmap's `(cols − 1) × (rows − 1)` cells (`coverBlocks`), row-major. */
  readonly cover: (block: PixelBlock) => ArrayLike<number>
  readonly water: ReadonlyArray<Omit<Water, "floor">>
  readonly spawns: Omit<MonzoneMap["spawns"], "parked"> & { readonly parked: ReadonlyArray<Spawn> }
}

/** The tables the build bakes from the dense layers and the vectors (src/tools/bake.ts): what `cutMap` leaves empty. */
export type Bakes = Pick<MonzoneMap, "lanes" | "farms" | "lamps"> &
  Pick<MonzoneMap["derived"], "bells" | "residents"> & {
    readonly floors: ReadonlyArray<ReadonlyArray<number>>
    readonly parked: MonzoneMap["spawns"]["parked"]
    /** Each farm's building centre, flat x, y (`derived.farms`). */
    readonly farmCentres: ReadonlyArray<number>
  }

/** No baked tables yet: what the bake itself runs on. */
export const NO_BAKES: Bakes = {
  lanes: { panda: [], ape: [], truck: [], carabinieri: [] },
  farms: [],
  lamps: [],
  floors: [],
  parked: [],
  bells: [],
  residents: [],
  farmCentres: [],
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

/** A map cut into its tiles, and the global map: both completed by the bakes. */
export interface MapCut {
  /**
   * Each tile's gunzipped file with `bakes` (the water's floors) and an empty hash, by key, south to
   * north then west to east, and the bytes of each layer of vectors in them, summed.
   */
  readonly tiles: (bakes: Bakes) => {
    readonly files: ReadonlyMap<string, Buffer>
    readonly sizes: Readonly<Record<VectorLayer, number>>
  }
  /** The global map with `bakes`, before its hash. */
  readonly global: (bakes: Bakes) => Omit<MonzoneMap, "hash">
  /** The whole map's vectors, for the bakes that read them all (the water before its floors). */
  readonly whole: Pick<BuiltMap, "roads" | "buildings" | "water">
  /** The bytes of each part of the tiles' dense layers, summed (`json` with the hash and the vectors still empty). */
  readonly sizes: Readonly<Record<string, number>>
}

/** No vectors: a tile's before the cut adds them. */
const NO_VECTORS: TileVectors = {
  roads: { ids: [], items: [] },
  buildings: { ids: [], items: [] },
  water: { ids: [], items: [] },
  areas: { ids: [], items: [] },
  barriers: { ids: [], items: [] },
}

/** Calls `box` with the box of each segment of the flat polyline `pts` (of its one point, if it has one). */
const segmentBoxes = (
  pts: ReadonlyArray<number>,
  box: (x0: number, y0: number, x1: number, y1: number) => void,
): void => {
  if (pts.length === 2) box(pts[0]!, pts[1]!, pts[0]!, pts[1]!)
  for (let k = 0; k + 3 < pts.length; k += 2)
    box(
      Math.min(pts[k]!, pts[k + 2]!),
      Math.min(pts[k + 1]!, pts[k + 3]!),
      Math.max(pts[k]!, pts[k + 2]!),
      Math.max(pts[k + 1]!, pts[k + 3]!),
    )
}

/** Calls `box` with the box of the flat ring `ring`. */
const ringBox = (
  ring: ReadonlyArray<number>,
  box: (x0: number, y0: number, x1: number, y1: number) => void,
): void => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (let k = 0; k + 1 < ring.length; k += 2) {
    x0 = Math.min(x0, ring[k]!)
    y0 = Math.min(y0, ring[k + 1]!)
    x1 = Math.max(x1, ring[k]!)
    y1 = Math.max(y1, ring[k + 1]!)
  }
  box(x0, y0, x1, y1)
}

/**
 * Throws unless every road's carriageway and walkers' verge and every river's bed lie within the
 * halo of the tile holding a point on them: a lookup at a point reads that tile's vectors alone
 * (src/sim/map/ground.ts, surface.ts, src/sim/water/rivers.ts).
 */
const checkReach = (map: BuiltMap): void => {
  for (const road of map.roads) {
    const reach = Math.max(road.w / 2 + 0.5, (road.verge ?? vergeOf(road.cls, road.w)) + 0.5)
    if (reach > HALO)
      throw new Error(
        `road ${road.id} reaches ${reach} m off its centreline, past the ${HALO} m halo`,
      )
  }
  for (const w of map.water)
    if (Math.max(w.bed, w.w / 2) > HALO)
      throw new Error(
        `water ${w.id} reaches ${Math.max(w.bed, w.w / 2)} m off its centreline, past the ${HALO} m halo`,
      )
}

/**
 * `map` named `name` cut into its tiles (`map.tiles`), one at a time, each packed as it is cut: its
 * terrain nodes, its land cover (asked of `map.cover` for its cells alone), and its walls and trees
 * (with their ids) in the whole map's order. A wall or tree whose midpoint falls in a tile of the
 * bounds' box left off the list goes to the listed tile round it (`tilesRound`) nearest it, which a
 * lookup there reads, and the coarse grid's nodes there read what the game's lookups read: the
 * nearest listed node and cell. The global map
 * keeps only the sparse parts, so the dense layers can go once the cut is done. Deterministic.
 */
export const cutMap = (map: BuiltMap, name: string): MapCut => {
  const { cell, cols, rows, x0, y0, ax, ay, data } = map.heightmap
  const n = TILE / cell,
    cx = Math.round(x0 / cell),
    cy = Math.round(y0 / cell)
  if (n !== TILE_CELLS || cx * cell !== x0 || cy * cell !== y0)
    throw new Error(`the ${cell} m heightmap at (${x0}, ${y0}) does not line up with the tiles`)
  const range = tileRange(map.bounds),
    across = range.i1 - range.i0 + 1,
    slots = across * (range.j1 - range.j0 + 1)
  const node = (gi: number, gj: number) =>
    data[Math.min(rows - 1, Math.max(0, gj)) * cols + Math.min(cols - 1, Math.max(0, gi))]!
  const slotOf = (i: number, j: number) => (j - range.j0) * across + i - range.i0
  const listed = new Uint8Array(slots)
  for (const { i, j } of map.tiles) listed[slotOf(i, j)] = 1
  const isListed = (i: number, j: number) =>
    i >= range.i0 && i <= range.i1 && j >= range.j0 && j <= range.j1 && listed[slotOf(i, j)] === 1
  /** Per unlisted slot, the listed tiles round it (`tilesRound`); none for a listed one. */
  const around = Array.from({ length: slots }, (_, s) =>
    listed[s] === 1
      ? []
      : tilesRound(range.i0 + (s % across), range.j0 + Math.floor(s / across), isListed),
  )
  const cellSlot = (x: number, y: number) =>
    slotOf(indexOf(x / cell, range.i0, range.i1, n), indexOf(y / cell, range.j0, range.j1, n))
  /**
   * The tile a wall or tree at (x, y) goes to: the one holding it, or in an unlisted one the listed
   * tile round it nearest (x, y), the first in key order on a tie (so its coordinates pack as the
   * tile's own do: it lies within a wall's reach of the play area).
   */
  const slotAt = (x: number, y: number) => {
    const s = cellSlot(x, y)
    let best = s,
      least = Infinity
    for (const [i, j] of around[s]!) {
      const dx = Math.max(TILE * i - x, 0, x - TILE * (i + 1)),
        dy = Math.max(TILE * j - y, 0, y - TILE * (j + 1))
      if (dx * dx + dy * dy < least) [best, least] = [slotOf(i, j), dx * dx + dy * dy]
    }
    return best
  }
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
  const treesOf = bySlot(map.trees.length / 3, slots, (t) =>
    slotAt(map.trees[3 * t]!, map.trees[3 * t + 1]!),
  )
  /**
   * Per slot, the features of a layer of `count` it holds, in whole-map order: those with a box
   * (`boxesOf` gives each) within HALO of the slot's square, the indices clamped to the list as a
   * lookup's are (`tilesOver` in src/sim/map/tiles.ts: on an edge tile, beyond the edge too); for
   * an unlisted slot (an L's notch), the listed tiles round it hold them instead.
   */
  const membersOf = (
    count: number,
    boxesOf: (item: number, box: (x0: number, y0: number, x1: number, y1: number) => void) => void,
  ): ReadonlyArray<ReadonlyArray<number>> => {
    const lists = Array.from({ length: slots }, (): Array<number> => []),
      last = new Int32Array(slots).fill(-1)
    const add = (s: number, item: number) => {
      if (last[s] === item) return
      last[s] = item
      lists[s]!.push(item)
    }
    for (let item = 0; item < count; item++)
      boxesOf(item, (x0, y0, x1, y1) => {
        const i0 = indexOf((x0 - HALO) / cell, range.i0, range.i1, n),
          i1 = indexOf((x1 + HALO) / cell, range.i0, range.i1, n),
          j0 = indexOf((y0 - HALO) / cell, range.j0, range.j1, n),
          j1 = indexOf((y1 + HALO) / cell, range.j0, range.j1, n)
        for (let tj = j0; tj <= j1; tj++)
          for (let ti = i0; ti <= i1; ti++) {
            const t = slotOf(ti, tj)
            if (listed[t] === 1) add(t, item)
            else for (const [ai, aj] of around[t]!) add(slotOf(ai, aj), item)
          }
      })
    return lists
  }
  checkReach(map)
  const members: Readonly<Record<VectorLayer, ReadonlyArray<ReadonlyArray<number>>>> = {
    roads: membersOf(map.roads.length, (k, box) => segmentBoxes(map.roads[k]!.pts, box)),
    buildings: membersOf(map.buildings.length, (k, box) => ringBox(map.buildings[k]!.outer, box)),
    water: membersOf(map.water.length, (k, box) => segmentBoxes(map.water[k]!.pts, box)),
    areas: membersOf(map.areas.length, (k, box) => ringBox(map.areas[k]!.rings[0] ?? [], box)),
    barriers: membersOf(map.barriers.length, (k, box) => segmentBoxes(map.barriers[k]!.pts, box)),
  }
  /**
   * Where the game reads lattice point (ni, nj), counted from the origin, a node (`cells` 0: a tile
   * holds N + 1 along each side) or a cell (1: N): in its tile when listed, else in the listed tile
   * round it (`around`) holding the point nearest it, the first in key order on a tie (`nearest` in
   * src/sim/map/tiles.ts). Gives [slot, ni, nj].
   */
  const readAt = (ni: number, nj: number, cells: 0 | 1): readonly [number, number, number] => {
    const s = slotOf(indexOf(ni, range.i0, range.i1, n), indexOf(nj, range.j0, range.j1, n))
    if (listed[s] === 1) return [s, ni, nj]
    let best = Infinity,
      at: readonly [number, number, number] = [s, ni, nj]
    for (const [ti, tj] of around[s]!) {
      const x = Math.min(cx + cols - 1 - cells, n * ti + n - cells, Math.max(cx, n * ti, ni)),
        y = Math.min(cy + rows - 1 - cells, n * tj + n - cells, Math.max(cy, n * tj, nj)),
        d = (x - ni) * (x - ni) + (y - nj) * (y - nj)
      if (d < best) [best, at] = [d, [slotOf(ti, tj), x, y]]
    }
    return at
  }
  // The coarse grid: every COARSE m on the origin's multiples, over the bounds, each node the
  // terrain's node there and the land cover of the cell north-east of it (both clamped to the
  // grid), as the game's lookups read them: in an unlisted tile (an L's notch), the nearest listed.
  const gx0 = COARSE * Math.floor(map.bounds.minX / COARSE),
    gy0 = COARSE * Math.floor(map.bounds.minY / COARSE),
    gcols = (COARSE * Math.ceil(map.bounds.maxX / COARSE) - gx0) / COARSE + 1,
    grows = (COARSE * Math.ceil(map.bounds.maxY / COARSE) - gy0) / COARSE + 1
  const coarseHeights = new Int16Array(gcols * grows),
    coarseCover = new Uint8Array(gcols * grows)
  /** Coarse node k's lattice point (clamped to the grid's nodes, or cells), counted from the origin. */
  const coarsePoint = (k: number, cells: 0 | 1) => {
    const c = k % gcols,
      r = Math.floor(k / gcols)
    return readAt(
      cx + Math.min(cols - 1 - cells, Math.max(0, (gx0 + c * COARSE - x0) / cell)),
      cy + Math.min(rows - 1 - cells, Math.max(0, (gy0 + r * COARSE - y0) / cell)),
      cells,
    )
  }
  const coarseCells = Array.from({ length: gcols * grows }, (_, k) => coarsePoint(k, 1))
  const coarseOf = bySlot(gcols * grows, slots, (k) => coarseCells[k]![0])
  const files = new Map<string, Buffer>(),
    sizes: Record<string, number> = {},
    list: Array<MonzoneMap["tiles"][number]> = []
  for (let j = range.j0; j <= range.j1; j++)
    for (let i = range.i0; i <= range.i1; i++) {
      const s = slotOf(i, j)
      if (listed[s] !== 1) continue
      const cover = new Uint8Array(TILE_CELLS * TILE_CELLS)
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
        const [, ni, nj] = coarseCells[k]!
        coarseCover[k] = cover[(nj - n * j) * TILE_CELLS + ni - n * i]!
      }
      const heights = new Int16Array(TILE_NODES * TILE_NODES)
      let zmin = Number.MAX_SAFE_INTEGER,
        zmax = -Number.MAX_SAFE_INTEGER
      for (let r = 0; r < TILE_NODES; r++)
        for (let c = 0; c < TILE_NODES; c++) {
          const z = node(n * i + c - cx, n * j + r - cy)
          heights[r * TILE_NODES + c] = z
          ;[zmin, zmax] = [Math.min(zmin, z), Math.max(zmax, z)]
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
        ids: Int32Array.from(trees, (k) => map.treeIds[k]!),
        cover,
        vectors: NO_VECTORS,
      })
      files.set(tileKey(i, j), tile.file)
      for (const [part, bytes] of Object.entries(tile.sizes))
        sizes[part] = (sizes[part] ?? 0) + bytes
      list.push({ i, j, zmin, zmax })
    }
  for (let k = 0; k < gcols * grows; k++) {
    const [, ni, nj] = coarsePoint(k, 0)
    coarseHeights[k] = node(ni - cx, nj - cy)
  }
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
      trees: map.treeCorner,
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
    outline: map.outline,
    heightmap: { cell, cols, rows, x0, y0, ...(ax === undefined ? {} : { ax, ay }) },
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
  const { roads, buildings, rail, railway, areas, pois, districts, graph, spawns } = map
  let bx = Infinity,
    by = Infinity,
    wx = Infinity,
    wy = Infinity
  for (const b of map.buildings)
    ringBox(b.outer, (x0, y0) => {
      bx = Math.min(bx, x0)
      by = Math.min(by, y0)
    })
  for (const w of map.water) {
    // a reach's sound is keyed by its piece and vertex (src/audio/places/water.ts)
    if (w.pts.length / 2 > WATER_VERTICES)
      throw new Error(`water ${w.id} has ${w.pts.length / 2} vertices, more than ${WATER_VERTICES}`)
    ringBox(w.pts, (x0, y0) => {
      wx = Math.min(wx, x0)
      wy = Math.min(wy, y0)
    })
  }
  const vectors: MonzoneMap["vectors"] = {
    halo: HALO,
    counts: {
      roads: map.roads.length,
      buildings: map.buildings.length,
      water: map.water.length,
      areas: map.areas.length,
      barriers: map.barriers.length,
    },
    // where the whole map's broad phases put their lattices (the origin with none)
    lattice: {
      buildings: map.buildings.length === 0 ? [0, 0] : [bx, by],
      water: map.water.length === 0 ? [0, 0] : [wx, wy],
    },
  }
  /** Each tile's file with its vectors, the water's floors from `bakes`. */
  const tiles = (bakes: Bakes) => {
    const out = new Map<string, Buffer>(),
      bytes: Record<VectorLayer, number> = {
        roads: 0,
        buildings: 0,
        water: 0,
        areas: 0,
        barriers: 0,
      }
    for (const [key, file] of files) {
      const [i, j] = key.split("_").map(Number)
      const s = slotOf(i!, j!)
      const layer = <T>(ids: ReadonlyArray<number>, item: (k: number) => T) => ({
        ids,
        items: ids.map(item),
      })
      const tile: TileVectors = {
        roads: layer(members.roads[s]!, (k) => ({ pts: map.roads[k]!.pts, z: map.roads[k]!.z })),
        buildings: layer(members.buildings[s]!, (k) => map.buildings[k]!),
        water: layer(members.water[s]!, (k) => ({
          ...map.water[k]!,
          floor: bakes.floors[k] ?? [],
        })),
        areas: layer(members.areas[s]!, (k) => map.areas[k]!),
        barriers: layer(members.barriers[s]!, (k) => map.barriers[k]!),
      }
      for (const name of VECTOR_LAYERS) bytes[name] += JSON.stringify(tile[name]).length
      out.set(key, relined(file, { vectors: tile }))
    }
    return { files: out, sizes: bytes }
  }
  return {
    tiles,
    sizes,
    whole: { roads: map.roads, buildings: map.buildings, water: map.water },
    global: globalOf(
      header,
      {
        // the roads' attributes: their lines are in the tiles
        roads: roads.map((road) => {
          const { pts: _, z: __, ...info } = road
          return info
        }),
        rail,
        railway,
        pois,
        districts,
        graph,
        walls,
        vectors,
      },
      {
        crossings: railway.crossings.map((c) => ({ pts: roads[c.road]!.pts, z: roads[c.road]!.z })),
        platforms: railway.platforms.map((p) => areas[p.area]!.rings),
        stations: railway.stations.map(
          (st) => buildings.find((b) => b.style === "station" && b.name === st.name) ?? null,
        ),
      },
      spawns,
    ),
  }
}

/** The global map's parts that come before the vectors, in file order. */
type Header = Pick<
  MonzoneMap,
  | "version"
  | "name"
  | "origin"
  | "mPerDeg"
  | "bounds"
  | "outline"
  | "heightmap"
  | "tiles"
  | "place"
  | "coarse"
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
      "roads" | "rail" | "railway" | "pois" | "districts" | "graph" | "walls" | "vectors"
    >,
    copies: Pick<MonzoneMap["derived"], "crossings" | "platforms" | "stations">,
    { player, parked, police }: BuiltMap["spawns"],
  ) =>
  (bakes: Bakes): Omit<MonzoneMap, "hash"> => ({
    ...header,
    roads: v.roads,
    rail: v.rail,
    railway: v.railway,
    pois: v.pois,
    districts: v.districts,
    graph: v.graph,
    walls: v.walls,
    vectors: v.vectors,
    spawns: {
      player,
      parked: parked.map((s, i) => bakes.parked[i] ?? { ...s, rest: {} }),
      ...(police === undefined ? {} : { police }),
    },
    lanes: bakes.lanes,
    farms: bakes.farms,
    lamps: bakes.lamps,
    derived: {
      ...copies,
      bells: bakes.bells,
      residents: bakes.residents,
      farms: bakes.farmCentres,
    },
  })

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
  return { global: stamped, file, sizes, tile: (tile) => relined(tile, { hash }) }
}
