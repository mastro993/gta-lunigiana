/**
 * The tiles in memory: the dense layers (terrain nodes, walls, trees, land cover) of the 2 km
 * squares the host has handed over (`provideTile`), and the lookups that read them. A lookup in a
 * listed tile that is not here asks the tile source (Node: the tile file on disk); with none, it
 * throws "map tile i_j not loaded". Every answer is a pure function of the map, never of which tiles
 * are here or in which order they came: each tile's broad phases are built from that tile alone (on
 * first use) on the whole map's lattice, and a query answers in the whole map's order whichever
 * tiles hold its items (`./lattice.ts`).
 * So residency is never observable, and the host decides it alone: it keeps every listed tile
 * overlapping [player ± `STEP_REACH`]² before each step, and the sim reads nothing farther away
 * (vehicles past `FROZEN_BEYOND` stand frozen).
 *
 * Immutable map content plus host-owned residency, never gameplay state: shared by every runtime.
 *
 * @module map/tiles
 */
import { MAP } from "./global.ts"
import { pushTrunk, TILE, tileKey, tileRange, TRUNK } from "./kinds.ts"
import { cellBox, type CellGrid, cellGrid, queryCells } from "./lattice.ts"
import {
  decodeTile,
  onDisk,
  readMapFile,
  TILE_CELLS,
  TILE_NODES,
  type TileData,
  tileUrl,
} from "./packed.ts"

/** Vehicles farther than this from the player along either axis (m) stand frozen: the sim reads no tile for them. */
export const FROZEN_BEYOND = 500
/**
 * Half the side of the square around the player (m) whose listed tiles must all be in memory before a
 * step: anything the sim steps (people, animals and vehicles within `FROZEN_BEYOND`, the spawn checks around
 * them) reads within it.
 */
export const STEP_REACH = 600

const { cell, x0, y0 } = MAP.heightmap
/** Cells along a tile's side; the terrain lattice's node (0, 0) is `CORNER` cells from the origin. */
const N = TILE / cell
const CORNER = { x: Math.round(x0 / cell), y: Math.round(y0 / cell) }
if (N !== TILE_CELLS || CORNER.x * cell !== x0 || CORNER.y * cell !== y0)
  throw new Error(`map: the ${cell} m heightmap at (${x0}, ${y0}) does not line up with the tiles`)
const range = tileRange(MAP.bounds)
const across = range.i1 - range.i0 + 1
const slots = across * (range.j1 - range.j0 + 1)

/** The slot of tile (i, j) in the tables below, or -1 off the listed range. */
const slotOf = (i: number, j: number): number =>
  i < range.i0 || i > range.i1 || j < range.j0 || j > range.j1
    ? -1
    : (j - range.j0) * across + i - range.i0
const listed = new Uint8Array(slots)
for (const { i, j } of MAP.tiles) listed[slotOf(i, j)] = 1

/** A wall broad phase over one tile's flat (ax, ay, bx, by) segments. */
interface Walls {
  readonly flat: ArrayLike<number>
  readonly grid: CellGrid
}
/** A tile in memory: its data, and its broad phases once a query has needed them. */
interface Tile {
  readonly data: TileData
  walls?: Partial<Record<WallKind, Walls>>
  trees?: CellGrid
}
const tiles: Array<Tile | undefined> = Array.from({ length: slots })

/** The kinds of wall `wallsNear` answers. */
export type WallKind = "walk" | "land" | "drive" | "traffic"

/** Where a listed tile comes from when a lookup finds it missing: Node reads the file beside the global one; a browser has none. */
let source: ((key: string) => Uint8Array) | undefined = onDisk()
  ? (key) => readMapFile(tileUrl(MAP.name, key))
  : undefined

/** Sets (or, with undefined, removes) where a missing tile comes from; tests remove it to see a missing tile throw. */
export const setTileSource = (next: ((key: string) => Uint8Array) | undefined): void => {
  source = next
}

