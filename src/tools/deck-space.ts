// The space round the road bridges' decks that the walls under them (deck-walls.ts) are traced
// from: the decks' and roads' lines as shipped, the decks whose walls would touch, and, on a
// lattice RES m apart, the fields under 0 where the ground at the terrain's level (`atGrade`)
// stands within a headroom of a deck's top (the low space) or within ON_DECK of it (on its level).
import {
  DECK_SLAB,
  footReach,
  isRoadClass,
  ON_DECK,
  ONE_LEVEL,
  ROAD_LIFT,
} from "../sim/map/kinds.ts"
import type { RoadF } from "./features.ts"
import { segIndex } from "./geometry.ts"

/** The lattice the low space is read on, m. */
export const RES = 0.25

/** A corridor reaches this far past where the bodies on its road go, m: its walls stand off them. */
export const CORRIDOR = 0.25

/** How far off a deck's centreline someone on foot is on it, m: its slab, or its walkers' reach. */
export const walkSide = (deck: { readonly cls: string; readonly w: number }): number =>
  Math.max(deck.w / 2 + DECK_SLAB.margin, footReach(deck.cls, deck.w))

/** A road's line as shipped: its flat polyline and its profile per vertex. */
export interface Line {
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
}

/** One segment of a line: its first vertex, its unit direction and length, and a level at either end, m. */
export interface Segment {
  readonly ax: number
  readonly ay: number
  readonly ux: number
  readonly uy: number
  readonly len: number
  readonly za: number
  readonly zb: number
}

/** `line`'s segments of some length, each end's level its profile plus `lift`. */
export const segmentsOf = (line: Line, lift: number): Array<Segment> => {
  const segs: Array<Segment> = []
  for (let k = 0; k + 1 < line.z.length; k++) {
    const ax = line.pts[2 * k]!,
      ay = line.pts[2 * k + 1]!,
      len = Math.hypot(line.pts[2 * k + 2]! - ax, line.pts[2 * k + 3]! - ay)
    if (len > 0)
      segs.push({
        ax,
        ay,
        ux: (line.pts[2 * k + 2]! - ax) / len,
        uy: (line.pts[2 * k + 3]! - ay) / len,
        len,
        za: line.z[k]! + lift,
        zb: line.z[k + 1]! + lift,
      })
  }
  return segs
}

/** How far (x, y) lies off `seg`, m, and the level at the point of it nearest, m a.s.l. */
export const offSegment = (seg: Segment, x: number, y: number) => {
  const along = Math.max(0, Math.min(seg.len, (x - seg.ax) * seg.ux + (y - seg.ay) * seg.uy))
  return {
    d: Math.hypot(x - seg.ax - seg.ux * along, y - seg.ay - seg.uy * along),
    z: seg.za + ((seg.zb - seg.za) * along) / seg.len,
  }
}

/** Points every RES m or less along `seg`, both ends included. */
export const along = (seg: Segment): Array<readonly [number, number]> => {
  const n = Math.max(1, Math.ceil(seg.len / RES))
  return Array.from({ length: n + 1 }, (_, q) => {
    const a = (seg.len * q) / n
    return [seg.ax + seg.ux * a, seg.ay + seg.uy * a] as const
  })
}

/** A road's ROAD_LIFT, m. */
export const liftOf = (road: RoadF): number => ROAD_LIFT[isRoadClass(road.cls) ? road.cls : "path"]

/** Whether a road is lifted off the ground: a bridge's deck or a tunnel's floor. */
export const isLifted = (road: RoadF): boolean => road.bridge === true || road.tunnel === true

/** A road bridge: its road, and its segments, each end's level the deck's top. */
export interface Deck {
  readonly road: number
  readonly segs: ReadonlyArray<Segment>
}

/** The road bridges of `roads`, with `lines` their shipped lines. */
export const decksOf = (roads: ReadonlyArray<RoadF>, lines: ReadonlyArray<Line>): Array<Deck> =>
  roads.flatMap((r, road) =>
    r.bridge === true ? [{ road, segs: segmentsOf(lines[road]!, liftOf(r)) }] : [],
  )

