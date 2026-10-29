// `MAP.railway`: the lines found over the running-track graph, their speed limits, the stations
// where they call and the level-crossing boxes. Everything is read off the shipped (rounded) rail,
// so the sim finds the same arc lengths from `MAP.rail`.
import type { LevelCrossing, RailLine, Station } from "../sim/map/index.ts"
import type { RailF } from "./features.ts"
import { r1 } from "./geometry.ts"
import { buildPlatforms, footOnLine, type PlatformInput, type PlatformOut } from "./platforms.ts"
import {
  findLines,
  kindsOf,
  lengthOf,
  type LineOut,
  type Piece as GraphPiece,
} from "./rail-graph.ts"

/** A rail piece as shipped, with its OSM speed limit. */
interface Piece extends GraphPiece {
  readonly maxspeed?: number
}

/** Crossing nodes on one road within this distance (m) of each other are one box. */
const BOX_GROUP = 10
/** A platform this close (m) to a line stands beside it. */
const BESIDE = 2.5
/** A station or stop node this close (m) to a line marks where it calls. */
const STOP_NEAR = 5

/** A line's OSM speed limits as `[from s, to s, km/h]`, neighbouring pieces with one limit merged. */
export const maxspeedOf = (
  line: LineOut,
  rail: ReadonlyArray<Piece>,
): Array<readonly [number, number, number]> => {
  const spans: Array<[number, number, number]> = []
  line.pieces.forEach(({ rail: i }, k) => {
    const v = rail[i]!.maxspeed,
      from = line.starts[k]!,
      to = line.starts[k + 1] ?? line.length
    if (v === undefined) return
    const last = spans.at(-1)
    if (last?.[2] === v && Math.abs(last[1] - from) < 1e-6) last[1] = to
    else spans.push([from, to, v])
  })
  return spans.map(([a, b, v]) => [r1(a), r1(b), v] as const)
}

/** The lines as `MAP.railway.lines`. */
export const toRailLines = (
  lines: ReadonlyArray<LineOut>,
  rail: ReadonlyArray<Piece>,
): Array<RailLine> => lines.map((l) => ({ pieces: l.pieces, maxspeed: maxspeedOf(l, rail) }))

/** Where line l's vertex `vertex` of rail piece `piece` lies along it, or undefined off it. */
const lineS = (
  lines: ReadonlyArray<LineOut>,
  rail: ReadonlyArray<Piece>,
  piece: number,
  vertex: number,
) => {
  for (let l = 0; l < lines.length; l++) {
    const k = lines[l]!.pieces.findIndex((p) => p.rail === piece)
    if (k < 0) continue
    const p = rail[piece]!.pts
    const along = lengthOf(p.slice(0, 2 * vertex + 2))
    const { rev } = lines[l]!.pieces[k]!
    return { line: l, s: lines[l]!.starts[k]! + (rev ? lengthOf(p) - along : along) }
  }
  return undefined
}

/** A rail vertex shared with a road vertex (a level-crossing node): the road, the node's graph index, its place and its rail piece and vertex. */
export interface LevelNode {
  readonly road: number
  readonly node: number
  readonly x: number
  readonly y: number
  readonly piece: number
  readonly vertex: number
}

/** The level-crossing boxes: the nodes on one road within BOX_GROUP m of each other, each node in the first road's box only. */
export const crossingBoxes = (
  nodes: ReadonlyArray<LevelNode>,
  lines: ReadonlyArray<LineOut>,
  rail: ReadonlyArray<Piece>,
): Array<LevelCrossing> => {
  const firstRoad = new Map<number, number>()
  for (const n of nodes) firstRoad.set(n.node, Math.min(n.road, firstRoad.get(n.node) ?? n.road))
  const kept = nodes.filter((n) => firstRoad.get(n.node) === n.road)
  const groups: Array<Array<LevelNode>> = []
  for (const n of kept) {
    const g = groups.find(
      (q) => q[0]!.road === n.road && q.some((m) => Math.hypot(m.x - n.x, m.y - n.y) <= BOX_GROUP),
    )
    if (g === undefined) groups.push([n])
    else g.push(n)
  }
  return groups.map((g) => {
    const on = g.map((n) => lineS(lines, rail, n.piece, n.vertex)).find((x) => x !== undefined)
    const ids = [...new Set(g.map((n) => n.node))].sort((a, b) => a - b)
    return {
      road: g[0]!.road,
      nodes: ids,
      x: r1(g.reduce((s, n) => s + n.x, 0) / g.length),
      y: r1(g.reduce((s, n) => s + n.y, 0) / g.length),
      line: on?.line ?? -1,
      s: on === undefined ? -1 : r1(on.s),
    }
  })
}