/** Takes a gunzipped tile file into memory (the host, once it has downloaded it); a tile already here stays as it is. */
export const provideTile = (file: Uint8Array): void => {
  const data = decodeTile(file),
    key = tileKey(data.i, data.j),
    s = slotOf(data.i, data.j)
  if (data.hash !== MAP.hash)
    throw new Error(
      `map tile ${key} is from another build (${data.hash}, not ${MAP.hash}); run pnpm map`,
    )
  if (s < 0 || listed[s] !== 1) throw new Error(`map tile ${key} is not on this map`)
  tiles[s] ??= { data }
}

/** Lets a tile go (the host, once nothing near the player or in view needs it). */
export const dropTile = (key: string): void => {
  const [i, j] = key.split("_").map(Number)
  const s = slotOf(i!, j!)
  if (s >= 0) tiles[s] = undefined
}

/** Whether tile `key` is in memory. */
export const isResident = (key: string): boolean => {
  const [i, j] = key.split("_").map(Number)
  const s = slotOf(i!, j!)
  return s >= 0 && tiles[s] !== undefined
}

/**
 * Host only (never the sim, whose answers must not depend on residency): whether the tile a lookup
 * at (x, y) reads is in memory, so a host can read the exact map there or fall back to the coarse
 * grid (`./coarse.ts`).
 */
export const isResidentAt = (x: number, y: number): boolean => {
  const s = slotOf(indexOf(x / cell, range.i0, range.i1), indexOf(y / cell, range.j0, range.j1))
  return listed[s] === 1 && tiles[s] !== undefined
}

/** Host only: the trees of tile `key` in memory (flat (x, y, scale) triples and their ids, in the whole map's order), for the renderer to bucket. */
export const tileTrees = (
  key: string,
): { readonly trees: Float64Array; readonly ids: Int32Array } => {
  const [i, j] = key.split("_").map(Number)
  const { trees, ids } = tileAt(i!, j!).data
  return { trees, ids }
}

/** The keys of the tiles in memory, in key order. */
export const residentTiles = (): Array<string> =>
  MAP.tiles.flatMap(({ i, j }) => (tiles[slotOf(i, j)] === undefined ? [] : [tileKey(i, j)]))

/** Listed tile (i, j), fetched from the source when missing; throws when there is none. */
const tileAt = (i: number, j: number): Tile => {
  const s = slotOf(i, j)
  const here = tiles[s]
  if (here !== undefined) return here
  if (source === undefined || listed[s] !== 1)
    throw new Error(`map tile ${tileKey(i, j)} not loaded`)
  provideTile(source(tileKey(i, j)))
  return tiles[s]!
}

/** The tile index holding the cell or node `n` lattice steps from the origin, clamped to `lo`..`hi` (a last node on a seam is the lower tile's border). */
const indexOf = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.floor(n / N)))

/**
 * The terrain node (gi, gj) of the heightmap lattice (`MAP.heightmap`: col 0 at x0, row 0 at y0),
 * decimetres; the indices must already lie on the lattice (0 ≤ gi < cols, 0 ≤ gj < rows).
 */
export const nodeAt = (gi: number, gj: number): number => {
  const ni = CORNER.x + gi,
    nj = CORNER.y + gj,
    ti = indexOf(ni, range.i0, range.i1),
    tj = indexOf(nj, range.j0, range.j1)
  return tileAt(ti, tj).data.heights[(nj - N * tj) * TILE_NODES + ni - N * ti]!
}

/**
 * The four nodes of cell (gi, gj) (its corners (gi, gj) … (gi + 1, gj + 1), all on the lattice),
 * decimetres, in `out` as south-west, south-east, north-west, north-east: one tile holds them all.
 */
export const cellNodes = (gi: number, gj: number, out: Int32Array): Int32Array => {
  const ni = CORNER.x + gi,
    nj = CORNER.y + gj,
    ti = indexOf(ni, range.i0, range.i1),
    tj = indexOf(nj, range.j0, range.j1)
  const h = tileAt(ti, tj).data.heights,
    k = (nj - N * tj) * TILE_NODES + ni - N * ti
  out[0] = h[k]!
  out[1] = h[k + 1]!
  out[2] = h[k + TILE_NODES]!
  out[3] = h[k + TILE_NODES + 1]!
  return out
}