/** The decks in groups whose walls (`side` m off their lines) come within 2 RES of each other, each in deck order. */
export const clustersOf = (
  decks: ReadonlyArray<Deck>,
  side: ReadonlyArray<number>,
): Array<Array<number>> => {
  const parent = decks.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const widest = Math.max(0, ...side),
    index = segIndex<number>()
  decks.forEach((d, i) => {
    for (const s of d.segs)
      index.add(
        s.ax,
        s.ay,
        s.ax + s.ux * s.len,
        s.ay + s.uy * s.len,
        side[i]! + widest + 2 * RES,
        i,
      )
  })
  decks.forEach((d, i) => {
    for (const s of d.segs)
      for (const [x, y] of along(s))
        index.within(x, y, ({ data: j }, d2) => {
          if (Math.sqrt(d2) <= side[i]! + side[j]! + 2 * RES) parent[find(i)] = find(j)
        })
  })
  const groups = new Map<number, Array<number>>()
  decks.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]))
  return [...groups.values()].sort((a, b) => a[0]! - b[0]!)
}

/**
 * A field on the lattice's nodes round a cluster's decks: each row from `j0` holds the columns
 * `lo[r]` on, its values at `start[r]` … `start[r + 1]` of `values`, NaN where the field holds none.
 * Typed arrays sized once a cluster: a Map a node (and its growth) made most of the garbage that
 * took Lunigiana's build to its peak at the walls stage's start.
 */
export interface Field {
  readonly j0: number
  readonly lo: Int32Array
  readonly start: Int32Array
  readonly values: Float64Array
}

/** `field`'s value at node (i, j), undefined where it holds none. */
export const valueAt = (field: Field, i: number, j: number): number | undefined => {
  const r = j - field.j0
  if (r < 0 || r >= field.lo.length) return undefined
  const c = i - field.lo[r]!,
    o = field.start[r]! + c
  if (c < 0 || o >= field.start[r + 1]!) return undefined
  const v = field.values[o]!
  return Number.isNaN(v) ? undefined : v
}

/** A field's value at the lattice node nearest (x, y): outside (1) where it holds none. */
export const fieldAt = (field: Field, x: number, y: number): number =>
  valueAt(field, Math.round(x / RES), Math.round(y / RES)) ?? 1

/** The column and row of each node of `field` under 0. */
export const nodesUnder = (field: Field): Array<readonly [number, number]> => {
  const out: Array<readonly [number, number]> = []
  for (let r = 0; r < field.lo.length; r++)
    for (let o = field.start[r]!; o < field.start[r + 1]!; o++)
      if (field.values[o]! < 0) out.push([field.lo[r]! + o - field.start[r]!, field.j0 + r])
  return out
}

/**
 * A road's corridor through the low space under a deck it passes under, m off its centreline: as far
 * as its bodies go and a wall's standoff past that (`reach`), where the ground stands ONE_LEVEL or
 * more under the deck's top; elsewhere its carriageway and that standoff (`hold`). Held only where
 * the ground stood that low, the walls under the A15's decks' ends at Aulla stood up to 0.9 m inside
 * the carriageways of the tracks and the SP20 passing under them, where the ground climbed to an
 * abutment's or an approach's embankment across a 4 m cell.
 */
export interface Corridor {
  readonly reach: number
  readonly hold: number
}

/**
 * Into `out`, the columns of the lattice's row `j` that lie within `reach` of `s`, a node to spare
 * either side, cut to its box's columns `i0` … `i1`; `out[0]` past `out[1]` where none does. A row
 * of a long diagonal deck's box reaches far past the deck: sized to the boxes, the fields of
 * Lunigiana's decks held 50.5 million nodes, 12.2 million of them within reach.
 */
const bandOf = (
  s: Segment,
  reach: number,
  j: number,
  i0: number,
  i1: number,
  out: Array<number>,
): void => {
  // The stretch of the segment within reach of the row (a centimetre to spare), and its x there.
  const y = j * RES,
    slack = reach + 0.01
  let a0 = 0,
    a1 = s.len
  if (s.uy !== 0) {
    const p = (y - slack - s.ay) / s.uy,
      q = (y + slack - s.ay) / s.uy
    a0 = Math.max(0, Math.min(p, q))
    a1 = Math.min(s.len, Math.max(p, q))
  } else if (Math.abs(y - s.ay) > slack) a1 = -1
  if (a0 > a1) {
    out[0] = i0
    out[1] = i0 - 1
    return
  }
  const xa = s.ax + s.ux * a0,
    xb = s.ax + s.ux * a1
  out[0] = Math.max(i0, Math.floor((Math.min(xa, xb) - reach) / RES) - 1)
  out[1] = Math.min(i1, Math.ceil((Math.max(xa, xb) + reach) / RES) + 1)
}

