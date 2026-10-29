// The rail as a graph: tracks meet only at piece ends (switches and crossings of two tracks cut the
// pieces there), a line is the straightest way from one terminal to another, and the track no line
// takes is a loop (it rejoins other track at both ends) or a siding (it ends in the open). Nothing
// here knows this map: more railways need no code.
import type { LinePiece } from "../sim/map/index.ts"
import type { RailKind } from "../sim/map/kinds.ts"
import type { RailF } from "./features.ts"

/** A rail piece as shipped: flat x, y and z per vertex. */
export interface Piece {
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
}

/** A line with its chained polyline: s from its first vertex, and each piece's start s. */
export interface LineOut {
  readonly pieces: ReadonlyArray<LinePiece>
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
  readonly starts: ReadonlyArray<number>
  readonly length: number
}

/** Beyond this turn (degrees) at a junction no way runs on: the walk ends there. */
const MAX_TURN = 60
/**
 * A piece's heading at a junction is taken this far (m) into it: on the 0.1 m grid a single short
 * end segment (0.3 m at the shortest) turns up to 12°, more than a turnout diverges (4.5–7.3° at
 * Gragnola).
 */
const HEADING_SPAN = 5

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
 * The lines: from each terminal (a dead end where `terminal` holds: the map's edge, where the
 * track runs on beyond it), the walk that at every junction takes the way turning least (under
 * MAX_TURN, headings over HEADING_SPAN m), kept when it ends at another terminal; of two walks
 * between one pair of terminals, the one turning less in all. A walk never takes a piece twice, so
 * a ring gives no line. Each line runs the way most of its length was drawn, longest line first.
 */
export const findLines = (
  rail: ReadonlyArray<Piece>,
  terminal: (x: number, y: number) => boolean,
): Array<LineOut> => {
  const at = nodesOf(rail)
  /** Unit direction leaving piece i at `end`, into the piece, over HEADING_SPAN m. */
  const leaving = (i: number, end: 0 | 1) => {
    const p = rail[i]!.pts,
      n = p.length / 2
    const v = (k: number) => (end === 0 ? k : n - 1 - k)
    const [ax, ay] = [p[2 * v(0)]!, p[2 * v(0) + 1]!]
    let k = 1
    while (k < n - 1 && Math.hypot(p[2 * v(k)]! - ax, p[2 * v(k) + 1]! - ay) < HEADING_SPAN) k++
    const bx = p[2 * v(k)]!,
      by = p[2 * v(k) + 1]!
    const d = Math.hypot(bx - ax, by - ay) || 1
    return [(bx - ax) / d, (by - ay) / d] as const
  }
  const isTerminal = (k: string) => {
    if (at.get(k)!.length !== 1) return false
    const [x, y] = k.split(",").map(Number)
    return terminal(x!, y!)
  }
  /** The pieces from piece i entered at `end`, with the turns taken, until no way runs on. */
  const walk = (i: number, end: 0 | 1) => {
    const out: Array<LinePiece> = []
    const seen = new Set<number>()
    let turned = 0
    for (let piece = i, from: 0 | 1 = end; ;) {
      out.push({ rail: piece, rev: from === 1 })
      seen.add(piece)
      const exit = from === 0 ? 1 : 0
      const [ox, oy] = leaving(piece, exit)
      let next: { piece: number; end: 0 | 1 } | undefined,
        turn = MAX_TURN
      for (const o of at.get(endKey(rail[piece]!.pts, exit))!) {
        if (seen.has(o.piece)) continue
        const [lx, ly] = leaving(o.piece, o.end)
        // Going on means leaving into the next piece opposite to how this one leaves the node backwards.
        const a = (Math.acos(Math.max(-1, Math.min(1, -(ox * lx + oy * ly)))) * 180) / Math.PI
        if (a < turn) [next, turn] = [o, a]
      }
      if (next === undefined) return { pieces: out, end: endKey(rail[piece]!.pts, exit), turned }
      turned += turn
      ;[piece, from] = [next.piece, next.end]
    }
  }
  const best = new Map<string, { pieces: Array<LinePiece>; turned: number }>()
  rail.forEach((r, i) => {
    for (const end of [0, 1] as const) {
      const k = endKey(r.pts, end)
      if (!isTerminal(k)) continue
      const w = walk(i, end)
      if (w.end === k || !isTerminal(w.end)) continue
      const pair = [k, w.end].sort().join(" ")
      const was = best.get(pair)
      if (was === undefined || w.turned < was.turned - 1e-9) best.set(pair, w)
    }
  })
  return [...best.values()]
    .map(({ pieces: path }) => {
      const len = (p: LinePiece) => lengthOf(rail[p.rail]!.pts)
      const reversed = path.reduce((s, p) => s + (p.rev ? len(p) : -len(p)), 0) > 0
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
      return { pieces, pts, z, starts, length: s }
    })
    .sort((a, b) => b.length - a.length || a.pieces[0]!.rail - b.pieces[0]!.rail)
}

/**
 * Each piece's kind: none on a line; off the lines, a `siding` when it leads only to dead ends
 * (pieces with an end no other track shares, other than on a line, are taken away until none is
 * left), else a `loop` (it rejoins other track at both ends: Gragnola's track 1, or a ring).
 */
export const kindsOf = (
  rail: ReadonlyArray<Piece>,
  lines: ReadonlyArray<LineOut>,
): Array<RailKind | undefined> => {
  const onLine = new Set(lines.flatMap((l) => l.pieces.map((p) => p.rail)))
  const anchored = new Set(
    [...onLine].flatMap((i) => [endKey(rail[i]!.pts, 0), endKey(rail[i]!.pts, 1)]),
  )
  const degree = new Map<string, number>()
  for (const r of rail)
    for (const end of [0, 1] as const) {
      const k = endKey(r.pts, end)
      degree.set(k, (degree.get(k) ?? 0) + 1)
    }
  const kind: Array<RailKind | undefined> = rail.map((_, i) => (onLine.has(i) ? undefined : "loop"))
  for (let changed = true; changed;) {
    changed = false
    rail.forEach((r, i) => {
      if (kind[i] !== "loop") return
      const ends = [endKey(r.pts, 0), endKey(r.pts, 1)]
      if (!ends.some((k) => degree.get(k) === 1 && !anchored.has(k))) return
      kind[i] = "siding"
      for (const k of ends) degree.set(k, degree.get(k)! - 1)
      changed = true
    })
  }
  return kind
}