/**
 * Where each line calls: per station name, the extent along the line of the platforms of that name
 * beside it (within BESIDE m) and of its station and stop nodes within STOP_NEAR m, on the side of
 * the biggest of those platforms. By line, then s0.
 */
export const stationsOf = (
  lines: ReadonlyArray<LineOut>,
  platforms: ReadonlyArray<Pick<PlatformOut, "name" | "rings" | "area">>,
  stops: ReadonlyArray<{ readonly name: string; readonly x: number; readonly y: number }>,
): Array<Station> =>
  lines.flatMap((line, l) => {
    const byName = new Map<string, Array<Pick<PlatformOut, "name" | "rings" | "area">>>()
    for (const p of platforms) {
      if (p.name === undefined) continue
      const ring = p.rings[0]!
      let d = Number.MAX_VALUE
      for (let k = 0; k < ring.length; k += 2)
        d = Math.min(d, footOnLine(line.pts, ring[k]!, ring[k + 1]!).d)
      if (d <= BESIDE) byName.set(p.name, [...(byName.get(p.name) ?? []), p])
    }
    return [...byName]
      .map(([name, ps]): Station => {
        let s0 = Number.MAX_VALUE,
          s1 = -Number.MAX_VALUE
        for (const p of ps)
          for (let k = 0; k < p.rings[0]!.length; k += 2) {
            const f = footOnLine(line.pts, p.rings[0]![k]!, p.rings[0]![k + 1]!)
            ;[s0, s1] = [Math.min(s0, f.s), Math.max(s1, f.s)]
          }
        for (const stop of stops) {
          const f = footOnLine(line.pts, stop.x, stop.y)
          if (stop.name === name && f.d <= STOP_NEAR)
            [s0, s1] = [Math.min(s0, f.s), Math.max(s1, f.s)]
        }
        const big = ps.reduce((a, b) => (b.area > a.area ? b : a))
        const ring = big.rings[0]!
        const cx =
            ring.filter((_, k) => k % 2 === 0).reduce((a, b) => a + b, 0) / (ring.length / 2),
          cy = ring.filter((_, k) => k % 2 === 1).reduce((a, b) => a + b, 0) / (ring.length / 2)
        const f = footOnLine(line.pts, cx, cy)
        const tx = line.pts[2 * f.k + 2]! - line.pts[2 * f.k]!,
          ty = line.pts[2 * f.k + 3]! - line.pts[2 * f.k + 1]!
        const left = tx * (cy - f.y) - ty * (cx - f.x) > 0
        return { name, line: l, s0: r1(s0), s1: r1(s1), side: left ? -1 : 1 }
      })
      .sort((a, b) => a.s0 - b.s0)
  })

/** OSM node kinds that name a station where a line calls. */
const STOPS = new Set(["railway=station", "railway=halt", "railway=stop"])

/**
 * The lines over the shipped rail (each piece in `MAP.rail` order with its rounded polyline and
 * profile) between the dead ends where `terminal` holds, each piece's kind, the platforms cut
 * beside them and the stations where they call. `pois` give the station names.
 */
export const layRailway = (
  rail: ReadonlyArray<{
    readonly r: RailF
    readonly pts: ReadonlyArray<number>
    readonly z: ReadonlyArray<number>
  }>,
  terminal: (x: number, y: number) => boolean,
  input: Omit<PlatformInput, "tracks" | "lines" | "stops">,
  pois: ReadonlyArray<{
    readonly kind: string
    readonly name?: string
    readonly x: number
    readonly y: number
  }>,
) => {
  const shipped = rail.map(({ r, pts, z }) => ({
    ...(r.maxspeed === undefined ? {} : { maxspeed: r.maxspeed }),
    pts,
    z,
  }))
  const lines = findLines(shipped, terminal)
  const kinds = kindsOf(shipped, lines)
  const lineOf = new Map(lines.flatMap((l, li) => l.pieces.map((p) => [p.rail, li] as const)))
  const stops = pois.flatMap((p) =>
    p.name !== undefined && STOPS.has(p.kind) ? [{ name: p.name, x: p.x, y: p.y }] : [],
  )
  const platforms = buildPlatforms({
    ...input,
    // A line's pieces are one track; each loop or siding is its own.
    tracks: rail.flatMap(({ r, pts }, i) =>
      r.tunnel === true ? [] : [{ pts, group: lineOf.get(i) ?? lines.length + i }],
    ),
    lines,
    stops,
  })
  return { shipped, lines, kinds, platforms, stations: stationsOf(lines, platforms, stops) }
}
