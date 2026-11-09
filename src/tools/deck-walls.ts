// The walls round the low space under the road bridges' decks (issue #87): where a deck's
// underside, DECK_SLAB.depth under its top, stands lower over the ground than a person
// (PERSON_HEIGHT: walk walls) or the tallest vehicle (drive walls), as an abutment would. A deck
// within ON_DECK of a body's level takes its footing (`groundZ` in src/sim/map/ground-model.ts), so the
// ground rising toward a deck's underside led onto its top. Now someone under a bridge goes only
// where there is headroom, and onto its deck only from its level: along the road at its ends.
//
// The low space runs round each deck's line out to its walls, past where its walkers or its cars
// go, round its ends too (the top there the end's), wherever the ground at the terrain's level
// stands within that headroom under the deck's top; decks whose walls would touch are read as one
// (deck-space.ts). Walls trace its outline, and, inside it, the outline of the ground on the deck's
// level (within ON_DECK of its top) where the low space lies outside that: so nobody under the
// deck's level reaches it from below. Each wall carries a level (issue #91) that every body on the
// ground just outside it meets, and stands more than ONE_LEVEL + ON_DECK under every deck over it:
// a body a deck holds, on it or on the road at its ends, never meets one. A road passing under a
// deck, its surface ONE_LEVEL or more under the deck's top wherever it comes within the walls,
// keeps a corridor through the low space, walled along its sides; any other road opens the walls
// across its carriageway where its surface is on their level, so no wall stands on a road. A road
// meeting a deck's end opens the walk walls round it along its verges too, where pedestrians walk
// onto the deck, up to ONTO past the end where the ground stands within ONE_LEVEL of its top.
import type { Ground } from "../sim/map/ground-model.ts"
import { DECK_SLAB, footReach, isDrivable, ON_DECK, ONE_LEVEL } from "../sim/map/kinds.ts"
import { PERSON_HEIGHT, PERSON_RADIUS } from "../sim/tuning.ts"
import { VEHICLE_MODELS, VEHICLES } from "../sim/vehicles.ts"
import {
  along,
  clustersOf,
  type Deck,
  decksOf,
  fieldAt,
  fieldsOf,
  isLifted,
  key,
  type Line,
  liftOf,
  nodesUnder,
  offSegment,
  RES,
  type Segment,
  segmentsOf,
} from "./deck-space.ts"
import type { RoadF } from "./features.ts"
import { r1, segIndex } from "./geometry.ts"
import { simplifyLoop, traceContours } from "./loops.ts"
import { PARAPET } from "./parapets.ts"
import { type Levelled, opened, pushPolyline } from "./walls.ts"

/** How far an outline may stray from its simplified wall, m. */
const TOL = 0.1
/** The longest wall piece, m: each takes its level from the ground along it, which a body meets within ONE_LEVEL. */
const PIECE = 4
/** A wall stands at least this far under the top of every deck over it, m: past ONE_LEVEL from anyone a deck holds. */
const UNDER_TOP = ONE_LEVEL + ON_DECK
/** How far outside a wall it reads the ground it takes its level from, m: where a body pressed against it stands; and every OUTSIDE[1] m along it. */
const OUTSIDE = [0.25, 0.5] as const
/** The most the ground outside one wall may span below a deck's level, m: a wall meets the grounds within ONE_LEVEL of its level, half a metre in from either end of that. */
const SPAN = 2 * ONE_LEVEL - 1
/** A corridor reaches this far past where the bodies on its road go, m: its walls stand off them. */
const CORRIDOR = 0.25
/** How far past a deck's end, along it, a road meeting the end opens the walk walls round it, m (`open`). */
const ONTO = 2
/** How far past its carriageway a car on a road reaches, m. */
const CAR_PAD = 0.5

/** The tallest vehicle that drives the roads, m (`VEHICLES` heights: the truck's). */
const TALLEST = Math.max(...VEHICLE_MODELS.map((m) => VEHICLES[m].height))
/** The longest vehicle, m (the truck's): the length of road a body touching a wall across it may stand on. */
const LONGEST = Math.max(...VEHICLE_MODELS.map((m) => VEHICLES[m].length))

/** A road's class and carriageway width, m. */
interface Way {
  readonly cls: string
  readonly w: number
}

