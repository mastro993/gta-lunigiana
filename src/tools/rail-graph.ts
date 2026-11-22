// The rail as a graph: tracks meet only at piece ends (switches and crossings of two tracks cut the
// pieces there), a line is the way an OSM train route runs from a terminal on the map's edge to
// another or to a terminus inside the map (the straightest way where no route runs), never entering
// a stub (track leading only to dead ends in the map), and the track no line takes is a loop (it
// rejoins other track at both ends) or a siding (it ends in the open). Nothing here knows this map:
// more railways need no code.
import { Ops } from "@typeonce/ritmo-math"

import type { LinePiece } from "../sim/map/index.ts"
import type { RailKind } from "../sim/map/kinds.ts"
import type { RailF } from "./features.ts"

/** A rail piece as shipped: flat x, y and z per vertex, and the id of the OSM way it lies on (OSM's train routes list ways). */
export interface Piece {
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
  readonly way?: number
}

/** A line with its chained polyline: s from its first vertex, and each piece's start s. */
export interface LineOut {
  readonly pieces: ReadonlyArray<LinePiece>
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
  readonly starts: ReadonlyArray<number>
  readonly length: number
  /** Whether its last terminal is a terminus inside the map, where its trains turn round; its first is on the edge. */
  readonly terminus: boolean
}

/** A terminus: the pieces trains reach it along, and its station (a station's termini end one line from a terminal). */
export interface Terminus {
  readonly pieces: ReadonlySet<number>
  readonly station: string
}

/** Beyond this turn (degrees) at a junction no way runs on: the walk ends there. */
export const MAX_TURN = 60
/**
 * A piece's heading at a junction is taken this far (m) into it: on the 0.1 m grid a single short
 * end segment (0.3 m at the shortest) turns up to 12°, more than a turnout diverges (4.5–7.3° at
 * Gragnola).
 */
export const HEADING_SPAN = 5

/**
 * The unit heading from vertex 0 of a line of `n` vertices (`at(k)`, vertex k's x and y) to its first
 * vertex `span` m or more from it, else its last: a piece's heading out of a node.
 */
export const headingOut = (
  n: number,
  at: (k: number) => readonly [number, number],
  span: number,
): readonly [number, number] => {
  const [ax, ay] = at(0)
  let k = 1
  while (k < n - 1 && Math.hypot(at(k)[0] - ax, at(k)[1] - ay) < span) k++
  const [bx, by] = at(k)
  const d = Math.hypot(bx - ax, by - ay) || 1
  return [(bx - ax) / d, (by - ay) / d]
}

/** Arc length of a flat polyline, m. */
export const lengthOf = (pts: ReadonlyArray<number>): number => {
  let s = 0
  for (let k = 2; k < pts.length; k += 2)
    s += Math.hypot(pts[k]! - pts[k - 2]!, pts[k + 1]! - pts[k - 1]!)
  return s
}

/**
 * The pieces cut at every inner vertex another piece shares by id (a switch, two tracks crossing),
 * so that tracks meet only at piece ends; the cut pieces keep their way's id and tags.
 */
export const splitAtJunctions = <T extends RailF>(
  pieces: ReadonlyArray<T>,
  all: ReadonlyArray<RailF> = pieces,
): Array<T> => {
  const uses = new Map<string, number>()
  for (const p of all)
    for (const id of new Set(p.pts.flatMap((v) => (v.id === undefined ? [] : [v.id]))))
      uses.set(id, (uses.get(id) ?? 0) + 1)
  return pieces.flatMap((p) => {
    const ends = [0]
    p.pts.forEach((v, i) => {
      if (i > 0 && i + 1 < p.pts.length && v.id !== undefined && uses.get(v.id)! > 1) ends.push(i)
    })
    ends.push(p.pts.length - 1)
    return ends.length === 2
      ? [p]
      : ends.slice(1).map((b, n) => ({ ...p, pts: p.pts.slice(ends[n], b + 1) }))
  })
}

const keyAt = (pts: ReadonlyArray<number>, i: number) => `${pts[2 * i]},${pts[2 * i + 1]}`
const endKey = (pts: ReadonlyArray<number>, end: 0 | 1) =>
  keyAt(pts, end === 0 ? 0 : pts.length / 2 - 1)

/** The piece ends at each node ("x,y"); throws when a piece runs through another's end or shared vertex, as `splitAtJunctions` prevents. */
const nodesOf = (rail: ReadonlyArray<Piece>) => {
  const at = new Map<string, Array<{ readonly piece: number; readonly end: 0 | 1 }>>()
  rail.forEach((r, i) => {
    for (const end of [0, 1] as const) {
      const k = endKey(r.pts, end)
      at.set(k, [...(at.get(k) ?? []), { piece: i, end }])
    }
  })
  rail.forEach((r, i) => {
    for (let v = 1; v + 1 < r.pts.length / 2; v++)
      if (at.has(keyAt(r.pts, v)))
        throw new Error(`rail piece ${i} runs through a junction at (${keyAt(r.pts, v)})`)
  })
  return at
}

