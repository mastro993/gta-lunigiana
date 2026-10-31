/**
 * The tiles in memory: the dense layers (terrain nodes, walls, trees, land cover) of the 2 km
 * squares the host has handed over (`provideTile`) and the vectors round them, and the terrain and
 * cover lookups that read them (the walls' and trees' broad phases are `./walls.ts`, the vectors'
 * `./vectors.ts`). A lookup in a listed tile that is not here asks the tile source (Node: the tile
 * file on disk); with none, it throws "map tile i_j not loaded". Every answer is a pure function of
 * the map, never of which tiles are here or in which order they came: what a lookup builds from a
 * tile (a broad phase, a bucket of road segments) it builds from that tile alone, on first use
 * (`derived`), and a query answers in the whole map's order whichever tiles hold its items
 * (`./lattice.ts`).
 * The listed tiles (`MAP.tiles`) need not fill the box of tiles round them: an L-shaped map leaves
 * its notch unlisted, with no file. A terrain or land-cover lookup there reads the nearest node or
 * cell of the listed tiles round it (`nearest`); a wall or tree whose midpoint falls there (an
 * outline wall on the notch's side, a house wall over it) the cut kept in the one of those tiles
 * nearest its midpoint (the first in key order on a tie), and a vector near it in all of them, so a
 * wall, tree or vector lookup over the notch reads them all (`placeAt`); and `tilesOver` names them,
 * so the host's residency checks cover both.
 * So residency is never observable, and the host decides it alone: it keeps every listed tile
 * overlapping [player ± `STEP_REACH`]² before each step, and the sim reads nothing farther away
 * (vehicles past `FROZEN_BEYOND` stand frozen).
 *
 * Immutable map content plus host-owned residency, never gameplay state: shared by every runtime.
 *
 * @module map/tiles
 */
import { MAP } from "./global.ts"
import { TILE, tileKey, tilesRound } from "./kinds.ts"
import {
  decodeTile,
  type Layer,
  onDisk,
  readMapFile,
  TILE_CELLS,
  TILE_NODES,
  type TileData,
  type TileVectors,
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
/** The box of tile indices round the listed tiles. */
const range = {
  i0: Math.min(...MAP.tiles.map(({ i }) => i)),
  i1: Math.max(...MAP.tiles.map(({ i }) => i)),
  j0: Math.min(...MAP.tiles.map(({ j }) => j)),
  j1: Math.max(...MAP.tiles.map(({ j }) => j)),
}
const across = range.i1 - range.i0 + 1
const slots = across * (range.j1 - range.j0 + 1)

/** The slot of tile (i, j) in the tables below, or -1 off the listed range. */
const slotOf = (i: number, j: number): number =>
  i < range.i0 || i > range.i1 || j < range.j0 || j > range.j1
    ? -1
    : (j - range.j0) * across + i - range.i0
/** The tile in slot `s`, and its key. */
const iOf = (s: number) => range.i0 + (s % across),
  jOf = (s: number) => range.j0 + Math.floor(s / across),
  keyOf = (s: number) => tileKey(iOf(s), jOf(s))
const listed = new Uint8Array(slots)
for (const { i, j } of MAP.tiles) listed[slotOf(i, j)] = 1

/** The box of tile indices round the listed tiles: not every tile in it need be listed (`isListed`). */
export const TILE_RANGE: Readonly<typeof range> = range

/** Whether tile (i, j) is listed: on the map, with a file (an L-shaped map's notch is not). */
export const isListed = (i: number, j: number): boolean => listed[slotOf(i, j)] === 1

/**
 * Per unlisted slot of the range, the listed tiles a lookup there reads, in key order: those of the
 * nearest ring of tiles round it that holds any (`tilesRound`: its listed neighbours, in an L's
 * notch). Empty for a listed slot.
 */
const around: ReadonlyArray<ReadonlyArray<number>> = Array.from({ length: slots }, (_, s) =>
  listed[s] === 1 ? [] : tilesRound(iOf(s), jOf(s), isListed).map(([i, j]) => slotOf(i, j)),
)

/** A tile in memory: its data, and the vectors in it (`./vectors.ts` reads them). */
export interface Tile {
  readonly data: TileData
  readonly vectors: TileVectors
}
const tiles: Array<Tile | undefined> = Array.from({ length: slots })

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
  tiles[s] ??= { data, vectors: data.vectors }
}

/** Lets a tile go (the host, once nothing near the player or in view needs it). */
export const dropTile = (key: string): void => {
  const [i, j] = key.split("_").map(Number)
  const s = slotOf(i!, j!)
  if (s < 0) return
  tiles[s] = undefined
  for (const t of reading[s]!) notches[t] = undefined
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
  return listed[s] === 1 ? tiles[s] !== undefined : around[s]!.every((t) => tiles[t] !== undefined)
}