/** A kind of wall under the decks: whom it stops, and where. */
interface Kind {
  /** How far under a deck's top the ground must stand for this body to fit under it, m. */
  readonly room: number
  /** How far off a deck's line its walls stand, m: past where its bodies go. */
  readonly side: (deck: Way) => number
  /** How far off a road's centreline its bodies go, m: a corridor reaches CORRIDOR past it. */
  readonly reach: (road: Way) => number
  /** Whether this body uses a road of `cls`: only such roads open the walls or keep a corridor. */
  readonly uses: (cls: string) => boolean
  /**
   * How far off the centreline of a road meeting a deck's end its bodies walk onto the deck, m, when
   * they keep to its verges (walkers): it opens the walls round the end that far (`open`).
   */
  readonly onto?: (road: Way) => number
}

/** Walk walls: under PERSON_HEIGHT of headroom, round where someone on foot is on the deck (its slab, its walkers' reach). */
const WALK: Kind = {
  room: DECK_SLAB.depth + PERSON_HEIGHT,
  side: (d) => Math.max(d.w / 2 + DECK_SLAB.margin, footReach(d.cls, d.w)),
  reach: (r) => footReach(r.cls, r.w),
  uses: () => true,
  onto: (r) => footReach(r.cls, r.w) + PERSON_RADIUS,
}

/** Drive walls: under the tallest vehicle's headroom, half a metre past the parapets (and so past the slab). */
const DRIVE: Kind = {
  room: DECK_SLAB.depth + TALLEST,
  side: (d) => d.w / 2 + PARAPET + 0.5,
  reach: (r) => r.w / 2 + CAR_PAD,
  uses: isDrivable,
}

/** A wall piece, flat (ax, ay, bx, by), and its level, m a.s.l. */
type Piece = readonly [number, number, number, number, number]

/**
 * One kind's walls under `decks` (of `roads`, whose shipped lines are `lines`) over `model`, the
 * game's ground, and how many decks they wall.
 */
