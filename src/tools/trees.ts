// The deterministic tree scatter: a jittered lattice inside forest, plus sparse trees on the banks
// of the wider streams. Its 2 m masks (forest, other areas, buildings) are rasterised a row of 2 km
// tiles at a time, on the whole raster's lattice, and let go once the lattice has passed the row;
// a 1 m bit set over the bounds keeps the first tree on each spot. The trees and their order are
// those of one raster over the whole map.
import type { Area } from "../sim/map/index.ts"
import { TILE } from "../sim/map/kinds.ts"
import type { BuildingF, RailF, RoadF, WaterF } from "./features.ts"
import {
  arcLengths,
  BOUNDS,
  fillPolygon,
  hash01,
  pointAt,
  r1,
  ringBox,
  segIndex,
} from "./geometry.ts"

const TREE_AREA = 50 // m² per tree
const MASK_RES = 2

type Polygon = ReadonlyArray<ReadonlyArray<number>>

/**
 * Rasters of the bounds at MASK_RES m, each the union of its `kinds` polygons, made a row of 2 km
 * tiles at a time when a lookup first needs one (each polygon's scanlines worked out once): `at(kind,
 * x, y)` reads one (false off the raster), `drop(y)` lets go every row wholly south of y (a row
 * let go is never made again: asking for it throws), `rowAt` names the row a lookup at (x, y)
 * reads, and `onRow` hears each row as its rasters are made.
 */
const rowMasks = (kinds: ReadonlyArray<ReadonlyArray<Polygon>>, onRow: (j: number) => void) => {
  const { minX, minY, maxX, maxY } = BOUNDS
  const cols = Math.ceil((maxX - minX) / MASK_RES),
    rows = Math.ceil((maxY - minY) / MASK_RES)
  if (minY % MASK_RES !== 0)
    throw new Error(`the bounds' south edge ${minY} is off the ${MASK_RES} m mask lattice`)
  const spans = kinds.map((polys) =>
    polys.map((rings) => {
      let lo = Infinity,
        hi = -Infinity
      for (const ring of rings) {
        const [, y0, , y1] = ringBox(ring)
        ;[lo, hi] = [Math.min(lo, y0), Math.max(hi, y1)]
      }
      return [lo, hi] as const
    }),
  )
  /** A row's rasters: its cell rows of the whole raster, one mask per kind. */
  interface Row {
    readonly j: number
    readonly r0: number
    readonly masks: ReadonlyArray<Uint8Array>
  }
  const made = new Map<number, Row>(),
    gone = new Set<number>()
  let last: Row | undefined
  /** The row of tiles holding cell row r (the tiles' corners lie on the mask lattice). */
  const rowOf = (r: number) => Math.floor((minY + r * MASK_RES) / TILE)
  const rowAt = (j: number): Row => {
    if (last?.j === j) return last
    const known = made.get(j)
    if (known !== undefined) return (last = known)
    if (gone.has(j)) throw new Error(`tree masks: row ${j} of tiles made again after it was let go`)
    const r0 = Math.max(0, (TILE * j - minY) / MASK_RES)
    const block = { c0: 0, r0, cols, rows: Math.min(rows, (TILE * (j + 1) - minY) / MASK_RES) - r0 }
    const [ey0, ey1] = [minY + r0 * MASK_RES, minY + (r0 + block.rows) * MASK_RES]
    // Even-odd within each polygon (fillPolygon visits a pixel once per polygon), OR across them.
    const masks = kinds.map((polys, kind) => {
      const m = new Uint8Array(cols * block.rows)
      polys.forEach((rings, p) => {
        const [lo, hi] = spans[kind]![p]!
        if (lo <= ey1 && hi >= ey0)
          fillPolygon(rings, minX, minY, MASK_RES, cols, rows, (k) => (m[k] = 1), block)
      })
      return m
    })
    const row = { j, r0, masks }
    made.set(j, row)
    last = row
    onRow(j)
    return row
  }
  const cellOf = (x: number, y: number) => {
    const c = Math.floor((x - minX) / MASK_RES),
      r = Math.floor((y - minY) / MASK_RES)
    return c < 0 || r < 0 || c >= cols || r >= rows ? undefined : ([c, r] as const)
  }
  return {
    at: (kind: number, x: number, y: number): boolean => {
      const cell = cellOf(x, y)
      if (cell === undefined) return false
      const t = rowAt(rowOf(cell[1]))
      return t.masks[kind]![(cell[1] - t.r0) * cols + cell[0]] === 1
    },
    drop: (y: number) => {
      for (const [j] of made)
        if (TILE * (j + 1) <= y) {
          made.delete(j)
          gone.add(j)
        }
    },
    rowAt: (x: number, y: number): number | undefined => {
      const cell = cellOf(x, y)
      return cell === undefined ? undefined : rowOf(cell[1])
    },
  }
}

