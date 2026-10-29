// The clearance rule: outside level-crossing boxes and platforms, no walk verge or traffic lane
// comes within RAIL_CLEAR of the centreline of at-grade running track at its level. A road whose
// verge would is given a narrower one (`Road.verge`), so people walk nearer its middle there; a
// lane that would throws.
import { laneOffset, vergeOf } from "../sim/map/kinds.ts"
import { pointInRing, segDist2, segIndex } from "./geometry.ts"

/** The ATR 220's half-width (1.44 m), a person's radius (0.35 m) and 1 m between them, m. */
const RAIL_CLEAR = 2.8
/** A crossing box reaches this far (m) from its nodes: the crossing road's verges and lanes come within RAIL_CLEAR of the track up to 12.4 m away (Viale 20 Settembre, crossed at a slant). */
const BOX_REACH = 15
/** Road and rail further apart in height than this (m) are on two levels (a bridge, a cutting): no clearance applies. */
const LEVELS = 2
/** Samples along each graph edge, m. */
const STEP = 0.5
/** A narrowed verge clears RAIL_CLEAR by this much, m. */
const SPARE = 0.05
/** People walk at least this far from the middle of a road (paths, steps and tracks keep 0.3 m). */
const MIN_VERGE = 0.3

/** A polyline with a value per vertex (the shipped road and rail profiles). */
interface Profiled {
  readonly pts: ReadonlyArray<number>
  readonly z: ReadonlyArray<number>
}

/** What the rule reads: the graph as shipped, the roads and the at-grade running track with their profiles, the boxes and the platforms. */
export interface ClearInput {
  readonly graph: {
    readonly xy: ReadonlyArray<number>
    readonly edges: ReadonlyArray<number>
    readonly walk: ReadonlyArray<number>
    readonly traffic: ReadonlyArray<number>
  }
  readonly roads: ReadonlyArray<Profiled & { readonly cls: string; readonly w: number }>
  /** At-grade running track pieces. */
  readonly track: ReadonlyArray<Profiled>
  /** Each box's road index and its nodes' positions. */
  readonly boxes: ReadonlyArray<{
    readonly road: number
    readonly at: ReadonlyArray<readonly [number, number]>
  }>
  /** Platform and walkway rings (outer first, then holes). */
  readonly platforms: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>
}

/** The value along a profiled polyline at the point of it nearest (x, y). */
const valueAt = (l: Profiled, x: number, y: number): number => {
  let best = Number.MAX_VALUE,
    v = l.z[0]!
  for (let k = 0; k + 1 < l.z.length; k++) {
    const { d2, t } = segDist2(
      x,
      y,
      l.pts[2 * k]!,
      l.pts[2 * k + 1]!,
      l.pts[2 * k + 2]!,
      l.pts[2 * k + 3]!,
    )
    if (d2 < best) [best, v] = [d2, l.z[k]! + (l.z[k + 1]! - l.z[k]!) * t]
  }
  return v
}

/** Least distance from (x, y) to a flat polyline. */
const distTo = (pts: ReadonlyArray<number>, x: number, y: number): number => {
  let d2 = Number.MAX_VALUE
  for (let k = 0; k + 3 < pts.length; k += 2)
    d2 = Math.min(d2, segDist2(x, y, pts[k]!, pts[k + 1]!, pts[k + 2]!, pts[k + 3]!).d2)
  return Math.sqrt(d2)
}

/** A sample the rule finds too near the track: the edge, the point and its distance. */
interface Offender {
  readonly edge: number
  readonly x: number
  readonly y: number
  readonly d: number
}

/**
 * The rule over the shipped data: the samples of graph edge `e`'s lines `off` m to either side that
 * come within RAIL_CLEAR of at-grade running track at its level, outside every box (within BOX_REACH
 * of a node, on the box's road or within its verges) and platform.
 */
