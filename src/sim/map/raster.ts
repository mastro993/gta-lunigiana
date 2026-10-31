/**
 * Land cover of every 4 m terrain cell: map areas rasterised with a scanline even-odd fill
 * (`fillPolygon`), meadow where nothing covers a cell, paving where a house fronts a road, and
 * pebble beds along rivers and streams. The build rasterises each tile's cells (`coverBlocks`, the
 * cells a raster of the whole map gives there) as it cuts the tiles
 * (src/tools/tile-map.ts); `./cover.ts` reads them there. Imports no map, so the build can use it
 * before the map exists.
 *
 * @module map/raster
 */
import { fillPolygon, type PixelBlock, segDist2 } from "../collide.ts"
import type { Area, AreaKind, Building, MonzoneMap, Road, Water } from "./index.ts"

/** Cover kinds: meadow by default, the map's area kinds, and the river bed. */
export type Cover = "meadow" | AreaKind | "pebble"
/** Every cover, in fill order: later kinds draw over earlier ones. */
const COVERS = [
  "meadow",
  "forest",
  "grassland",
  "scrub",
  "sparse",
  "scree",
  "rock",
  "quarry",
  "residential",
  "farmland",
  "farmyard",
  "vineyard",
  "park",
  "school",
  "cemetery",
  "pitch",
  "parking",
  "industrial",
  "paved",
  "platform",
  "ruins",
  "pebble",
] as const satisfies ReadonlyArray<Cover>

const coverIndex = new Map<string, number>(COVERS.map((c, i) => [c, i]))

/** Metres from a wall and from a road's edge within which open ground is paved: house fronts, sidewalks, alleys. */
const FRONT = 3

/** Calls `visit` with each cell of `block` whose centre is within `reach` of segment a-b, by its index in the block. */
const cellsNear = (
  heightmap: MonzoneMap["heightmap"],
  block: PixelBlock,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  reach: number,
  visit: (k: number) => void,
) => {
  const { cell, x0, y0 } = heightmap
  const i0 = Math.max(block.c0, Math.floor((Math.min(ax, bx) - reach - x0) / cell)),
    i1 = Math.min(block.c0 + block.cols - 1, Math.floor((Math.max(ax, bx) + reach - x0) / cell))
  const j0 = Math.max(block.r0, Math.floor((Math.min(ay, by) - reach - y0) / cell)),
    j1 = Math.min(block.r0 + block.rows - 1, Math.floor((Math.max(ay, by) + reach - y0) / cell))
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      if (
        segDist2(x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell, ax, ay, bx, by).d2 <=
        reach * reach
      )
        visit((j - block.r0) * block.cols + i - block.c0)
    }
}

/** Extra pebble bed beyond the water's half-width, by water width (m); narrow streams get none. */
const bankOf = (w: number): number => (w >= 12 ? 5 : w >= 8 ? 3 : w >= 4 ? 1.5 : 0)

/** What the cover is rasterised from. */
interface CoverSource {
  readonly heightmap: MonzoneMap["heightmap"]
  readonly areas: ReadonlyArray<Area>
  readonly water: ReadonlyArray<Omit<Water, "floor">>
  readonly roads: ReadonlyArray<Road>
  readonly buildings: ReadonlyArray<Building>
}

/**
 * The cover of `map`'s terrain cells, a block at a time: the cells of `part` (every cell when
 * absent: the `(cols − 1) × (rows − 1)` cells of the heightmap), row-major with row 0 = south.
 * Forest is filled first, so every other area and the river beds draw over it, and a block's cells
 * come out as in the whole raster. The areas are sorted and boxed once, and each block fills only
 * those whose box comes within a cell of it (the build asks for every tile, and a scan of every
 * area's rows for each tile grew with the square of the map).
 */
export const coverBlocks = (map: CoverSource): ((part?: PixelBlock) => Uint8Array) => {
  const cols = map.heightmap.cols - 1,
    rows = map.heightmap.rows - 1
  const ordered = [...map.areas]
    .sort((a, b) => (coverIndex.get(a.kind) ?? 0) - (coverIndex.get(b.kind) ?? 0))
    .flatMap(({ kind, rings }) => {
      const cover = coverIndex.get(kind)
      if (cover === undefined) return []
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity
      for (const ring of rings)
        for (let k = 0; k < ring.length; k += 2) {
          minX = Math.min(minX, ring[k]!)
          maxX = Math.max(maxX, ring[k]!)
          minY = Math.min(minY, ring[k + 1]!)
          maxY = Math.max(maxY, ring[k + 1]!)
        }
      return [{ cover, rings, minX, minY, maxX, maxY }]
    })
  return (part) => paint(map, ordered, part ?? { c0: 0, r0: 0, cols, rows }, cols, rows)
}

/** One block of the cover: the areas `ordered` whose box meets it filled in turn, then the paving and the river beds. */
const paint = (
  map: CoverSource,
  ordered: ReadonlyArray<{
    readonly cover: number
    readonly rings: ReadonlyArray<ReadonlyArray<number>>
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
  }>,
  block: PixelBlock,
  cols: number,
  rows: number,
): Uint8Array => {
  const { cell, x0, y0 } = map.heightmap
  const out = new Uint8Array(block.cols * block.rows)
  // A pixel is filled only where its centre lies in the area's box: a cell's margin on each side.
  const bx0 = x0 + (block.c0 - 1) * cell,
    bx1 = x0 + (block.c0 + block.cols + 1) * cell,
    by0 = y0 + (block.r0 - 1) * cell,
    by1 = y0 + (block.r0 + block.rows + 1) * cell
  for (const { cover, rings, minX, minY, maxX, maxY } of ordered)
    if (maxX >= bx0 && minX <= bx1 && maxY >= by0 && minY <= by1)
      fillPolygon(rings, x0, y0, cell, cols, rows, (k) => (out[k] = cover), block)
  // Open ground (meadow, residential grass) both near a wall and near a road edge.
  const fronting = new Uint8Array(block.cols * block.rows),
    open = new Set([coverIndex.get("meadow"), coverIndex.get("residential")]),
    paved = coverIndex.get("paved")!
  for (const b of map.buildings)
    for (let k = 0, n = b.outer.length; k < n; k += 2) {
      cellsNear(
        map.heightmap,
        block,
        b.outer[k]!,
        b.outer[k + 1]!,
        b.outer[(k + 2) % n]!,
        b.outer[(k + 3) % n]!,
        FRONT,
        (c) => (fronting[c] = 1),
      )
    }
  for (const r of map.roads) {
    if (r.tunnel === true) continue
    for (let k = 0; k + 3 < r.pts.length; k += 2) {
      cellsNear(
        map.heightmap,
        block,
        r.pts[k]!,
        r.pts[k + 1]!,
        r.pts[k + 2]!,
        r.pts[k + 3]!,
        r.w / 2 + FRONT,
        (c) => {
          if (fronting[c] === 1 && open.has(out[c])) out[c] = paved
        },
      )
    }
  }
  const pebble = coverIndex.get("pebble")!
  for (const w of map.water) {
    const reach = w.w / 2 + bankOf(w.w)
    if (reach <= w.w / 2) continue
    for (let k = 0; k + 3 < w.pts.length; k += 2)
      cellsNear(
        map.heightmap,
        block,
        w.pts[k]!,
        w.pts[k + 1]!,
        w.pts[k + 2]!,
        w.pts[k + 3]!,
        reach,
        (c) => (out[c] = pebble),
      )
  }
  return out
}

/** The cover name of a raster value. */
export const coverName = (value: number): Cover => COVERS[value] ?? "meadow"