/** The land-cover index of heightmap cell (ci, cj) (on the lattice: 0 ≤ ci < cols − 1, 0 ≤ cj < rows − 1). */
export const coverCell = (ci: number, cj: number): number => {
  const ni = CORNER.x + ci,
    nj = CORNER.y + cj,
    ti = indexOf(ni, range.i0, range.i1),
    tj = indexOf(nj, range.j0, range.j1)
  return tileAt(ti, tj).data.cover[(nj - N * tj) * TILE_CELLS + ni - N * ti]!
}

/** Calls `visit` with every listed tile overlapping the box, in key order (indices clamped to the list, as the cut assigns them). */
const eachTile = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  visit: (tile: Tile) => void,
): void => {
  const i0 = indexOf(minX / cell, range.i0, range.i1),
    i1 = indexOf(maxX / cell, range.i0, range.i1),
    j0 = indexOf(minY / cell, range.j0, range.j1),
    j1 = indexOf(maxY / cell, range.j0, range.j1)
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) if (listed[slotOf(i, j)] === 1) visit(tileAt(i, j))
}

/** The keys of the listed tiles overlapping the box, in key order: what a lookup there reads (the host's residency checks use it). */
export const tilesOver = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Array<string> => {
  const keys: Array<string> = []
  const i0 = indexOf(minX / cell, range.i0, range.i1),
    i1 = indexOf(maxX / cell, range.i0, range.i1),
    j0 = indexOf(minY / cell, range.j0, range.j1),
    j1 = indexOf(maxY / cell, range.j0, range.j1)
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) if (listed[slotOf(i, j)] === 1) keys.push(tileKey(i, j))
  return keys
}

/** `a`'s values then `b`'s. */
const joined = <A extends Float64Array | Int32Array>(
  a: A,
  b: ArrayLike<number>,
  offset = 0,
  make: (n: number) => A,
): A => {
  const out = make(a.length + b.length)
  out.set(a)
  for (let k = 0; k < b.length; k++) out[a.length + k] = b[k]! + offset
  return out
}

/** The tile's broad phase of wall `kind`, built on first use on the kind's lattice, its walls answering in the whole map's order. */
const wallsOf = (tile: Tile, kind: WallKind): Walls => {
  const built = (tile.walls ??= {})[kind]
  if (built !== undefined) return built
  const { walls, wallIds } = tile.data,
    { counts, lattice } = MAP.walls
  // The land and traffic broad phases hold the walk or drive walls, then the shore's after every one of them.
  const flat =
      kind === "walk" || kind === "drive"
        ? walls[kind]
        : joined(
            kind === "land" ? walls.walk : walls.drive,
            walls.shore,
            0,
            (n) => new Float64Array(n),
          ),
    ids =
      kind === "walk" || kind === "drive"
        ? wallIds[kind]
        : joined(
            kind === "land" ? wallIds.walk : wallIds.drive,
            wallIds.shore,
            kind === "land" ? counts.walk : counts.drive,
            (n) => new Int32Array(n),
          )
  const grid = cellGrid(
    flat.length / 4,
    (i) => {
      const ax = flat[4 * i]!,
        ay = flat[4 * i + 1]!,
        bx = flat[4 * i + 2]!,
        by = flat[4 * i + 3]!
      return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]
    },
    ids,
    lattice[kind],
  )
  return (tile.walls[kind] = { flat, grid })
}

/** The tile's tree broad phase (trees as points), built on first use on the trees' lattice. */
const treesOf = (tile: Tile): CellGrid => {
  const { trees: t, ids } = tile.data
  return (tile.trees ??= cellGrid(
    t.length / 3,
    (i) => [t[3 * i]!, t[3 * i + 1]!, t[3 * i]!, t[3 * i + 1]!],
    ids,
    MAP.walls.lattice.trees,
  ))
}

/** Scratch for a query's tiles and their broad phases (reused: a query never nests). */
const treeTiles: Array<Tile> = [],
  treeGrids: Array<CellGrid> = []

/**
 * Tree broad phase (trees as points): calls `visit` with the position, scale and id (its index in
 * the whole map's list) of every tree in a cell the box overlaps, in the whole map's order cell by
 * cell; run the exact test. `visit` must not query again.
 */
