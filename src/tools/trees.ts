// The deterministic tree scatter: a jittered lattice inside forest, plus sparse trees on the banks
// of the wider streams. The lattice and its 2 m masks (forest, other areas, buildings) start at the
// region's anchor, fixed for good, and a tree's id is its lattice cell's number (a bank tree's, its
// 4 m cell's, past every lattice cell's), so no lattice tree moves, and no tree changes its id or
// its look, as parts are added (a bank tree keeps its step along its way, but stands off its
// piece's bed, which may change where the outline cuts the way). The scatter works a window at a
// time (in the build, each of the region's 2 km tiles), rasterising the masks over the window
// alone; a tree belongs to the window holding its rounded point, so two lattice points that round
// onto one spot meet in one window, which keeps the first.
import type { Area } from "../sim/map/index.ts"
import { TILE } from "../sim/map/kinds.ts"
import type { BuildingF, RailF, RoadF, WaterF } from "./features.ts"
import { arcLengths, fillPolygon, hash01, pointAt, r1, ringBox, segIndex } from "./geometry.ts"
import type { Rect, Region } from "./region.ts"
import { mergeTrees, type TreeList } from "./tile-map.ts"

const TREE_AREA = 50 // m² per tree
/** The lattice's step, m: one cell, and at most one tree, per TREE_AREA. */
const STEP = Math.sqrt(TREE_AREA)
const MASK_RES = 2
/** A bank tree may stand every BANK_STEP m along its stream's way, on either side. */
const BANK_STEP = 9
/** One bank tree per BANK_CELL m cell from the anchor (its id): tile seams fall on cell edges. */
const BANK_CELL = 4
/** Lattice cells numbered each way from the anchor: 8192, 57.9 km. */
const SPAN = 8192
/** Bank cells numbered each way from the anchor: 16384, 65.5 km. */
const BANK_SPAN = 16384
/**
 * The first bank tree's id, past every lattice cell's number (2^28; the last is 2^28 + 2^30 - 1). A
 * look's seeds, 3 * id and one more for a mirror (render/trees.ts), pass int32 for bank trees and
 * reach 4,026,531,838: hash01 takes them through ToInt32, which keeps any two below 2^32 apart.
 */
const BANKS = 4 * SPAN * SPAN

/** What the trees grow in (forest areas) and keep out of (the other areas, and every feature). */
export interface TreeFeatures {
  readonly areas: ReadonlyArray<Area>
  readonly roads: ReadonlyArray<RoadF>
  readonly buildings: ReadonlyArray<BuildingF>
  readonly water: ReadonlyArray<WaterF>
  readonly rail: ReadonlyArray<RailF>
}

/** The id of lattice cell (gi, gj) from the anchor: its number, south to north, then west to east. */
const latticeId = (gi: number, gj: number): number => {
  if (gi < -SPAN || gi >= SPAN || gj < -SPAN || gj >= SPAN)
    throw new Error(`tree lattice cell (${gi}, ${gj}) is past the ${SPAN} cells the ids number`)
  return (gj + SPAN) * 2 * SPAN + gi + SPAN
}

/** The id of bank cell (ci, cj) from the anchor: its number, past every lattice cell's. */
const bankId = (ci: number, cj: number): number => {
  if (ci < -BANK_SPAN || ci >= BANK_SPAN || cj < -BANK_SPAN || cj >= BANK_SPAN)
    throw new Error(`bank cell (${ci}, ${cj}) is past the ${BANK_SPAN} cells the ids number`)
  return BANKS + (cj + BANK_SPAN) * 2 * BANK_SPAN + ci + BANK_SPAN
}

/**
 * The bank trees' candidates of every stream at least 4 m wide, keyed by its OSM way, the step
 * along the whole way (pieces the outline cut count from the way's start, `WaterF.from`) and the
 * side, in that key order: where each stands, rounded and not, and its scale.
 */