/**
 * Two fields at the lattice's nodes round the decks of `cluster`, each under 0 in its region: the
 * least over their segments of the most of how far past its walls (`side` m off its line, round
 * its ends too), how far under `room` m under its top (`low`, the low space) or under ON_DECK
 * (`onLevel`, the ground on its level) the `ground` stands, and how deep in one of its `corridors`:
 * its `reach` where that ground stands ONE_LEVEL or more under the top, its `hold` elsewhere (a bank
 * climbing nearer past a corridor's carriageway stays in the low space). A node farther from every
 * deck is outside: it holds none.
 */
export const fieldsOf = (
  cluster: ReadonlyArray<number>,
  decks: ReadonlyArray<Deck>,
  side: ReadonlyArray<number>,
  room: number,
  corridors: ReadonlyArray<ReturnType<typeof segIndex<Corridor>>>,
  ground: (x: number, y: number) => number,
): { readonly low: Field; readonly onLevel: Field } => {
  // Each segment's box of nodes, as far as its walls and 2 RES reach, and each row's columns over
  // the bands of the segments that cross it.
  const boxes: Array<readonly [number, Segment, number, number, number, number]> = []
  let j0 = Infinity,
    j1 = -Infinity
  for (const di of cluster) {
    const reach = side[di]! + 2 * RES
    for (const s of decks[di]!.segs) {
      const bx = s.ax + s.ux * s.len,
        by = s.ay + s.uy * s.len
      const box = [
        di,
        s,
        Math.floor((Math.min(s.ax, bx) - reach) / RES),
        Math.ceil((Math.max(s.ax, bx) + reach) / RES),
        Math.floor((Math.min(s.ay, by) - reach) / RES),
        Math.ceil((Math.max(s.ay, by) + reach) / RES),
      ] as const
      boxes.push(box)
      j0 = Math.min(j0, box[4])
      j1 = Math.max(j1, box[5])
    }
  }
  const rows = boxes.length === 0 ? 0 : j1 - j0 + 1,
    lo = new Int32Array(rows).fill(0x7fffffff),
    hi = new Int32Array(rows).fill(-0x80000000)
  const band = [0, 0]
  for (const [di, s, i0, i1, b0, b1] of boxes)
    for (let j = b0; j <= b1; j++) {
      bandOf(s, side[di]! + 2 * RES, j, i0, i1, band)
      if (band[0]! > band[1]!) continue
      lo[j - j0] = Math.min(lo[j - j0]!, band[0]!)
      hi[j - j0] = Math.max(hi[j - j0]!, band[1]!)
    }
  const start = new Int32Array(rows + 1)
  for (let r = 0; r < rows; r++) start[r + 1] = start[r]! + Math.max(0, hi[r]! - lo[r]! + 1)
  const nodes = start[rows]!
  const low = new Float64Array(nodes).fill(Number.NaN),
    onLevel = new Float64Array(nodes).fill(Number.NaN),
    grounds = new Float64Array(nodes).fill(Number.NaN)
  for (const [di, s, i0, i1, b0, b1] of boxes) {
    const reach = side[di]! + 2 * RES
    for (let j = b0; j <= b1; j++) {
      bandOf(s, reach, j, i0, i1, band)
      for (let i = band[0]!; i <= band[1]!; i++) {
        const x = i * RES,
          y = j * RES,
          off = offSegment(s, x, y)
        if (off.d > reach) continue
        const k = start[j - j0]! + i - lo[j - j0]!
        if (Number.isNaN(grounds[k]!)) grounds[k] = ground(x, y)
        const z = grounds[k]!
        let rest = off.d - side[di]!
        const under = off.z - z >= ONE_LEVEL
        corridors[di]!.within(x, y, ({ data }, d2) => {
          const d = Math.sqrt(d2)
          rest = Math.max(rest, (under ? data.reach : data.hold) - d)
        })
        const f = Math.max(rest, off.z - z - room),
          g = Math.max(rest, off.z - z - ON_DECK)
        if (Number.isNaN(low[k]!) || f < low[k]!) low[k] = f
        if (Number.isNaN(onLevel[k]!) || g < onLevel[k]!) onLevel[k] = g
      }
    }
  }
  return {
    low: { j0, lo, start, values: low },
    onLevel: { j0, lo, start, values: onLevel },
  }
}
