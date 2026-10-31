/**
 * The vectors in the tiles: every road line, river, barrier, building and area lies whole, with
 * its index in the whole map's list, in every tile it comes within `HALO` of (`TileVectors`). A
 * lookup at a point reads the point's tile alone (`placeAt`): any feature within the halo of the
 * point is there. A box query over buildings reads every tile its lattice cells reach and answers
 * in the whole map's order, each building once (`./lattice.ts`). Like the dense layers, every answer
 * is the whole map's, whichever tiles are in memory.
 *
 * @module map/vectors
 */
import { MAP } from "./global.ts"
import type { Building, RoadLine } from "./index.ts"
import { cellBox, type CellGrid, cellGrid, queryCells, visited } from "./lattice.ts"
import { derived, eachTile, placeAt, residentTile, type Tile, tilesOver } from "./tiles.ts"

/** The index of `id` in the ascending `ids`, or −1. */
const indexIn = (ids: ReadonlyArray<number>, id: number): number => {
  let lo = 0,
    hi = ids.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1,
      v = ids[mid]!
    if (v === id) return mid
    if (v < id) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

/**
 * Road `road`'s line (index into `MAP.roads`), read where a lookup at (x, y) reads, or undefined
 * when the road lies farther than `HALO` from that point's tile (a vehicle on it, someone on its
 * verge always find it).
 */
export const roadLineAt = (road: number, x: number, y: number): RoadLine | undefined => {
  const { ids, items } = placeAt(x, y).vectors.roads,
    k = indexIn(ids, road)
  return k < 0 ? undefined : items[k]
}

/** A box [minX, minY, maxX, maxY], m. */
export type Box = readonly [number, number, number, number]

/** The box of a building's outer ring (its holes lie inside it). */
export const buildingBox = (outer: ReadonlyArray<number>): Box => {
  let x0 = outer[0]!,
    y0 = outer[1]!,
    x1 = x0,
    y1 = y0
  for (let k = 2; k + 1 < outer.length; k += 2) {
    x0 = Math.min(x0, outer[k]!)
    y0 = Math.min(y0, outer[k + 1]!)
    x1 = Math.max(x1, outer[k]!)
    y1 = Math.max(y1, outer[k + 1]!)
  }
  return [x0, y0, x1, y1]
}

/** Cell side of the buildings' broad phase, m. */
const BUILDING_CELL = 64

/** A tile's buildings and their boxes, gridded on the buildings' lattice. */
interface Buildings {
  readonly ids: ReadonlyArray<number>
  readonly items: ReadonlyArray<Building>
  readonly boxes: ReadonlyArray<Box>
  readonly grid: CellGrid
}

/** Each tile's buildings' broad phase, built on first use. */
const buildingsOf = derived((tile: Tile): Buildings => {
  const { ids, items } = tile.vectors.buildings,
    boxes = items.map((b) => buildingBox(b.outer))
  return {
    ids,
    items,
    boxes,
    grid: cellGrid(
      items.length,
      (k) => boxes[k]!,
      ids,
      MAP.vectors.lattice.buildings,
      BUILDING_CELL,
    ),
  }
})

/** Scratch for a building query's tiles' buildings, and the marks of the buildings it has visited. */
const queried: Array<Buildings> = [],
  grids: Array<CellGrid> = [],
  seen = visited(MAP.vectors.counts.buildings)

/**
 * Building broad phase (64 m cells on the buildings' lattice): calls `visit` with the index into
 * the whole map's buildings, the building and its outer ring's box, of every building whose box
 * may overlap the query box (run the exact test), in the whole map's order: cells south to north,
 * west to east, each cell's buildings by index, each once. Shared by the sim and the hosts; `visit`
 * must not query again.
 */
export const buildingsIn = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  visit: (i: number, building: Building, box: Box) => void,
): void => {
  const at = MAP.vectors.lattice.buildings
  queried.length = 0
  grids.length = 0
  const [x0, y0, x1, y1] = cellBox(at, BUILDING_CELL, minX, minY, maxX, maxY)
  eachTile(x0, y0, x1, y1, (tile) => {
    const b = buildingsOf(tile)
    queried.push(b)
    grids.push(b.grid)
  })
  queryCells(
    grids,
    at,
    BUILDING_CELL,
    minX,
    minY,
    maxX,
    maxY,
    (g, k) => {
      const b = queried[g]!
      visit(b.ids[k]!, b.items[k]!, b.boxes[k]!)
    },
    seen,
  )
}

/**
 * Building `i` (index into the whole map's buildings), read where a lookup at (x, y) reads: the
 * point must lie within `HALO` of its box (its centre, a farm's baked one), or it throws.
 */
export const buildingAt = (i: number, x: number, y: number): Building => {
  const { ids, items } = placeAt(x, y).vectors.buildings,
    k = indexIn(ids, i)
  if (k < 0) throw new Error(`map: building ${i} lies nowhere near (${x}, ${y})`)
  return items[k]!
}

/** Marks of the buildings `buildingsInMemory` has visited. */
const inMemory = visited(MAP.vectors.counts.buildings)

/**
 * Host only (its answer depends on which tiles are in memory): calls `visit`, as `buildingsIn` does,
 * with every building whose box overlaps the query box in a tile in memory, each once, in no set
 * order; the tiles not in memory are passed over, never read. For a reader whose answer is order-free
 * (a sound path's most occluding building) far from the player.
 */
export const buildingsInMemory = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  visit: (i: number, building: Building, box: Box) => void,
): void => {
  if (inMemory.stamp === 0x7fffffff) {
    inMemory.marks.fill(0)
    inMemory.stamp = 0
  }
  const stamp = ++inMemory.stamp
  for (const key of tilesOver(minX, minY, maxX, maxY)) {
    const tile = residentTile(key)
    if (tile === undefined) continue
    const { ids, items, boxes } = buildingsOf(tile)
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k]!,
        box = boxes[k]!
      if (inMemory.marks[id] === stamp) continue
      if (box[0] > maxX || box[2] < minX || box[1] > maxY || box[3] < minY) continue
      inMemory.marks[id] = stamp
      visit(id, items[k]!, box)
    }
  }
}
