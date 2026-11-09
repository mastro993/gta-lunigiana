// The space round the road bridges' decks that the walls under them (deck-walls.ts) are traced
// from: the decks' and roads' lines as shipped, the ground at the terrain's level as the game reads
// it, the decks whose walls would touch, and, on a lattice RES m apart, the fields under 0 where
// the ground stands within a headroom of a deck's top (the low space) or within ON_DECK of it (on
// its level).
import { isRoadClass, ON_DECK, ONE_LEVEL, ROAD_LIFT, ROAD_PAD } from "../sim/map/kinds.ts"
import { meshZ } from "./deck-ground.ts"
import type { RoadF } from "./features.ts"
import { segIndex } from "./geometry.ts"
import type { Grid } from "./terrain.ts"

/** The lattice the low space is read on, m. */
export const RES = 0.25

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

/**
 * The ground at the terrain's level on the whole grid `g` (`atGrade` in src/sim/map/ground-model.ts): the
 * terrain as drawn, or where the carriageways of `roads` at grade (their shipped `lines`) reach,
 * ROAD_PAD past their edge, their surfaces over it, each weighed by the square of how deep inside
 * it the point is, where that stands higher. A road's surface floats ROAD_LIFT over its profile,
 * and over the terrain where that stands higher: an approach's carriageway reaching under a deck's
 * end stands at the deck's level however low the terrain under it is.
 */
export const groundOf = (g: Grid, roads: ReadonlyArray<RoadF>, lines: ReadonlyArray<Line>) => {
  const at = segIndex<{ readonly za: number; readonly zb: number; readonly lift: number }>()
  roads.forEach((r, i) => {
    if (isLifted(r)) return
    for (const seg of segmentsOf(lines[i]!, 0))
      at.add(
        seg.ax,
        seg.ay,
        seg.ax + seg.ux * seg.len,
        seg.ay + seg.uy * seg.len,
        r.w / 2 + ROAD_PAD,
        { za: seg.za, zb: seg.zb, lift: liftOf(r) },
      )
  })
  return (x: number, y: number): number => {
    const terrain = meshZ(g, x, y)
    let sum = 0,
      weights = 0
    at.within(x, y, ({ r, data: { za, zb, lift } }, d2, t) => {
      const depth = r - Math.sqrt(d2),
        weight = depth * depth + 1e-9
      sum += weight * (Math.max(za + (zb - za) * t, terrain) + lift)
      weights += weight
    })
    return weights > 0 ? Math.max(terrain, sum / weights) : terrain
  }
}

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

/** How far either way of 0 a lattice node's column and row reach, past any map at RES m, and a row's span of keys. */
const OFF = 1 << 21,
  ROW = 1 << 22
/** A lattice node's key, from its column and row. */
export const key = (i: number, j: number): number => (j + OFF) * ROW + i + OFF

/** A field's value at the lattice node nearest (x, y): outside (1) where it holds none. */
export const fieldAt = (field: ReadonlyMap<number, number>, x: number, y: number): number =>
  field.get(key(Math.round(x / RES), Math.round(y / RES))) ?? 1

/** The column and row of each node of `field` under 0. */
export const nodesUnder = (field: ReadonlyMap<number, number>): Array<readonly [number, number]> =>
  [...field].flatMap(([k, f]) =>
    f < 0 ? [[(k % ROW) - OFF, Math.floor(k / ROW) - OFF] as const] : [],
  )

/**
 * Two fields at the lattice's nodes round the decks of `cluster`, each under 0 in its region: the
 * least over their segments of the most of how far past its walls (`side` m off its line, round
 * its ends too), how far under `room` m under its top (`low`, the low space) or under ON_DECK
 * (`onLevel`, the ground on its level) the `ground` stands, and how deep in one of its `corridors`
 * where that ground stands ONE_LEVEL or more under the top (a bank a corridor's carriageway climbs
 * nearer stays in the low space). A node farther from every deck is outside: it holds none.
 */
export const fieldsOf = (
  cluster: ReadonlyArray<number>,
  decks: ReadonlyArray<Deck>,
  side: ReadonlyArray<number>,
  room: number,
  corridors: ReadonlyArray<ReturnType<typeof segIndex<number>>>,
  ground: (x: number, y: number) => number,
): { readonly low: Map<number, number>; readonly onLevel: Map<number, number> } => {
  const low = new Map<number, number>(),
    onLevel = new Map<number, number>(),
    grounds = new Map<number, number>()
  for (const di of cluster) {
    const reach = side[di]! + 2 * RES
    for (const s of decks[di]!.segs) {
      const bx = s.ax + s.ux * s.len,
        by = s.ay + s.uy * s.len
      const i0 = Math.floor((Math.min(s.ax, bx) - reach) / RES),
        i1 = Math.ceil((Math.max(s.ax, bx) + reach) / RES),
        j0 = Math.floor((Math.min(s.ay, by) - reach) / RES),
        j1 = Math.ceil((Math.max(s.ay, by) + reach) / RES)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = i * RES,
            y = j * RES,
            off = offSegment(s, x, y)
          if (off.d > reach) continue
          const k = key(i, j)
          let z = grounds.get(k)
          if (z === undefined) grounds.set(k, (z = ground(x, y)))
          let rest = off.d - side[di]!
          if (off.z - z >= ONE_LEVEL)
            corridors[di]!.within(x, y, (c, d2) => {
              rest = Math.max(rest, c.r - Math.sqrt(d2))
            })
          for (const [field, f] of [
            [low, Math.max(rest, off.z - z - room)],
            [onLevel, Math.max(rest, off.z - z - ON_DECK)],
          ] as const) {
            const was = field.get(k)
            if (was === undefined || f < was) field.set(k, f)
          }
        }
    }
  }
  return { low, onLevel }
}
