// What the rail crosses keeps its place after the conflation. Moving a bridge sideways by d slides
// each crossing along it by d·cot θ: a river or road under a bridge must stay under that bridge, so
// the bridge's end slides along the track when it would not. Where the CTR maps the track's ballast
// on a bridge (AFE Sede 063) and OSM draws it at grade, the track is cut into a bridge there (else
// 12 m of track hung 12 m over the Fosso di Rubiana), and so it is over a road tunnel whose mouth
// lies under it (`underpasses`). Water crossing at-grade track (a culvert, as OSM draws its small
// streams) gets a vertex both share, so every crossing at grade is a shared vertex (map.test.ts).
import { inPolygon, splitIn, type Polygon } from "./ctr-rail.ts"
import { arcLengths, crossings, pointAt, type V } from "./geometry.ts"
import { insertOn } from "./rail-match.ts"

/** A line the rail may cross: water or a road, with its width. */
export interface Crossed {
  readonly what: string
  readonly w: number
  /**
   * How far (m) beyond its edge a bridge over it must reach: where the grid cells it keeps (a
   * river's protected bed, a tertiary road's core) end, plus one cell, so no at-grade track
   * beyond the bridge stands over them.
   */
  readonly margin: number
  /** The line as OSM has it, and as it is now (culvert vertices are inserted into water lines). */
  readonly osm: ReadonlyArray<V>
  readonly pts: Array<V>
  /** Water at grade gets a culvert vertex; a road is crossed at grade only at a level crossing. */
  readonly water: boolean
}

/** A piece of a chain: its OSM line and its conflated line share the ids at its ends. */
export interface Span {
  readonly id: number
  readonly bridge: boolean
  readonly tunnel: boolean
  /** Ids at the piece's ends (undefined at a chain end). */
  readonly from?: string
  readonly to?: string
}

/** What `keepSpans` and `cutAtBridges` changed: bridge ends slid along the track, culvert vertices added, at-grade track cut into bridges. */
export interface SpanReport {
  readonly slid: Array<{ readonly bridge: number; readonly end: string; readonly by: number }>
  readonly culverts: Array<string>
  readonly cut: Array<{ readonly piece: number; readonly m: number }>
}

/** A bridge end looks this far (m) along the track beyond it for a crossing that slipped off. */
const LOOK = 50
/** A stretch shorter than this (m) between two cuts at a CTR bridge's edge joins its neighbour. */
const MIN_RUN = 2

/** Half the length along the track that a line of width `w` crossing it at `sin` covers, m. */
const reach = (w: number, sin: number) => w / 2 / Math.max(0.05, sin)

/** Sine of the angle at which polylines a and b cross at arc length `sa` along a, `sb` along b. */
const sinAt = (a: ReadonlyArray<V>, b: ReadonlyArray<V>, sa: number, sb: number) => {
  const p = pointAt(a, arcLengths(a), sa),
    q = pointAt(b, arcLengths(b), sb)
  return Math.abs(p.tx * q.ty - p.ty * q.tx)
}

/** Index range [i, j] of a span's vertices in a chain line. */
const indices = (pts: ReadonlyArray<V>, span: Span): [number, number] => [
  span.from === undefined ? 0 : pts.findIndex((v) => v.id === span.from),
  span.to === undefined ? pts.length - 1 : pts.findIndex((v) => v.id === span.to),
]

/**
 * Keeps every crossing that was on a bridge of `osm` on that bridge of `line` (the same chain,
 * conflated) with the crossed line's `margin` (0 at least) clear beyond its edge: a bridge end
 * that falls short slides along the track (OSM ended the Aulella bridge 3.1 m inside the river). Water that the at-grade track crosses gets
 * a shared vertex, unless it runs under a CTR bridge (`bridged`), which `cutAtBridges` makes one.
 * Throws when the conflated at-grade track crosses water OSM's did not, or when a bridge end to
 * slide is shared with another line (`shared`).
 */