export const treesIn = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  visit: (x: number, y: number, scale: number, id: number) => void,
): void => {
  treeTiles.length = 0
  treeGrids.length = 0
  const [x0, y0, x1, y1] = cellBox(MAP.walls.lattice.trees, minX, minY, maxX, maxY)
  eachTile(x0, y0, x1, y1, (tile) => {
    treeTiles.push(tile)
    treeGrids.push(treesOf(tile))
  })
  queryCells(treeGrids, MAP.walls.lattice.trees, minX, minY, maxX, maxY, (g, k) => {
    const { trees, ids } = treeTiles[g]!.data
    visit(trees[3 * k]!, trees[3 * k + 1]!, trees[3 * k + 2]!, ids[k]!)
  })
}

/** A wall edge in metres. */
export interface Segment {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
}

/** A reused answer and its reused segments. */
interface Answer {
  readonly found: Array<Segment>
  readonly pool: Array<{ ax: number; ay: number; bx: number; by: number }>
}
const answer = (): Answer => ({ found: [], pool: [] })
/** One reused answer per wall kind. */
const answers: Readonly<Record<WallKind, Answer>> = {
  walk: answer(),
  land: answer(),
  drive: answer(),
  traffic: answer(),
}
/** Scratch for `pushTrunk`: the four edges of one trunk square, 16 numbers. */
const trunk: Array<number> = []
/** Scratch for a wall query's tiles' segments and broad phases. */
const wallFlats: Array<ArrayLike<number>> = [],
  wallGrids: Array<CellGrid> = []

/**
 * Wall segments that may touch the box (a broad-phase superset: run the exact test, e.g.
 * `moveCircles`). "walk" stops anyone on foot (buildings, slopes > 35°, cliffs, walls, bounds,
 * trunks); "land" adds the water's edge, which people and animals appear clear of (none where a road
 * crosses); "drive" stops vehicles (`walk`'s plus slopes > 25° off-road, guard rails, parapets and
 * road-exit caps); "traffic" adds the water's edge to it, for what AI drivers keep to and where
 * vehicles spawn. Water stops neither feet nor wheels. Every tree trunk is a square of `pushTrunk`
 * edges. The walls come first, then the trunks, each in the order the whole map's broad phase gave
 * them (`./lattice.ts`: a wall lives in its midpoint's tile and sticks out of it by up to
 * `MAP.walls.reach`, so the tiles that far round the box are read). The array and the segments in it
 * are reused by the next call of the same kind: copy the coordinates to keep them.
 */
export const wallsNear = (
  kind: WallKind,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): ReadonlyArray<Segment> => {
  const { found, pool } = answers[kind]
  found.length = 0
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const s = pool[found.length] ?? (pool[found.length] = { ax: 0, ay: 0, bx: 0, by: 0 })
    s.ax = ax
    s.ay = ay
    s.bx = bx
    s.by = by
    found.push(s)
  }
  const r = MAP.walls.reach
  wallFlats.length = 0
  wallGrids.length = 0
  const [x0, y0, x1, y1] = cellBox(MAP.walls.lattice[kind], minX, minY, maxX, maxY)
  eachTile(x0 - r, y0 - r, x1 + r, y1 + r, (tile) => {
    const { flat, grid } = wallsOf(tile, kind)
    wallFlats.push(flat)
    wallGrids.push(grid)
  })
  queryCells(wallGrids, MAP.walls.lattice[kind], minX, minY, maxX, maxY, (g, i) => {
    const flat = wallFlats[g]!
    add(flat[4 * i]!, flat[4 * i + 1]!, flat[4 * i + 2]!, flat[4 * i + 3]!)
  })
  treesIn(minX - TRUNK / 2, minY - TRUNK / 2, maxX + TRUNK / 2, maxY + TRUNK / 2, (x, y) => {
    trunk.length = 0
    pushTrunk(trunk, x, y)
    for (let k = 0; k < trunk.length; k += 4)
      add(trunk[k]!, trunk[k + 1]!, trunk[k + 2]!, trunk[k + 3]!)
  })
  return found
}