/** Host only: the trees of tile `key` in memory (flat (x, y, scale) triples and their ids, in the whole map's order), for the renderer to bucket. */
export const tileTrees = (
  key: string,
): { readonly trees: Float64Array; readonly ids: Int32Array } => {
  const [i, j] = key.split("_").map(Number)
  const { trees, ids } = tileAt(i!, j!).data
  return { trees, ids }
}

/** Host only: the vectors of tile `key` in memory (`TileVectors`), for the renderer and the minimap to draw. */
export const tileVectors = (key: string): TileVectors => {
  const [i, j] = key.split("_").map(Number)
  return tileAt(i!, j!).vectors
}

/** Host only: tile `key` if it is in memory, never read from the source. */
export const residentTile = (key: string): Tile | undefined => {
  const [i, j] = key.split("_").map(Number)
  const s = slotOf(i!, j!)
  return s < 0 ? undefined : tiles[s]
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

/** The lattice's last node along x and y, counted from the origin as `CORNER` is. */
const LAST = { x: CORNER.x + MAP.heightmap.cols - 1, y: CORNER.y + MAP.heightmap.rows - 1 }
/** What `nearest` found: a listed tile and a lattice point in it, counted from the origin. */
const found = { ti: 0, tj: 0, ni: 0, nj: 0 }

/**
 * The listed tile round unlisted slot `s` (`around`) holding the lattice point nearest (ni, nj),
 * counted from the origin: a node (`cells` 0: a tile holds its N + 1 along each side) or a cell
 * (`cells` 1: it holds N). Ties go to the tile first in key order. Answers in `found`.
 */
const nearest = (s: number, ni: number, nj: number, cells: 0 | 1): typeof found => {
  let best = Infinity
  for (const t of around[s]!) {
    const ti = iOf(t),
      tj = jOf(t)
    const x = Math.min(LAST.x - cells, N * ti + N - cells, Math.max(CORNER.x, N * ti, ni)),
      y = Math.min(LAST.y - cells, N * tj + N - cells, Math.max(CORNER.y, N * tj, nj)),
      d = (x - ni) * (x - ni) + (y - nj) * (y - nj)
    if (d < best) [best, found.ti, found.tj, found.ni, found.nj] = [d, ti, tj, x, y]
  }
  return found
}

/**
 * The terrain node (gi, gj) of the heightmap lattice (`MAP.heightmap`: col 0 at x0, row 0 at y0),
 * decimetres; the indices must already lie on the lattice (0 ≤ gi < cols, 0 ≤ gj < rows). In an
 * unlisted tile, the nearest listed node's (`nearest`).
 */
export const nodeAt = (gi: number, gj: number): number => {
  let ni = CORNER.x + gi,
    nj = CORNER.y + gj,
    ti = indexOf(ni, range.i0, range.i1),
    tj = indexOf(nj, range.j0, range.j1)
  const s = slotOf(ti, tj)
  if (listed[s] !== 1) ({ ti, tj, ni, nj } = nearest(s, ni, nj, 0))
  return tileAt(ti, tj).data.heights[(nj - N * tj) * TILE_NODES + ni - N * ti]!
}

/**
 * The four nodes of cell (gi, gj) (its corners (gi, gj) … (gi + 1, gj + 1), all on the lattice),
 * decimetres, in `out` as south-west, south-east, north-west, north-east: one tile holds them all,
 * but in an unlisted tile each is its nearest listed node (`nodeAt`).
 */
export const cellNodes = (gi: number, gj: number, out: Int32Array): Int32Array => {
  const ni = CORNER.x + gi,
    nj = CORNER.y + gj,
    ti = indexOf(ni, range.i0, range.i1),
    tj = indexOf(nj, range.j0, range.j1)
  if (listed[slotOf(ti, tj)] !== 1) {
    out[0] = nodeAt(gi, gj)
    out[1] = nodeAt(gi + 1, gj)
    out[2] = nodeAt(gi, gj + 1)
    out[3] = nodeAt(gi + 1, gj + 1)
    return out
  }
  const h = tileAt(ti, tj).data.heights,
    k = (nj - N * tj) * TILE_NODES + ni - N * ti
  out[0] = h[k]!
  out[1] = h[k + 1]!
  out[2] = h[k + TILE_NODES]!
  out[3] = h[k + TILE_NODES + 1]!
  return out
}

/**
 * The land-cover index of heightmap cell (ci, cj) (on the lattice: 0 ≤ ci < cols − 1, 0 ≤ cj < rows −
 * 1); in an unlisted tile, the nearest listed cell's (`nearest`).
 */
export const coverCell = (ci: number, cj: number): number => {
  let ni = CORNER.x + ci,
    nj = CORNER.y + cj,
    ti = indexOf(ni, range.i0, range.i1),
    tj = indexOf(nj, range.j0, range.j1)
  const s = slotOf(ti, tj)
  if (listed[s] !== 1) ({ ti, tj, ni, nj } = nearest(s, ni, nj, 1))
  return tileAt(ti, tj).data.cover[(nj - N * tj) * TILE_CELLS + ni - N * ti]!
}

/**
 * A lookup's memo of what it builds from a tile (or a place, `placeAt`): `make`'s value for it,
 * made on first use and kept while it is in memory (a dropped tile's goes with it).
 */
export const derived = <K extends object, T>(make: (key: K) => T): ((key: K) => T) => {
  const made = new WeakMap<K, T>()
  return (key) => {
    let value = made.get(key)
    if (value === undefined) made.set(key, (value = make(key)))
    return value
  }
}

/** What a lookup at a point reads of the vectors: those of the tile holding it (`placeAt`). */
export type Place = Pick<Tile, "vectors">

/** Per unlisted slot, its place once a lookup has read there: the vectors of the listed tiles round it, merged. */
const notches: Array<Place | undefined> = Array.from({ length: slots })
/** Per listed slot, the unlisted slots whose place reads it. */
const reading: ReadonlyArray<Array<number>> = Array.from({ length: slots }, () => [])
around.forEach((list, s) => {
  for (const t of list) reading[t]!.push(s)
})

/** The features of `layers` (any order) as one layer: each once, in the whole map's order. */
const mergedLayer = <T>(layers: ReadonlyArray<Layer<T>>): Layer<T> => {
  const byId = new Map<number, T>()
  for (const { ids, items } of layers) ids.forEach((id, k) => byId.set(id, items[k]!))
  const ids = [...byId.keys()].sort((a, b) => a - b)
  return { ids, items: ids.map((id) => byId.get(id)!) }
}

/**
 * The place a lookup at (x, y) reads the vectors of: the listed tile holding the point (clamped to
 * the list, as the terrain's lookups are), or in an unlisted one the vectors of the listed tiles
 * round it (`around`), merged: the cut gave them every feature near it. A tile holds the features
 * within `HALO` of its square, so any feature within that of the point is there.
 */
export const placeAt = (x: number, y: number): Place => {
  const s = slotOf(indexOf(x / cell, range.i0, range.i1), indexOf(y / cell, range.j0, range.j1))
  if (listed[s] === 1) return tileAt(iOf(s), jOf(s))
  const near = around[s]!.map((t) => tileAt(iOf(t), jOf(t)).vectors)
  return (notches[s] ??= {
    vectors: {
      roads: mergedLayer(near.map((v) => v.roads)),
      buildings: mergedLayer(near.map((v) => v.buildings)),
      water: mergedLayer(near.map((v) => v.water)),
      areas: mergedLayer(near.map((v) => v.areas)),
      barriers: mergedLayer(near.map((v) => v.barriers)),
    },
  })
}

/** Scratch for `eachTile`: the slots it visited for the unlisted ones in the box. */
const visited: Array<number> = []

/**
 * Calls `visit` with every listed tile overlapping the box (indices clamped to the list, as the cut
 * assigns them), in key order, then those round an unlisted one in it (`around`, where the cut kept
 * its walls and trees) not visited yet; each tile once.
 */
export const eachTile = (
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
  let notch = false
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++)
      if (listed[slotOf(i, j)] === 1) visit(tileAt(i, j))
      else notch = true
  if (!notch) return
  visited.length = 0
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++)
      for (const t of around[slotOf(i, j)]!) {
        const ti = iOf(t),
          tj = jOf(t)
        if ((ti >= i0 && ti <= i1 && tj >= j0 && tj <= j1) || visited.includes(t)) continue
        visited.push(t)
        visit(tileAt(ti, tj))
      }
}

/**
 * The keys of the tiles a lookup over the box reads, in key order (the host's residency checks use
 * it): the listed tiles overlapping it, and for an unlisted one the listed tiles round it (`around`).
 */
export const tilesOver = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Array<string> => {
  const read: Array<number> = []
  const i0 = indexOf(minX / cell, range.i0, range.i1),
    i1 = indexOf(maxX / cell, range.i0, range.i1),
    j0 = indexOf(minY / cell, range.j0, range.j1),
    j1 = indexOf(maxY / cell, range.j0, range.j1)
  let notch = false
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const s = slotOf(i, j)
      if (listed[s] === 1) read.push(s)
      else {
        notch = true
        read.push(...around[s]!)
      }
    }
  return (notch ? [...new Set(read)].sort((a, b) => a - b) : read).map(keyOf)
}