/**
 * The pieces leading only to dead ends: those with an end no other track shares, but where `held`
 * holds, taken away until none is left. Pieces `skip` holds are left out, counted at no end.
 */
const deadEnds = (
  rail: ReadonlyArray<Piece>,
  held: (k: string) => boolean,
  skip: (i: number) => boolean = () => false,
): Set<number> => {
  const degree = new Map<string, number>()
  rail.forEach((r, i) => {
    if (skip(i)) return
    for (const end of [0, 1] as const) {
      const k = endKey(r.pts, end)
      degree.set(k, (degree.get(k) ?? 0) + 1)
    }
  })
  const out = new Set<number>()
  for (let changed = true; changed;) {
    changed = false
    rail.forEach((r, i) => {
      if (skip(i) || out.has(i)) return
      const ends = [endKey(r.pts, 0), endKey(r.pts, 1)]
      if (!ends.some((k) => degree.get(k) === 1 && !held(k))) return
      out.add(i)
      for (const k of ends) degree.set(k, degree.get(k)! - 1)
      changed = true
    })
  }
  return out
}

/**
 * Where a walk along a route goes onto a piece of way `way` from its place `at` in the route (the
 * index of the way it runs on) going `dir` (+1 or −1, 0 while not yet known): on along the same way,
 * or onto the next way the route lists that way round, past ways no piece in the map carries
 * (`present`). Undefined where the route does not run onto that way.
 */
const stepAlong = (
  route: ReadonlyArray<number>,
  present: ReadonlySet<number>,
  at: number,
  dir: number,
  way: number | undefined,
): { readonly at: number; readonly dir: number } | undefined => {
  if (way === undefined) return undefined
  if (route[at] === way) return { at, dir }
  for (const d of dir === 0 ? [1, -1] : [dir]) {
    let n = at + d
    while (n >= 0 && n < route.length && !present.has(route[n]!)) n += d
    if (route[n] === way) return { at: n, dir: d }
  }
  return undefined
}

/**
 * The lines: from each terminal (a dead end where `terminal` holds: the map's edge, where the
 * track runs on beyond it), a walk along each of OSM's train routes running its piece (`routes`: each
 * route's ways, OSM ids in its running order), which at every junction takes the piece of the way the
 * route runs on along (`stepAlong`), and, from a terminal no route walk leads from to another, the
 * walk that takes the way turning least; both turn under MAX_TURN (headings over HEADING_SPAN m) and
 * never into a stub (`deadEnds`: the safety stub straight on past a switch where a double track joins
 * a single one). A walk is kept when it ends at another terminal or reaches a terminus along one of
 * its pieces (`termini`: by node, "x,y" as shipped, the pieces trains reach it along and the station,
 * where they turn round inside the map), where it ends; of two walks between one pair of terminals
 * (or from one terminal to one station's termini), a route's over one turning least, then the one
 * turning less in all. A walk never takes a piece twice, so a ring
 * gives no line. Each line runs the way most of its length was drawn, but toward its terminus; the
 * lines come in the order of their first piece in `rail` (a new branch's after the line it leaves),
 * the longer first of two from one piece.
 */