const makeRule = (input: ClearInput) => {
  const { graph, roads, track, boxes, platforms } = input
  const near = segIndex<{ za: number; zb: number }>()
  for (const t of track)
    for (let k = 0; k + 1 < t.z.length; k++)
      near.add(t.pts[2 * k]!, t.pts[2 * k + 1]!, t.pts[2 * k + 2]!, t.pts[2 * k + 3]!, RAIL_CLEAR, {
        za: t.z[k]!,
        zb: t.z[k + 1]!,
      })
  const inBox = (x: number, y: number, road: number) =>
    boxes.some(
      (b) =>
        b.at.some(([bx, by]) => Math.hypot(bx - x, by - y) <= BOX_REACH) &&
        (b.road === road ||
          distTo(roads[b.road]!.pts, x, y) <= vergeOf(roads[b.road]!.cls, roads[b.road]!.w) + 0.35),
    )
  const onPlatform = (x: number, y: number) =>
    platforms.some(
      ([outer, ...holes]) => pointInRing(x, y, outer!) && !holes.some((h) => pointInRing(x, y, h)),
    )
  return (e: number, off: number): Array<Offender> => {
    const out: Array<Offender> = []
    const a = graph.edges[3 * e]!,
      b = graph.edges[3 * e + 1]!,
      road = graph.edges[3 * e + 2]!
    const ax = graph.xy[2 * a]!,
      ay = graph.xy[2 * a + 1]!,
      bx = graph.xy[2 * b]!,
      by = graph.xy[2 * b + 1]!
    const len = Math.hypot(bx - ax, by - ay)
    if (len === 0) return out
    const nx = (by - ay) / len,
      ny = -(bx - ax) / len,
      n = Math.ceil(len / STEP)
    for (let q = 0; q <= n; q++) {
      const cx = ax + ((bx - ax) * q) / n,
        cy = ay + ((by - ay) * q) / n
      for (const side of [1, -1]) {
        const x = cx + nx * off * side,
          y = cy + ny * off * side
        let d = RAIL_CLEAR,
          z = 0
        near.within(x, y, (s, d2, t) => {
          if (Math.sqrt(d2) < d) [d, z] = [Math.sqrt(d2), s.data.za + (s.data.zb - s.data.za) * t]
        })
        if (d >= RAIL_CLEAR || Math.abs(valueAt(roads[road]!, cx, cy) - z) >= LEVELS) continue
        if (inBox(x, y, road) || onPlatform(x, y)) continue
        out.push({ edge: e, x, y, d })
      }
    }
    return out
  }
}

/** What the rule changed: each road given a narrower verge, with its nearest sample before. */
export interface ClearReport {
  readonly verges: ReadonlyArray<{
    readonly road: number
    readonly before: number
    readonly verge: number
  }>
}

/**
 * Narrows the verge of every road whose walk edges would come within RAIL_CLEAR of the track (both
 * sides: `walkSide` reads one verge per road) until none does. Returns road index → verge, m (rounded
 * down to the centimetre); throws when a traffic lane is too near the track, or a verge would drop
 * under MIN_VERGE.
 */
export const clearVerges = (
  input: ClearInput,
): { verges: Map<number, number>; report: ClearReport } => {
  const rule = makeRule(input)
  const { graph, roads } = input
  for (const e of graph.traffic) {
    const bad = rule(e, laneOffset(roads[graph.edges[3 * e + 2]!]!.w))[0]
    if (bad !== undefined)
      throw new Error(
        `traffic lane of edge ${e} at (${bad.x.toFixed(1)}, ${bad.y.toFixed(1)}) is ${bad.d.toFixed(2)} m from the running track`,
      )
  }
  const walkOf = new Map<number, Array<number>>()
  for (const e of graph.walk) {
    const r = graph.edges[3 * e + 2]!
    walkOf.set(r, [...(walkOf.get(r) ?? []), e])
  }
  const verges = new Map<number, number>()
  const report: Array<ClearReport["verges"][number]> = []
  for (const [r, edges] of [...walkOf].sort((p, q) => p[0] - q[0])) {
    let verge = vergeOf(roads[r]!.cls, roads[r]!.w),
      before: number | undefined
    for (;;) {
      const bad = edges.flatMap((e) => rule(e, verge))
      if (bad.length === 0) break
      const worst = Math.min(...bad.map((o) => o.d))
      before ??= worst
      verge = Math.floor((verge - (RAIL_CLEAR - worst) - SPARE) * 100 + 1e-9) / 100
      if (verge < MIN_VERGE)
        throw new Error(
          `road ${r}: its verge would come within ${MIN_VERGE} m of its middle beside the railway`,
        )
    }
    if (before !== undefined) {
      verges.set(r, verge)
      report.push({ road: r, before, verge })
    }
  }
  return { verges, report: { verges: report } }
}
