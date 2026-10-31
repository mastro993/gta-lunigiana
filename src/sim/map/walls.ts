/**
 * The walls' and trees' broad phases over the tiles in memory (`./tiles.ts`): each tile's walls and
 * trees gridded on the whole map's lattice for their kind on first use, a query answering in the
 * whole map's order whichever tiles hold its items (`./lattice.ts`).
 *
 * @module map/walls
 */
import { MAP } from "./global.ts"
import { pushTrunk, TRUNK } from "./kinds.ts"
import { CELL, cellBox, type CellGrid, cellGrid, queryCells } from "./lattice.ts"
import { derived, eachTile, type Tile } from "./tiles.ts"

/** The kinds of wall `wallsNear` answers. */
export type WallKind = "walk" | "land" | "drive" | "traffic"

/** A wall broad phase over one tile's flat (ax, ay, bx, by) segments. */
interface Walls {
  readonly flat: ArrayLike<number>
  readonly grid: CellGrid
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

/** The tile's broad phase of wall `kind` on the kind's lattice, its walls answering in the whole map's order. */
const wallGrid = (tile: Tile, kind: WallKind): Walls => {
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
    CELL,
  )
  return { flat, grid }
}

/** Each tile's broad phase of each wall kind, built on first use. */
const wallsOf: Readonly<Record<WallKind, (tile: Tile) => Walls>> = {
  walk: derived((tile) => wallGrid(tile, "walk")),
  land: derived((tile) => wallGrid(tile, "land")),
  drive: derived((tile) => wallGrid(tile, "drive")),
  traffic: derived((tile) => wallGrid(tile, "traffic")),
}

/** The tile's tree broad phase (trees as points) on the trees' lattice, built on first use. */
const treesOf = derived((tile: Tile): CellGrid => {
  const { trees: t, ids } = tile.data
  return cellGrid(
    t.length / 3,
    (i) => [t[3 * i]!, t[3 * i + 1]!, t[3 * i]!, t[3 * i + 1]!],
    ids,
    MAP.walls.lattice.trees,
    CELL,
  )
})

/** Scratch for a query's tiles and their broad phases (reused: a query never nests). */
const treeTiles: Array<Tile> = [],
  treeGrids: Array<CellGrid> = []

/**
 * Tree broad phase (trees as points): calls `visit` with the position, scale and id (its look's
 * seed, src/tools/trees.ts) of every tree in a cell the box overlaps, in the whole map's order (by
 * id) cell by cell; run the exact test. `visit` must not query again.
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
  const [x0, y0, x1, y1] = cellBox(MAP.walls.lattice.trees, CELL, minX, minY, maxX, maxY)
  eachTile(x0, y0, x1, y1, (tile) => {
    treeTiles.push(tile)
    treeGrids.push(treesOf(tile))
  })
  queryCells(treeGrids, MAP.walls.lattice.trees, CELL, minX, minY, maxX, maxY, (g, k) => {
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
  const [x0, y0, x1, y1] = cellBox(MAP.walls.lattice[kind], CELL, minX, minY, maxX, maxY)
  eachTile(x0 - r, y0 - r, x1 + r, y1 + r, (tile) => {
    const { flat, grid } = wallsOf[kind](tile)
    wallFlats.push(flat)
    wallGrids.push(grid)
  })
  queryCells(wallGrids, MAP.walls.lattice[kind], CELL, minX, minY, maxX, maxY, (g, i) => {
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
