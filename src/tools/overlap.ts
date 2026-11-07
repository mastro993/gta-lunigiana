// Buildings two sources both map. A later source's building is dropped where it maps the ground no
// earlier one does only by its centroid (`bySourcePriority` in surveys.ts, the OSM buildings in
// features.ts), so an earlier source's building outside its own mapped area, as along the 2019
// CTR's edge or across the Tuscany-Liguria border, stood twice, each copy at its own height. The
// overlap is counted on a raster, as a centroid test misses a larger later building over smaller
// kept ones and drops an L-shaped ring wrapped round a corner of one it shares no ground with.
import { fillPolygon, type PixelBlock, staticGrid } from "../sim/collide.ts"
import { ringBox } from "./geometry.ts"

/** A building's footprint, flat, in local metres: its outer ring and its holes. */
export interface Footprint {
  readonly outer: ReadonlyArray<number>
  readonly holes?: ReadonlyArray<ReadonlyArray<number>>
}

/** The raster's step, m, its pixels counted from (0, 0) wherever the two stand. */
const STEP = 0.25
/** The share of the smaller footprint's area two footprints cover both, at or above which they are one building. */
export const SAME = 0.5

/** The pixels of the raster whose centres the box [x0, y0, x1, y1] may hold. */
const blockOf = ([x0, y0, x1, y1]: readonly [number, number, number, number]): PixelBlock => {
  const c0 = Math.floor(x0 / STEP),
    r0 = Math.floor(y0 / STEP)
  return { c0, r0, cols: Math.floor(x1 / STEP) - c0 + 1, rows: Math.floor(y1 / STEP) - r0 + 1 }
}
const ringsOf = (f: Footprint) => [f.outer, ...(f.holes ?? [])]

/** Each footprint's area in pixels, counted once. */
const pixels = (() => {
  const of = new WeakMap<Footprint, number>()
  return (f: Footprint): number => {
    let n = of.get(f)
    if (n !== undefined) return n
    n = 0
    fillPolygon(ringsOf(f), 0, 0, STEP, blockOf(ringBox(f.outer)), () => n!++)
    of.set(f, n)
    return n
  }
})()

/** The share of the smaller of `a` and `b`'s areas both cover (holes excluded), on the STEP m raster. */
export const overlapShare = (a: Footprint, b: Footprint): number => {
  const [ax0, ay0, ax1, ay1] = ringBox(a.outer),
    [bx0, by0, bx1, by1] = ringBox(b.outer)
  const box = [
    Math.max(ax0, bx0),
    Math.max(ay0, by0),
    Math.min(ax1, bx1),
    Math.min(ay1, by1),
  ] as const
  if (box[0] > box[2] || box[1] > box[3]) return 0
  const block = blockOf(box),
    inA = new Uint8Array(block.cols * block.rows)
  fillPolygon(ringsOf(a), 0, 0, STEP, block, (k) => (inA[k] = 1))
  let both = 0
  fillPolygon(ringsOf(b), 0, 0, STEP, block, (k) => (both += inA[k]!))
  const smaller = Math.min(pixels(a), pixels(b))
  return both === 0 || smaller === 0 ? 0 : both / smaller
}

/**
 * `later` less each footprint that shares at least SAME of the smaller one's area with one of
 * `kept`: a later source's copy of a building `kept` already holds. One that overlaps none, or
 * less, stays.
 */
export const apartFrom = <T extends Footprint>(
  kept: ReadonlyArray<Footprint>,
  later: ReadonlyArray<T>,
): Array<T> => {
  const grid = staticGrid(kept.length, (k) => ringBox(kept[k]!.outer), 32)
  return later.filter((f) => {
    let same = false
    grid(...ringBox(f.outer), (k) => (same ||= overlapShare(f, kept[k]!) >= SAME))
    return !same
  })
}
