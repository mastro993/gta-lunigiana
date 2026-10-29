/**
 * Land cover of every 4 m terrain cell: map areas rasterised with a scanline even-odd fill
 * (`fillPolygon`), meadow where nothing covers a cell, paving where a house fronts a road, and
 * pebble beds along rivers and streams. The build rasterises the whole map once (`rasterCover`) and
 * cuts it into the tiles (src/tools/tile-map.ts); `./cover.ts` reads it there. Imports no map, so
 * the build can use it before the map exists.
 *
 * @module map/raster
 */
import { fillPolygon, segDist2 } from "../collide.ts"
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

/** Calls `visit` with each cell whose centre is within `reach` of segment a-b. */
const cellsNear = (
  heightmap: MonzoneMap["heightmap"],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  reach: number,
  visit: (k: number) => void,
) => {
  const { cell, x0, y0 } = heightmap,
    cols = heightmap.cols - 1,
    rows = heightmap.rows - 1
  const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / cell)),
    i1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx) + reach - x0) / cell))
  const j0 = Math.max(0, Math.floor((Math.min(ay, by) - reach - y0) / cell)),
    j1 = Math.min(rows - 1, Math.floor((Math.max(ay, by) + reach - y0) / cell))
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      if (
        segDist2(x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell, ax, ay, bx, by).d2 <=
        reach * reach
      )
        visit(j * cols + i)
    }
}

/** Extra pebble bed beyond the water's half-width, by water width (m); narrow streams get none. */
const bankOf = (w: number): number => (w >= 12 ? 5 : w >= 8 ? 3 : w >= 4 ? 1.5 : 0)

/**
 * The cover of every terrain cell, row-major with row 0 = south, `(cols − 1) × (rows − 1)` cells
 * of the heightmap. Forest is filled first, so every other area and the river beds draw over it.
 */
export const rasterCover = (map: {
  readonly heightmap: MonzoneMap["heightmap"]
  readonly areas: ReadonlyArray<Area>
  readonly water: ReadonlyArray<Omit<Water, "floor">>
  readonly roads: ReadonlyArray<Road>
  readonly buildings: ReadonlyArray<Building>
}): Uint8Array => {
  const { cell, x0, y0 } = map.heightmap
  const cols = map.heightmap.cols - 1,
    rows = map.heightmap.rows - 1
  const out = new Uint8Array(cols * rows)
  const ordered = [...map.areas].sort(
    (a, b) => (coverIndex.get(a.kind) ?? 0) - (coverIndex.get(b.kind) ?? 0),
  )
  for (const area of ordered) {
    const cover = coverIndex.get(area.kind)
    if (cover !== undefined)
      fillPolygon(area.rings, x0, y0, cell, cols, rows, (k) => (out[k] = cover))
  }
  // Open ground (meadow, residential grass) both near a wall and near a road edge.
  const fronting = new Uint8Array(cols * rows),
    open = new Set([coverIndex.get("meadow"), coverIndex.get("residential")]),
    paved = coverIndex.get("paved")!
  for (const b of map.buildings)
    for (let k = 0, n = b.outer.length; k < n; k += 2) {
      cellsNear(
        map.heightmap,
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