/** Flat (x, y, scale) triples (positions to the metre: scatter needs no more, and it keeps the JSON small): a jittered ~7 m lattice inside forest, plus sparse trees on river banks. */
export const scatterTrees = (
  areas: ReadonlyArray<Area>,
  roads: ReadonlyArray<RoadF>,
  buildings: ReadonlyArray<BuildingF>,
  water: ReadonlyArray<WaterF>,
  rail: ReadonlyArray<RailF>,
): Array<number> => {
  const keepOut = segIndex<null>()
  for (const r of roads) keepOut.addLine(r.pts, r.w / 2 + 2, null)
  for (const b of buildings) keepOut.addLine([...b.outer, b.outer[0]!, b.outer[1]!], 2, null)
  for (const w of water) keepOut.addLine(w.pts, w.bed, null)
  for (const r of rail) if (r.tunnel !== true) keepOut.addLine(r.pts, 6, null)
  // The bank trees' candidates, in order; whether each stands clear is read while its tile's
  // rasters are in memory, and they are planted after every lattice tree.
  const bank = { x: [] as Array<number>, y: [] as Array<number>, scale: [] as Array<number> }
  water.forEach((w, wi) => {
    if (w.w < 4) return
    const s = arcLengths(w.pts),
      total = s.at(-1)!
    for (let k = 0; k * 9 < total; k++)
      for (const side of [1, -1]) {
        if (hash01(wi, k, side, 4) > 0.55) continue
        const p = pointAt(w.pts, s, k * 9),
          off = side * (w.bed + 2 + 3 * hash01(wi, k, side, 5))
        bank.x.push(p.x - p.ty * off)
        bank.y.push(p.y + p.tx * off)
        bank.scale.push(0.8 + 0.5 * hash01(wi, k, side, 6))
      }
  })
  const clear = new Uint8Array(bank.x.length)
  const bankOf = new Map<number, Array<number>>()
  const FOREST = 0,
    OPEN = 1,
    BUILT = 2
  const masks = rowMasks(
    [
      areas.filter((a) => a.kind === "forest").map((a) => a.rings),
      areas.filter((a) => a.kind !== "forest").map((a) => a.rings),
      buildings.map((b) => [b.outer, ...(b.holes ?? [])]),
    ],
    (j) => {
      for (const b of bankOf.get(j) ?? [])
        clear[b] = !masks.at(FOREST, bank.x[b]!, bank.y[b]!) && free(bank.x[b]!, bank.y[b]!) ? 1 : 0
      bankOf.delete(j)
    },
  )
  // Trees cover the built terrain, beyond the play area too, standing 1 m inside its box.
  const { minX, minY, maxX, maxY } = BOUNDS
  const free = (x: number, y: number) =>
    x >= minX + 1 &&
    x <= maxX - 1 &&
    y >= minY + 1 &&
    y <= maxY - 1 &&
    !masks.at(OPEN, x, y) &&
    !masks.at(BUILT, x, y) &&
    !keepOut.covers(x, y)
  bank.x.forEach((x, b) => {
    const key = masks.rowAt(x, bank.y[b]!),
      list = key === undefined ? undefined : bankOf.get(key)
    if (list !== undefined) list.push(b)
    else if (key !== undefined) bankOf.set(key, [b])
  })
  const trees: Array<number> = []
  // Rounded to the metre, two jittered points can land on one spot: keep the first (a bit per
  // metre of the bounds; every tree stands 1 m inside them).
  const across = maxX - minX + 1,
    planted = new Uint8Array(Math.ceil((across * (maxY - minY + 1)) / 8))
  const plant = (x: number, y: number, scale: number) => {
    const tx = Math.round(x),
      ty = Math.round(y),
      bit = (ty - minY) * across + tx - minX
    if ((planted[bit >> 3]! >> (bit & 7)) & 1) return
    planted[bit >> 3]! |= 1 << (bit & 7)
    trees.push(tx, ty, r1(scale))
  }
  const step = Math.sqrt(TREE_AREA)
  for (let gj = 0; gj * step < maxY - minY; gj++) {
    // Rows run south to north: a row of tiles wholly south of this one (by a cell) is done with.
    masks.drop(minY + gj * step - MASK_RES)
    for (let gi = 0; gi * step < maxX - minX; gi++) {
      const x = minX + (gi + hash01(gi, gj, 1)) * step,
        y = minY + (gj + hash01(gi, gj, 2)) * step
      if (masks.at(FOREST, x, y) && free(x, y)) plant(x, y, 0.8 + 0.5 * hash01(gi, gj, 3))
    }
  }
  // Banks in a row no lattice point read (a row's banks are judged, and left, as its rasters are
  // made): reading one there makes its rasters, and reads them all.
  for (const list of bankOf.values()) masks.at(FOREST, bank.x[list[0]!]!, bank.y[list[0]!]!)
  bank.x.forEach((x, b) => {
    if (clear[b] === 1) plant(x, bank.y[b]!, bank.scale[b]!)
  })
  return trees
}