export const keepSpans = (
  osm: ReadonlyArray<V>,
  line: Array<V>,
  spans: ReadonlyArray<Span>,
  crossed: ReadonlyArray<Crossed>,
  shared: (id: string) => boolean,
  bridged: (x: number, y: number) => boolean,
  report: SpanReport,
): void => {
  for (const span of spans) {
    if (!span.bridge) continue
    const [i0, i1] = indices(osm, span)
    const bridge = osm.slice(i0, i1 + 1)
    // The conflated bridge with LOOK m of track either side, and the bridge's ends along it.
    const [j0, j1] = indices(line, span)
    const s = arcLengths(line)
    let k0 = j0,
      k1 = j1
    while (k0 > 0 && s[j0]! - s[k0]! < LOOK) k0--
    while (k1 < line.length - 1 && s[k1]! - s[j1]! < LOOK) k1++
    const near = line.slice(k0, k1 + 1),
      b0 = s[j0]! - s[k0]!,
      b1 = s[j1]! - s[k0]!
    let need0 = b0,
      need1 = b1
    for (const f of crossed)
      for (const c of crossings(bridge, f.osm)) {
        const now = crossings(near, f.pts).sort(
          (p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y),
        )[0]
        if (now === undefined) throw new Error(`bridge ${span.id} no longer crosses ${f.what}`)
        const sin = sinAt(near, f.pts, now.sa, now.sb)
        const e2 = reach(f.w, sin),
          m2 = reach(2 * f.margin, sin)
        need0 = Math.min(need0, now.sa - e2 - m2)
        need1 = Math.max(need1, now.sa + e2 + m2)
      }
    for (const [end, id, need, at] of [
      ["from", span.from, need0, b0],
      ["to", span.to, need1, b1],
    ] as const) {
      if (Math.abs(need - at) < 1e-6) continue
      if (id === undefined || shared(id))
        throw new Error(
          `bridge ${span.id}: its ${end} end must slide but is ${id ?? "a chain end"}`,
        )
      const p = pointAt(near, arcLengths(near), need)
      line.splice(
        line.findIndex((v) => v.id === id),
        1,
      )
      insertOn(line, { x: p.x, y: p.y, id })
      report.slid.push({ bridge: span.id, end, by: Math.abs(need - at) })
    }
  }
  // Culverts: water the at-grade track crosses shares a vertex with it.
  for (const span of spans) {
    if (span.bridge || span.tunnel) continue
    const [i0, i1] = indices(osm, span),
      [j0, j1] = indices(line, span)
    const was = osm.slice(i0, i1 + 1),
      now = line.slice(j0, j1 + 1)
    for (const f of crossed) {
      if (!f.water) continue
      const hits = crossings(now, f.pts).filter(
        (c) =>
          !bridged(c.x, c.y) &&
          !now.some((v) => v.id !== undefined && Math.hypot(v.x - c.x, v.y - c.y) < 1e-6),
      )
      if (hits.length === 0) continue
      if (crossings(was, f.osm).length === 0)
        throw new Error(
          `rail ${span.id} now crosses ${f.what} at grade at (${hits[0]!.x.toFixed(1)}, ${hits[0]!.y.toFixed(1)})`,
        )
      for (const c of hits) {
        const id = `culvert:${f.what.replaceAll(/\s/g, "")}:${report.culverts.length}`
        insertOn(line, { x: c.x, y: c.y, id })
        insertOn(f.pts, { x: c.x, y: c.y, id })
        report.culverts.push(id)
      }
    }
  }
}

/**
 * Cuts each at-grade span of a chain's `line` where it enters and leaves the CTR's bridge
 * `polygons`: each cut becomes a vertex `afe:<piece id>:<n>`, and `onBridge` tells which stretch
 * between cuts is a bridge. Stretches shorter than MIN_RUN join their neighbour. Throws when a
 * level crossing (a vertex a road `shared`) would stand on such a bridge; a culvert's vertex may
 * (the stream then runs under the bridge).
 */
