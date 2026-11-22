/**
 * Still water's banks, which a body in a lake or the sea heads for the nearest of: the edges of its
 * rings less those where the map build cut it along a tile's side or the map's bounds (`isCut`),
 * the sea's coast less its closures across a river's or a lake's mouth (`coastOf`), and the way
 * from a point to the nearest bank (`shoreward`). The water at a point (src/sim/water/rivers.ts)
 * gives each lake and sea piece its banks (`Pool.banks`) from these.
 *
 * @module water/banks
 */
import { inRings, segDist2 } from "../collide.ts"
import type { Layer } from "../map/format/tile-file.ts"
import { type Area, MAP, TILE } from "../map/index.ts"

/** A ring's ends within this of a line lie on it, m: half the rings' 0.1 m rounding. */
const ON_LINE = 0.05
const BOUNDS = MAP.bounds
/** Whether `v` (m, along x or y) lies on a tile's side, a multiple of TILE, or on bound `low` or `high`. */
const onCutLine = (v: number, low: number, high: number): boolean =>
  Math.abs(v - Math.round(v / TILE) * TILE) < ON_LINE ||
  Math.abs(v - low) < ON_LINE ||
  Math.abs(v - high) < ON_LINE

/**
 * Whether the edge from (ax, ay) by (ex, ey) is where the map build cut the water rather than its
 * shore: along a tile's side or the map's bounds, as it cuts the sea into a piece per tile
 * (src/tools/coast.ts).
 */
const isCut = (ax: number, ay: number, ex: number, ey: number): boolean =>
  (Math.abs(ex) < ON_LINE && onCutLine(ax, BOUNDS.minX, BOUNDS.maxX)) ||
  (Math.abs(ey) < ON_LINE && onCutLine(ay, BOUNDS.minY, BOUNDS.maxY))

/** The edges of `rings`, ring by ring, flat (ax, ay, ex, ey) each: all of them, and the shore's, those that are no cut (`isCut`). */
export const edgesOf = (rings: ReadonlyArray<ReadonlyArray<number>>) => {
  const all: Array<number> = [],
    shore: Array<number> = []
  for (const ring of rings)
    for (let k = 0, n = ring.length; k < n; k += 2) {
      const ax = ring[k]!,
        ay = ring[k + 1]!,
        ex = ring[(k + 2) % n]! - ax,
        ey = ring[(k + 3) % n]! - ay
      all.push(ax, ay, ex, ey)
      if (!isCut(ax, ay, ex, ey)) shore.push(ax, ay, ex, ey)
    }
  return { all, shore }
}

/** How far off a sea edge's middle, on its land side, a river or a lake across a mouth is looked for, m: as the map build's `shoreLines`. */
const ACROSS = 0.5

/**
 * The shore edges of the sea `shore` (flat, ax, ay, ex, ey each), less those that close a river or
 * a lake of `a` across its mouth: their land side (their right, the sea keeping to their left)
 * lies in its area ACROSS m off their middle, as OSM's coastline closes the Magra across Bocca di
 * Magra. That is open water going on into the river, no coast to swim for.
 */
export const coastOf = (shore: ReadonlyArray<number>, a: Layer<Area>): Array<number> => {
  const inland = a.items.filter((area) => area.kind === "river" || area.kind === "lake")
  const out: Array<number> = []
  for (let k = 0; k < shore.length; k += 4) {
    const ax = shore[k]!,
      ay = shore[k + 1]!,
      ex = shore[k + 2]!,
      ey = shore[k + 3]!,
      length = Math.sqrt(ex * ex + ey * ey)
    const x = ax + ex / 2 + (ey / length) * ACROSS,
      y = ay + ey / 2 - (ex / length) * ACROSS
    if (!inland.some((area) => inRings(area.rings, x, y))) out.push(ax, ay, ex, ey)
  }
  return out
}

/** The unit vector from (x, y) toward the nearest of still water's banks (`Pool.banks`: a lake's shore, an island's too, or the sea's coast). */
export const shoreward = (
  banks: ReadonlyArray<number>,
  x: number,
  y: number,
): readonly [number, number] => {
  let bx = 1,
    by = 0,
    best = Number.MAX_VALUE
  for (let k = 0; k < banks.length; k += 4) {
    const ax = banks[k]!,
      ay = banks[k + 1]!,
      ex = banks[k + 2]!,
      ey = banks[k + 3]!
    const { d2, t } = segDist2(x, y, ax, ay, ax + ex, ay + ey)
    if (d2 >= best || d2 <= 0) continue
    const d = Math.sqrt(d2)
    ;[best, bx, by] = [d2, (ax + ex * t - x) / d, (ay + ey * t - y) / d]
  }
  return [bx, by]
}
