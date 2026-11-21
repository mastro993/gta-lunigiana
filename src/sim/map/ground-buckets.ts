/**
 * The ground model's roads (`./ground-model.ts`): each road's segments with what its class, width and
 * kind make of them, in 16 m buckets, and the rules of where a road at grade's surface stops short of
 * its round ends (under a deck's end, behind a joint where it widens). The model builds them from the
 * roads an adapter hands it, so every adapter blends the same segments in the same order.
 *
 * @module map/ground-buckets
 */
import { segD2 } from "../collide.ts"
import { addToBuckets, type Buckets, emptyBuckets } from "./buckets.ts"
import { footReach, ROAD_LIFT, ROAD_PAD, roadClassOf } from "./kinds.ts"

/** A road as the ground reads it: its index in the map's road list, its line (flat points, its profile per vertex) and what its class, width and kind make of it. */
export interface GroundRoad {
  readonly index: number
  readonly pts: ArrayLike<number>
  readonly z: ArrayLike<number>
  readonly cls: string
  readonly w: number
  /** Where people walk, m from the centreline (else `vergeOf`, `footReach`). */
  readonly verge?: number
  readonly bridge?: boolean
  readonly tunnel?: boolean
}

/**
 * Where a road at grade widens, going on in line from a narrower one with no third road there: the
 * joint (x, y), the wider road's way on from it (ux, uy), and how far round the joint, behind it, its
 * surface reaches, m (the narrower one's half and ROAD_PAD).
 */
interface Joint {
  readonly x: number
  readonly y: number
  readonly ux: number
  readonly uy: number
  readonly reach: number
}

/** A road's segment as the ground reads it (`groundBuckets`). */
export interface RoadSegment {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
  readonly za: number
  readonly zb: number
  readonly half: number
  readonly lift: number
  /** Bridge or tunnel: the surface is the profile, never the terrain. */
  readonly lifted: boolean
  /** A bridge's deck. */
  readonly deck: boolean
  /** A bridge's or a tunnel's reach either side of its centreline to its walkers' verge (m): within it, someone on foot is on the deck or in the tunnel; 0 for a road at grade. */
  readonly foot: number
  /**
   * Which ends of a road at grade's last segments meet a bridge's deck's end (`a` 1, `b` 2, both 3;
   * else 0): past one its surface reaches no farther along under a deck (`underCut`).
   */
  readonly cut: number
  /** The joints of a road at grade where it widens within `half` of this segment (`behind`); none for most. */
  readonly joints: ReadonlyArray<Joint>
}

/** Road segments in the ground model's buckets, made by `groundBuckets` only. */
export type RoadBuckets = Buckets<RoadSegment>

/** Bucket side, m: 125 buckets to a tile's side, so a bucket lies in one tile. */
export const BUCKET = 16

/** Two roads meeting end to end turn less than this (its cosine, 30°) at a joint in line: the joints and bridges checks' turn. */
const IN_LINE = Math.sqrt(3) / 2

/** A vertex where roads end, at its y in its x's column: the ends there, and whether a road runs on through it. */
interface Vertex {
  readonly y: number
  readonly ends: Array<{ readonly road: GroundRoad; readonly k: number }>
  through: boolean
}

/** No joints: a segment's `joints` but near a widening. */
const NONE: ReadonlyArray<Joint> = []

/**
 * Roads' segments in 16 m buckets by their carriageway's box, or a bridge's or tunnel's out to its
 * walkers' verges, by road then vertex: a bucket lists them in the order the ground blends them.
 * `roads` come in ascending `index`; it throws on any other order, which would change the blend's bits.
 */