const wallsOf = (
  kind: Kind,
  model: Ground,
  roads: ReadonlyArray<RoadF>,
  lines: ReadonlyArray<Line>,
  decks: ReadonlyArray<Deck>,
): { readonly walls: Array<number>; readonly levels: Array<number>; readonly decks: number } => {
  const sides = decks.map((d) => kind.side(roads[d.road]!)),
    widest = Math.max(0, ...sides)
  // The roads this kind's bodies use, each segment as far as a corridor reaches, and that plus the
  // widest walls (to find those reaching within a deck's).
  const ways = segIndex<{ readonly road: number; readonly seg: Segment }>(),
    wide = segIndex<number>()
  roads.forEach((r, i) => {
    if (!kind.uses(r.cls)) return
    const reach = kind.reach(r) + CORRIDOR
    for (const seg of segmentsOf(lines[i]!, 0)) {
      const bx = seg.ax + seg.ux * seg.len,
        by = seg.ay + seg.uy * seg.len
      ways.add(seg.ax, seg.ay, bx, by, reach, { road: i, seg })
      wide.add(seg.ax, seg.ay, bx, by, reach + widest, i)
    }
  })
  // The decks' ends: each one's top, and the way into its deck from it (a unit vector). The roads
  // meeting one (a vertex of theirs there): each of their segments from it, out to the widest walls
  // round an end, as far as its bodies walk onto the deck (`onto`), with the end.
  interface End {
    readonly x: number
    readonly y: number
    readonly top: number
    readonly ux: number
    readonly uy: number
  }
  const ends = new Map<string, End>()
  for (const d of decks) {
    const first = d.segs[0],
      last = d.segs.at(-1)
    if (first === undefined || last === undefined) continue
    ends.set(`${first.ax},${first.ay}`, {
      x: first.ax,
      y: first.ay,
      top: first.za,
      ux: first.ux,
      uy: first.uy,
    })
    const bx = lines[d.road]!.pts.at(-2)!,
      by = lines[d.road]!.pts.at(-1)!
    ends.set(`${bx},${by}`, { x: bx, y: by, top: last.zb, ux: -last.ux, uy: -last.uy })
  }
  const meeting = segIndex<{ readonly road: number; readonly end: End }>()
  roads.forEach((r, i) => {
    const onto = kind.onto?.(r)
    if (onto === undefined || !kind.uses(r.cls)) return
    const { pts } = lines[i]!
    for (let k = 0; 2 * k < pts.length; k++) {
      const end = ends.get(`${pts[2 * k]},${pts[2 * k + 1]}`)
      if (end === undefined) continue
      for (const j of [k - 1, k + 1]) {
        if (j < 0 || 2 * j >= pts.length) continue
        const dx = pts[2 * j]! - end.x,
          dy = pts[2 * j + 1]! - end.y,
          f = Math.min(1, (widest + onto) / (Math.hypot(dx, dy) || 1))
        meeting.add(end.x, end.y, end.x + dx * f, end.y + dy * f, onto, { road: i, end })
      }
    }
  })
  // The ground at the terrain's level (the terrain, a platform's top, a road at grade, a deck's end
  // within ON_DECK of the terrain; never a deck above it), and a road's surface at (x, y) on it, its
  // profile `z` there: ROAD_LIFT over the profile, and over the terrain where that stands higher on a
  // road at grade.
  const ground = model.atGrade
  const surfaceOn = (road: number, z: number, x: number, y: number) =>
    model.roadZ(z, x, y, liftOf(roads[road]!), isLifted(roads[road]!))
  // Per deck, the roads passing under it (their surface, at each point of their line within its
  // walls' reach of their corridor, ONE_LEVEL or more under its top), and their corridors.
  const passing = decks.map(() => new Set<number>())
  const corridors = decks.map((deck, i) => {
    const near = new Set<number>()
    for (const s of deck.segs)
      for (const [x, y] of along(s))
        wide.within(x, y, ({ data, r }, d2) => {
          if (Math.sqrt(d2) <= r - widest + sides[i]!) near.add(data)
        })
    const under = segIndex<number>()
    for (const j of [...near].sort((a, b) => a - b)) {
      if (j === deck.road) continue
      const corridor = kind.reach(roads[j]!) + CORRIDOR
      const below = segmentsOf(lines[j]!, 0).every((seg) =>
        along(seg).every(([x, y]) => {
          const z = surfaceOn(j, offSegment(seg, x, y).z, x, y)
          return deck.segs.every((s) => {
            const off = offSegment(s, x, y)
            return off.d > sides[i]! + corridor || off.z - z >= ONE_LEVEL
          })
        }),
      )
      if (!below) continue
      under.addLine(lines[j]!.pts, corridor, j)
      passing[i]!.add(j)
    }
    return under
  })
  const walls: Array<number> = [],
    levels: Array<number> = []
  let walled = 0
  for (const cluster of clustersOf(decks, sides)) {
    const { low, onLevel } = fieldsOf(cluster, decks, sides, kind.room, corridors, ground)
    if (nodesUnder(low).length === 0) continue
    // The cluster's deck nearest (x, y), and the top of the lowest one whose walls reach it (else
    // the nearest's), m a.s.l.: a wall there stands under it, so nobody on any deck over it meets it.
    const nearest = (x: number, y: number) => {
      let best = Infinity,
        top = Infinity,
        near = 0,
        deck = cluster[0]!
      for (const di of cluster)
        for (const s of decks[di]!.segs) {
          const off = offSegment(s, x, y)
          if (off.d <= sides[di]!) top = Math.min(top, off.z)
          if (off.d < best) [best, near, deck] = [off.d, off.z, di]
        }
      return { top: top === Infinity ? near : top, deck }
    }
    // Splits a-b into walls with a level, the region of `field` on their left: one that every body
    // on the ground just outside, to their right, meets, from the lowest ground there up to ON_DECK
    // under a deck's top, and none a deck holds. Where that ground spans SPAN or more (a step, an
    // approach's carriageway over far lower ground), the wall is split. The ground on a deck's level
    // is walled only from the low space round it: elsewhere its outline is the low space's own.
    const levelled = (
      field: ReadonlyMap<number, number>,
      ax: number,
      ay: number,
      bx: number,
      by: number,
    ): Array<Piece> => {
      const len = Math.hypot(bx - ax, by - ay)
      if (len === 0) return []
      const nx = (by - ay) / len,
        ny = -(bx - ax) / len,
        n = Math.max(1, Math.ceil(len / OUTSIDE[1]))
      let lo = Infinity,
        hi = -Infinity,
        top = Infinity,
        band = false
      for (let q = 0; q <= n; q++) {
        const x = ax + ((bx - ax) * q) / n,
          y = ay + ((by - ay) * q) / n,
          t = nearest(x, y).top
        top = Math.min(top, t)
        for (const out of OUTSIDE) {
          const ox = x + nx * out,
            oy = y + ny * out
          // Only ground out of the region: a short piece of a jagged outline may point back in.
          if (fieldAt(field, ox, oy) < 0) continue
          band ||= fieldAt(low, ox, oy) < 0
          const z = ground(ox, oy)
          lo = Math.min(lo, z)
          hi = Math.max(hi, Math.min(z, t - ON_DECK))
        }
      }
      if (field === onLevel && !band) return []
      if (lo === Infinity) lo = hi = top - UNDER_TOP
      if (hi - lo >= SPAN && len > 2 * RES) {
        const mx = r1((ax + bx) / 2),
          my = r1((ay + by) / 2)
        return [...levelled(field, ax, ay, mx, my), ...levelled(field, mx, my, bx, by)]
      }
      // Midway through that ground, or, where that is higher, UNDER_TOP under the deck's top: the
      // ground outside, spanning less than SPAN up to ON_DECK under the top, lies within ONE_LEVEL
      // of it either way.
      return [
        [
          ax,
          ay,
          bx,
          by,
          Math.min(Math.floor((top - UNDER_TOP) * 10), Math.round((lo + hi) * 5)) / 10,
        ],
      ]
    }
    // Another road opens a wall of `level` across its carriageway where its surface, as far along
    // it either way as half the longest vehicle, comes within ONE_LEVEL of the level: a road
    // carrying on from a deck's end, leaving it at an angle, passing through. Its verges stay
    // walled: on a deck's level a body passes the walls anyway, and under it a carriageway floating
    // over far lower ground (its surface never dips under the terrain) would let the ground under
    // it in. One passing under the nearest deck opens none of its walls: it keeps its corridor.
    // A road meeting a deck at its end opens them behind the end as far as its bodies walk onto the
    // deck (`onto`: its verges, for walkers), where the ground stands within ONE_LEVEL of the end's
    // top: a pedestrian walks on along its verge, which climbs to the deck's level there. Under the
    // deck they stay, so nobody comes up onto it from under its end.
    const mine = new Set(cluster.map((di) => decks[di]!.road))
    const open = (level: number) => (x: number, y: number) => {
      const under = passing[nearest(x, y).deck]!
      let through = false
      meeting.within(x, y, ({ data: { road, end } }) => {
        if (
          !mine.has(road) &&
          !under.has(road) &&
          (x - end.x) * end.ux + (y - end.y) * end.uy <= ONTO &&
          end.top - ground(x, y) < ONE_LEVEL
        )
          through = true
      })
      if (through) return true
      ways.within(x, y, ({ data: { road, seg } }, d2, t) => {
        if (mine.has(road) || under.has(road) || Math.sqrt(d2) >= roads[road]!.w / 2) return
        const z = (a: number) => {
          const at = Math.max(0, Math.min(seg.len, t * seg.len + a))
          return surfaceOn(
            road,
            seg.za + ((seg.zb - seg.za) * at) / seg.len,
            seg.ax + seg.ux * at,
            seg.ay + seg.uy * at,
          )
        }
        const zs = [z(-LONGEST / 2), z(0), z(LONGEST / 2)]
        if (Math.max(...zs) > level - ONE_LEVEL && Math.min(...zs) < level + ONE_LEVEL)
          through = true
      })
      return through
    }
    const before = levels.length
    for (const field of [low, onLevel])
      for (const loop of traceContours((i, j) => field.get(key(i, j)), nodesUnder(field), RES)) {
        const pieces: Array<number> = []
        pushPolyline(pieces, simplifyLoop(loop, TOL).flat(), false, PIECE)
        for (let w = 0; w < pieces.length; w += 4)
          for (const [ax, ay, bx, by, level] of levelled(
            field,
            pieces[w]!,
            pieces[w + 1]!,
            pieces[w + 2]!,
            pieces[w + 3]!,
          ))
            for (const piece of opened([{ kind: "wall", pts: [ax, ay, bx, by] }], open(level))) {
              const from = walls.length
              pushPolyline(walls, piece.pts, false, PIECE)
              for (let k = from; k < walls.length; k += 4) levels.push(level)
            }
      }
    if (levels.length > before) walled += cluster.length
  }
  return { walls, levels, decks: walled }
}

/**
 * The walls under the road bridges' decks of `roads` (their shipped `lines`) on `ground`, the game's
 * over the grid as lowered under the decks (deck-ground.ts), these roads and the platforms: the walk
 * and the drive walls, as the module's header says; and for the build's report, how many walls of
 * each kind there are and how many decks they wall.
 */
export const deckWalls = (
  ground: Ground,
  roads: ReadonlyArray<RoadF>,
  lines: ReadonlyArray<Line>,
): {
  readonly walk: Levelled
  readonly drive: Levelled
  readonly report: { readonly walk: number; readonly drive: number; readonly decks: number }
} => {
  const decks = decksOf(roads, lines)
  const walk = wallsOf(WALK, ground, roads, lines, decks),
    drive = wallsOf(DRIVE, ground, roads, lines, decks)
  return {
    walk,
    drive,
    report: {
      walk: walk.levels.length,
      drive: drive.levels.length,
      decks: Math.max(walk.decks, drive.decks),
    },
  }
}