const bankCandidates = (water: ReadonlyArray<WaterF>) => {
  const x: Array<number> = [],
    y: Array<number> = [],
    scale: Array<number> = []
  const wide = water.filter((w) => w.w >= 4).sort((a, b) => a.id - b.id || a.from - b.from)
  for (const w of wide) {
    const s = arcLengths(w.pts),
      end = w.from + s.at(-1)!
    for (let k = Math.ceil(w.from / BANK_STEP); k * BANK_STEP < end; k++)
      for (const side of [1, -1]) {
        if (hash01(w.id, k, side, 4) > 0.55) continue
        const p = pointAt(w.pts, s, k * BANK_STEP - w.from),
          off = side * (w.bed + 2 + 3 * hash01(w.id, k, side, 5))
        x.push(p.x - p.ty * off)
        y.push(p.y + p.tx * off)
        scale.push(0.8 + 0.5 * hash01(w.id, k, side, 6))
      }
  }
  return { x, y, scale }
}

/**
 * The scatter of `features` on `ground`'s lattice. `(window)` gives the trees whose rounded point
 * lies in the window [x0, y0, x1, y1) (whole metres) in id order, flat (x, y, scale) triples on
 * whole metres: in forest, clear of the other areas, buildings (2 m), roads (w/2 + 2 m), stream
 * beds and the rail (6 m), 1 m inside the built terrain. Any cut of the ground into windows gives
 * the same trees with the same ids.
 */