export const cutAtBridges = (
  line: Array<V>,
  spans: ReadonlyArray<Span>,
  polygons: ReadonlyArray<Polygon>,
  shared: (id: string) => boolean,
  report: SpanReport,
): void => {
  for (const span of spans) {
    if (span.bridge || span.tunnel) continue
    const [j0, j1] = indices(line, span)
    const runs: Array<{ inside: boolean; pts: Array<V> }> = []
    for (const run of splitIn(line.slice(j0, j1 + 1), polygons)) {
      const last = runs.at(-1)
      if (last !== undefined && (last.inside === run.inside || length(run.pts) < MIN_RUN))
        last.pts.push(...run.pts.slice(1))
      else runs.push({ inside: run.inside, pts: [...run.pts] })
    }
    if (runs.length > 1 && length(runs[0]!.pts) < MIN_RUN) {
      runs[1]!.pts.unshift(...runs[0]!.pts.slice(0, -1))
      runs.shift()
    }
    for (let k = runs.length - 1; k > 0; k--)
      if (runs[k]!.inside === runs[k - 1]!.inside) {
        runs[k - 1]!.pts.push(...runs[k]!.pts.slice(1))
        runs.splice(k, 1)
      }
    if (!runs.some((r) => r.inside)) continue
    for (const run of runs)
      if (run.inside) {
        const v = run.pts.find((u) => u.id !== undefined && shared(u.id))
        if (v !== undefined)
          throw new Error(`rail ${span.id}: ${v.id} would stand on the CTR bridge there`)
        report.cut.push({ piece: span.id, m: length(run.pts) })
      }
    runs.slice(0, -1).forEach((run, n) => {
      const end = run.pts.at(-1)!
      insertOn(line, { x: end.x, y: end.y, id: `afe:${span.id}:${n}` })
    })
  }
}

/**
 * Where track crosses over a road tunnel near one of the tunnel's mouths, a square about the crossing reaching `half` m across
 * the road's centreline either way (and twice that along it, past the track's way through at down to 27° off square), for
 * `cutAtBridges` to make the track a bridge over it: at grade, the track's own cells and its bed would bury that mouth. Main's
 * OSM track lay over the middle of the residential underpass at s 6324.6 and buried both its mouths; on the CTR's, 1.8 m
 * further south, a car drove in at the north mouth, met the bank over the south one and was thrown 80 m up.
 */
export const underpasses = (
  lines: ReadonlyArray<ReadonlyArray<V>>,
  tunnels: ReadonlyArray<{ readonly pts: ReadonlyArray<V>; readonly half: number }>,
): Array<Polygon> =>
  tunnels.flatMap(({ pts, half }) => {
    const s = arcLengths(pts)
    return lines.flatMap((line) =>
      crossings(line, pts).flatMap((c) => {
        if (c.sb > half && c.sb < s.at(-1)! - half) return []
        const { tx, ty } = pointAt(pts, s, c.sb)
        const corner = (a: number, b: number) => [c.x + tx * a - ty * b, c.y + ty * a + tx * b]
        return [
          [
            [
              ...corner(-2 * half, -half),
              ...corner(2 * half, -half),
              ...corner(2 * half, half),
              ...corner(-2 * half, half),
            ],
          ],
        ]
      }),
    )
  })

/** Whether the stretch `pts` of a cut piece is on a CTR bridge: its middle lies in one of `polygons`. */
export const onBridge = (pts: ReadonlyArray<V>, polygons: ReadonlyArray<Polygon>): boolean => {
  const s = arcLengths(pts)
  const mid = pointAt(pts, s, s.at(-1)! / 2)
  return polygons.some((poly) => inPolygon(mid.x, mid.y, poly))
}

const length = (pts: ReadonlyArray<V>) => arcLengths(pts).at(-1)!