export const findLines = (
  rail: ReadonlyArray<Piece>,
  terminal: (x: number, y: number) => boolean,
  termini: ReadonlyMap<string, Terminus> = new Map(),
  routes: ReadonlyArray<ReadonlyArray<number>> = [],
): Array<LineOut> => {
  const at = nodesOf(rail)
  /** Unit direction leaving piece i at `end`, into the piece, over HEADING_SPAN m. */
  const leaving = (i: number, end: 0 | 1) => {
    const p = rail[i]!.pts,
      n = p.length / 2
    const v = (k: number) => (end === 0 ? k : n - 1 - k)
    return headingOut(n, (k) => [p[2 * v(k)]!, p[2 * v(k) + 1]!], HEADING_SPAN)
  }
  const isTerminal = (k: string) => {
    if (at.get(k)!.length !== 1) return false
    const [x, y] = k.split(",").map(Number)
    return terminal(x!, y!)
  }
  const stubs = deadEnds(rail, (k) => isTerminal(k) || termini.has(k))
  const present = new Set(rail.flatMap((r) => (r.way === undefined ? [] : [r.way])))
  /**
   * The pieces from piece i entered at `end`, with the turns taken, until no way runs on or it
   * reaches a terminus: along `route` where one is given, else the way turning least.
   */
  const walk = (i: number, end: 0 | 1, route?: ReadonlyArray<number>) => {
    const out: Array<LinePiece> = []
    const seen = new Set<number>()
    let turned = 0,
      place = { at: route?.indexOf(rail[i]!.way!) ?? -1, dir: 0 }
    for (let piece = i, from: 0 | 1 = end; ;) {
      out.push({ rail: piece, rev: from === 1 })
      seen.add(piece)
      const exit = from === 0 ? 1 : 0,
        node = endKey(rail[piece]!.pts, exit)
      if (termini.get(node)?.pieces.has(piece) === true)
        return { pieces: out, end: node, turned, terminus: true }
      const [ox, oy] = leaving(piece, exit)
      let next: { piece: number; end: 0 | 1 } | undefined,
        turn = MAX_TURN,
        onto = place
      for (const o of at.get(node)!) {
        if (seen.has(o.piece) || stubs.has(o.piece)) continue
        const step =
          route === undefined
            ? place
            : stepAlong(route, present, place.at, place.dir, rail[o.piece]!.way)
        if (step === undefined) continue
        const [lx, ly] = leaving(o.piece, o.end)
        // Going on means leaving into the next piece opposite to how this one leaves the node backwards.
        const a = (Ops.acos(Math.max(-1, Math.min(1, -(ox * lx + oy * ly)))) * 180) / Math.PI
        if (a < turn) [next, turn, onto] = [o, a, step]
      }
      if (next === undefined) return { pieces: out, end: node, turned, terminus: false }
      turned += turn
      place = onto
      ;[piece, from] = [next.piece, next.end]
    }
  }
  const best = new Map<string, ReturnType<typeof walk> & { readonly routed: boolean }>()
  /** Keeps walk `w` from terminal `k` when it makes a line, returning whether it does. */
  const keep = (k: string, w: ReturnType<typeof walk>, routed: boolean) => {
    if (w.end === k || !(w.terminus || isTerminal(w.end))) return false
    const pair = w.terminus ? `${k} ${termini.get(w.end)!.station}` : [k, w.end].sort().join(" ")
    const was = best.get(pair)
    if (
      was === undefined ||
      (routed && !was.routed) ||
      (routed === was.routed && w.turned < was.turned - 1e-9)
    )
      best.set(pair, { ...w, routed })
    return true
  }
  rail.forEach((r, i) => {
    for (const end of [0, 1] as const) {
      const k = endKey(r.pts, end)
      if (!isTerminal(k)) continue
      const runs = routes.filter((route) => r.way !== undefined && route.includes(r.way))
      // Every route walk, so the lines are each route's; `some` would stop at the first.
      const routed = runs.map((route) => keep(k, walk(i, end, route), true))
      if (!routed.includes(true)) keep(k, walk(i, end), false)
    }
  })
  return [...best.values()]
    .map(({ pieces: path, terminus }) => {
      const len = (p: LinePiece) => lengthOf(rail[p.rail]!.pts)
      const reversed = !terminus && path.reduce((s, p) => s + (p.rev ? len(p) : -len(p)), 0) > 0
      const pieces = reversed ? [...path].reverse().map((p) => ({ ...p, rev: !p.rev })) : path
      const pts: Array<number> = [],
        z: Array<number> = [],
        starts: Array<number> = []
      let s = 0
      for (const { rail: i, rev } of pieces) {
        starts.push(s)
        const p = rail[i]!.pts,
          pz = rail[i]!.z,
          n = pz.length
        for (let k = 0; k < n; k++) {
          const j = rev ? n - 1 - k : k
          if (k === 0 && pts.length > 0) continue
          pts.push(p[2 * j]!, p[2 * j + 1]!)
          z.push(pz[j]!)
        }
        s += lengthOf(p)
      }
      return { pieces, pts, z, starts, length: s, terminus }
    })
    .sort((a, b) => firstPiece(a) - firstPiece(b) || b.length - a.length)
}

/** The first of a line's pieces in the rail's order: lines are numbered by it. */
const firstPiece = (line: LineOut) => Math.min(...line.pieces.map((p) => p.rail))

/**
 * Each piece's kind: none on a line; off the lines, a `siding` when it leads only to dead ends
 * (`deadEnds` over the pieces off the lines, a line's piece ends holding), else a `loop` (it
 * rejoins other track at both ends: Gragnola's track 1, or a ring).
 */
export const kindsOf = (
  rail: ReadonlyArray<Piece>,
  lines: ReadonlyArray<LineOut>,
): Array<RailKind | undefined> => {
  const onLine = new Set(lines.flatMap((l) => l.pieces.map((p) => p.rail)))
  const anchored = new Set(
    [...onLine].flatMap((i) => [endKey(rail[i]!.pts, 0), endKey(rail[i]!.pts, 1)]),
  )
  const sidings = deadEnds(
    rail,
    (k) => anchored.has(k),
    (i) => onLine.has(i),
  )
  return rail.map((_, i) => (onLine.has(i) ? undefined : sidings.has(i) ? "siding" : "loop"))
}