export const treeScatter = (
  features: TreeFeatures,
  ground: Pick<Region, "anchor" | "bounds">,
): ((window: Rect) => TreeList) => {
  const { x: ax, y: ay } = ground.anchor,
    { minX, minY, maxX, maxY } = ground.bounds
  if (ax % BANK_CELL !== 0 || ay % BANK_CELL !== 0)
    throw new Error(`the tree anchor (${ax}, ${ay}) is off the ${BANK_CELL} m bank cells`)
  const { areas, roads, buildings, water, rail } = features
  const keepOut = segIndex<null>()
  for (const r of roads) keepOut.addLine(r.pts, r.w / 2 + 2, null)
  for (const b of buildings) keepOut.addLine([...b.outer, b.outer[0]!, b.outer[1]!], 2, null)
  for (const w of water) keepOut.addLine(w.pts, w.bed, null)
  for (const r of rail) if (r.tunnel !== true) keepOut.addLine(r.pts, 6, null)
  const FOREST = 0,
    OPEN = 1,
    BUILT = 2
  // Each mask's polygons, with their boxes.
  const kinds = [
    areas.filter((a) => a.kind === "forest").map((a) => a.rings),
    areas.filter((a) => a.kind !== "forest").map((a) => a.rings),
    buildings.map((b) => [b.outer, ...(b.holes ?? [])]),
  ].map((polys) =>
    polys.map((rings) => {
      const box = [Infinity, Infinity, -Infinity, -Infinity]
      for (const ring of rings) {
        const [x0, y0, x1, y1] = ringBox(ring)
        box[0] = Math.min(box[0]!, x0)
        box[1] = Math.min(box[1]!, y0)
        box[2] = Math.max(box[2]!, x1)
        box[3] = Math.max(box[3]!, y1)
      }
      return { rings, box }
    }),
  )
  const bank = bankCandidates(water)
  const bankAt = bank.x.map((x, b) => [Math.round(x), Math.round(bank.y[b]!)] as const)
  return ([x0, y0, x1, y1]) => {
    // The masks over the window and a metre round it (a point rounds into it from up to 0.5 m
    // out), on the anchor's 2 m pixels: the pixels one raster of the whole ground has there.
    const c0 = Math.floor((x0 - 1 - ax) / MASK_RES),
      r0 = Math.floor((y0 - 1 - ay) / MASK_RES)
    const block = {
      c0,
      r0,
      cols: Math.ceil((x1 + 1 - ax) / MASK_RES) - c0,
      rows: Math.ceil((y1 + 1 - ay) / MASK_RES) - r0,
    }
    const ex0 = ax + c0 * MASK_RES,
      ey0 = ay + r0 * MASK_RES,
      ex1 = ex0 + block.cols * MASK_RES,
      ey1 = ey0 + block.rows * MASK_RES
    // Even-odd within each polygon (fillPolygon visits a pixel once per polygon), OR across them.
    const masks = kinds.map((polys) => {
      const m = new Uint8Array(block.cols * block.rows)
      for (const { rings, box } of polys)
        if (box[0]! <= ex1 && box[2]! >= ex0 && box[1]! <= ey1 && box[3]! >= ey0)
          fillPolygon(rings, ax, ay, MASK_RES, block.cols, block.rows, (k) => (m[k] = 1), block)
      return m
    })
    const at = (kind: number, x: number, y: number) => {
      const c = Math.floor((x - ax) / MASK_RES) - c0,
        r = Math.floor((y - ay) / MASK_RES) - r0
      return (
        c >= 0 &&
        r >= 0 &&
        c < block.cols &&
        r < block.rows &&
        masks[kind]![r * block.cols + c] === 1
      )
    }
    const free = (x: number, y: number) =>
      x >= minX + 1 &&
      x <= maxX - 1 &&
      y >= minY + 1 &&
      y <= maxY - 1 &&
      !at(OPEN, x, y) &&
      !at(BUILT, x, y) &&
      !keepOut.covers(x, y)
    const mine = (tx: number, ty: number) => tx >= x0 && tx < x1 && ty >= y0 && ty < y1
    // Rounded to the metre, two jittered points can land on one spot: keep the first (a bit per
    // metre of the window).
    const across = x1 - x0,
      taken = new Uint8Array(Math.ceil((across * (y1 - y0)) / 8))
    const take = (tx: number, ty: number) => {
      const bit = (ty - y0) * across + tx - x0
      if ((taken[bit >> 3]! >> (bit & 7)) & 1) return false
      taken[bit >> 3]! |= 1 << (bit & 7)
      return true
    }
    const trees: Array<number> = [],
      ids: Array<number> = []
    // Rows south to north, each west to east: id order, and the first of two on a spot kept.
    for (let gj = Math.floor((y0 - 1 - ay) / STEP) - 1; ay + gj * STEP < y1; gj++)
      for (let gi = Math.floor((x0 - 1 - ax) / STEP) - 1; ax + gi * STEP < x1; gi++) {
        const x = ax + (gi + hash01(gi, gj, 1)) * STEP,
          y = ay + (gj + hash01(gi, gj, 2)) * STEP
        const tx = Math.round(x),
          ty = Math.round(y)
        if (mine(tx, ty) && at(FOREST, x, y) && free(x, y) && take(tx, ty)) {
          trees.push(tx, ty, r1(0.8 + 0.5 * hash01(gi, gj, 3)))
          ids.push(latticeId(gi, gj))
        }
      }
    // Then the banks, in key order, each where no tree stands and no earlier bank tree took its cell.
    const banks: Array<readonly [number, number, number, number]> = [],
      cells = new Set<number>()
    bankAt.forEach(([tx, ty], b) => {
      const x = bank.x[b]!,
        y = bank.y[b]!
      if (!mine(tx, ty) || at(FOREST, x, y) || !free(x, y)) return
      const id = bankId(Math.floor((tx - ax) / BANK_CELL), Math.floor((ty - ay) / BANK_CELL))
      if (cells.has(id) || !take(tx, ty)) return
      cells.add(id)
      banks.push([id, tx, ty, r1(bank.scale[b]!)])
    })
    for (const [id, tx, ty, scale] of banks.sort((a, b) => a[0] - b[0])) {
      trees.push(tx, ty, scale)
      ids.push(id)
    }
    return { trees: Float64Array.from(trees), ids: Int32Array.from(ids) }
  }
}

/**
 * The trees of every tile of `region` (each scattered on its own, `treeScatter`), merged in id
 * order: flat (x, y, scale) triples on whole metres and their ids.
 */
export const scatterTrees = (
  features: TreeFeatures,
  region: Pick<Region, "anchor" | "bounds" | "tiles">,
): TreeList => {
  const scatter = treeScatter(features, region)
  return mergeTrees(
    region.tiles.map(({ i, j }) => scatter([TILE * i, TILE * j, TILE * (i + 1), TILE * (j + 1)])),
  )
}

/**
 * The trees' 16 m broad-phase corner (`walls.lattice.trees`): fixed per region, so a query's
 * trunks keep their order as parts are added; 1 m north-east of the anchor, where each map's lowest
 * tree stood when the corner was taken from the trees.
 */
export const treeCorner = ({ anchor }: Pick<Region, "anchor">): readonly [number, number] => [
  anchor.x + 1,
  anchor.y + 1,
]