export const groundBuckets = (roads: ReadonlyArray<GroundRoad>): RoadBuckets => {
  const out = emptyBuckets<RoadSegment>(BUCKET)
  // The road ends at each vertex, by x then y (a string key a vertex took a tile's buckets 2.3 times
  // as long to build), and whether a road runs on through it: where exactly two end and none runs
  // through, the two are joined end to end. Where a bridge's deck ends, a road at grade ending there
  // stops under the deck (`cut`).
  const vertices = new Map<number, Array<Vertex>>()
  const vertexAt = (pts: ArrayLike<number>, k: number): Vertex | undefined =>
    vertices.get(pts[2 * k]!)?.find((c) => c.y === pts[2 * k + 1]!)
  for (const road of roads)
    for (const k of [0, road.z.length - 1]) {
      const x = road.pts[2 * k]!,
        y = road.pts[2 * k + 1]!,
        column = vertices.get(x) ?? vertices.set(x, []).get(x)!,
        here = column.find((c) => c.y === y)
      if (here === undefined) column.push({ y, ends: [{ road, k }], through: false })
      else here.ends.push({ road, k })
    }
  for (const { pts, z } of roads)
    for (let k = 1; k + 1 < z.length; k++) {
      const here = vertexAt(pts, k)
      if (here !== undefined) here.through = true
    }
  /** Road `road`'s way on from its end at vertex `k` (its first or its last), unnormalised. */
  const away = ({ pts, z }: GroundRoad, k: number): readonly [number, number] => {
    const next = k === 0 ? 1 : z.length - 2
    return [pts[2 * next]! - pts[2 * k]!, pts[2 * next + 1]! - pts[2 * k + 1]!]
  }
  /**
   * The joint at road at grade `road`'s end `k` (its first vertex or its last), `half` m to its
   * carriageway's edge, where it widens: where one other road at grade, narrower, ends there,
   * going on in line (a turn under 30°), and no road runs on through it. The OSM line of a road that
   * widens (a toll plaza's lanes) changes width at a vertex, its carriageway past it, never behind
   * it beside the narrower one; at a turn its round end fills the corner's outside.
   */
  const jointAt = (road: GroundRoad, k: number, half: number): Joint | undefined => {
    const { ends, through } = vertexAt(road.pts, k)!
    if (ends.length !== 2 || through) return undefined
    const other = ends[ends[0]!.road === road && ends[0]!.k === k ? 1 : 0]!
    const reach = other.road.w / 2 + ROAD_PAD
    if (other.road.bridge === true || other.road.tunnel === true || reach >= half) return undefined
    const [ux, uy] = away(road, k),
      [vx, vy] = away(other.road, other.k)
    if (-(ux * vx + uy * vy) < IN_LINE * Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy)))
      return undefined
    return { x: road.pts[2 * k]!, y: road.pts[2 * k + 1]!, ux, uy, reach }
  }
  /** Whether a bridge's deck ends at road `road`'s vertex `k`. */
  const deckEnd = (road: GroundRoad, k: number) =>
    vertexAt(road.pts, k)!.ends.some((e) => e.road.bridge === true)
  let last = -1
  for (const road of roads) {
    if (road.index <= last) throw new Error(`ground: road ${road.index} after ${last}`)
    last = road.index
    const { pts, z } = road
    const lifted = road.bridge === true || road.tunnel === true
    const lift = ROAD_LIFT[roadClassOf(road)],
      verge = footReach(roadClassOf(road), road.w, road.verge),
      half = road.w / 2 + ROAD_PAD
    const n = z.length - 1
    const cut = lifted ? 0 : (deckEnd(road, 0) ? 1 : 0) | (deckEnd(road, n) ? 2 : 0)
    const first = lifted ? undefined : jointAt(road, 0, half),
      end = lifted ? undefined : jointAt(road, n, half)
    for (let k = 0; k < n; k++) {
      const ax = pts[2 * k]!,
        ay = pts[2 * k + 1]!,
        bx = pts[2 * k + 2]!,
        by = pts[2 * k + 3]!
      // A joint within `half` of the segment: its round ends, or its band, may reach behind it.
      const near = (j: Joint | undefined): j is Joint =>
        j !== undefined && segD2(j.x, j.y, ax, ay, bx, by) < half * half
      const joints = first === undefined && end === undefined ? NONE : [first, end].filter(near)
      const s: RoadSegment = {
        ax,
        ay,
        bx,
        by,
        za: z[k]!,
        zb: z[k + 1]!,
        half,
        lift,
        lifted,
        deck: road.bridge === true,
        foot: lifted ? verge : 0,
        cut: (k === 0 ? cut & 1 : 0) | (k + 1 === n ? cut & 2 : 0),
        joints: joints.length === 0 ? NONE : joints,
      }
      const reach = Math.max(s.half, s.foot)
      addToBuckets(
        out,
        s,
        Math.min(s.ax, s.bx) - reach,
        Math.min(s.ay, s.by) - reach,
        Math.max(s.ax, s.bx) + reach,
        Math.max(s.ay, s.by) + reach,
      )
    }
  }
  return out
}

/**
 * Whether (x, y) lies behind a joint where road at grade `s` widens (`Joint`), farther from it than
 * the narrower road reaches: there its surface stops. Its round end reached 12.3 m back round the
 * joint of the A15's toll plaza 520616095 (lanes=6, 24 m) with the two-lane 287552094 (10 m), over the
 * ramp of the service road 100468086 climbing beside it to its bridge over the plaza at (−18205,
 * −1690): the ground blended the ramp with the plaza 2.4 m under it, and a car on the ramp drove
 * under its own bridge. Behind the joint line, not round its first segment's end alone: a segment
 * shorter than the two halves' difference left the next one's round end reaching behind it.
 */
export const behind = (s: RoadSegment, x: number, y: number): boolean => {
  for (const j of s.joints) {
    const dx = x - j.x,
      dy = y - j.y
    if (dx * j.ux + dy * j.uy < 0 && dx * dx + dy * dy > j.reach * j.reach) return true
  }
  return false
}

/** Whether (x, y) lies abeam segment `s`, at most `reach` m off it: between its ends, never round them. */
const abeam = (s: RoadSegment, x: number, y: number, reach: number): boolean => {
  const ex = s.bx - s.ax,
    ey = s.by - s.ay,
    l2 = ex * ex + ey * ey,
    u = (x - s.ax) * ex + (y - s.ay) * ey,
    cross = (x - s.ax) * ey - (y - s.ay) * ex
  return u >= 0 && u <= l2 && cross * cross <= reach * reach * l2
}

/**
 * Whether (x, y) lies past an end of road at grade `s` that meets a bridge's deck's end (`cut`),
 * under a deck's carriageway among `segments` (abeam one of its segments): there its surface
 * stops, and the deck holds. Its round end reached half its width under the deck and lifted the
 * ground at the terrain's level there to the deck's: the A15's at Aulla up to 8 m over the tracks
 * passing under its decks' ends, which ran into it. Beside the deck it stays, the outside of a
 * joint's bend (the track 173044034 turns 78° onto its bridge 697036175).
 */
export const underCut = (
  s: RoadSegment,
  x: number,
  y: number,
  segments: ReadonlyArray<RoadSegment>,
): boolean => {
  if (s.cut === 0) return false
  const ex = s.bx - s.ax,
    ey = s.by - s.ay,
    u = (x - s.ax) * ex + (y - s.ay) * ey
  if (!(((s.cut & 1) !== 0 && u < 0) || ((s.cut & 2) !== 0 && u > ex * ex + ey * ey))) return false
  return segments.some((d) => d.deck && abeam(d, x, y, d.half))
}
