// OSM's rail moved onto the CTR's surveyed track centrelines: each OSM track is matched to CTR
// tracks (rail-match.ts); matched runs take the CTR's own vertices; an unmatched run between two
// matched ones (a tunnel) moves OSM's by a displacement interpolated between their ends and is
// smoothed onto the CTR's headings there (rail-smooth.ts), one towards a chain end keeps OSM's
// shape, moved as its last matched sample; every OSM vertex with an id gets one position, which the
// roads (level crossings, rail-crossings.ts), the water (culverts) and the stops sharing that id
// take too; bridges keep what they span and at-grade track becomes a bridge where the CTR maps one
// or a road tunnel's mouth lies under it (rail-spans.ts); the tracks only the CTR has are added
// (rail-extra.ts); last, pieces are cut where tracks meet (rail-graph.ts).
import { isDrivable } from "../sim/map/kinds.ts"
import { inPolygon, type CtrRail } from "./ctr-rail.ts"
import type { RailF, RoadF, WaterF } from "./features.ts"
import { arcLengths, BOUNDS, pointAt, r1, type V } from "./geometry.ts"
import { chainsOf, coreHalf } from "./profiles.ts"
import { checkCrossings, slideCrossing, type Slid } from "./rail-crossings.ts"
import { buildExtras, type Report as ExtraReport } from "./rail-extra.ts"
import { splitAtJunctions } from "./rail-graph.ts"
import {
  footOn,
  lineOf,
  matchSamples,
  MIN_SEG,
  pruneShort,
  simplifyLine,
  type Foot,
  type Line,
  type Sample,
} from "./rail-match.ts"
import { smoothGap } from "./rail-smooth.ts"
import {
  cutAtBridges,
  keepSpans,
  onBridge,
  underpasses,
  type Crossed,
  type SpanReport,
} from "./rail-spans.ts"
import { GRID_CELL } from "./terrain.ts"

/**
 * Where OSM's track layout is wrong and the CTR's is taken instead. Gragnola: OSM
 * draws the loop on the east track and the line crossing over to the west one, while the CTR, the
 * 2022 orthophoto (two tracks side by side down to y 2965, a maintenance vehicle on the stub) and
 * RFI's working (every train not crossing another uses track 2) have the straight east track as the
 * through track 2 and the west track by the building as loop track 1, leaving the line at both ends.
 */
export interface Layout {
  /** OSM rail ways left out: Gragnola's mis-drawn loop. */
  readonly drop: ReadonlySet<number>
  /** CTR lines whose tracks no OSM track may match: they are drawn from the CTR alone (Gragnola's west track). */
  readonly reserved: ReadonlySet<string>
  /**
   * OSM node ids on the line that belong on a reserved track, each with the id (on OSM's dropped
   * loop) that takes its place on the line: the stop with `railway:track_ref=1` and the Via Castel
   * dell'Aquila crossing node of track 1 go to the west track, their track-2 partners to the line.
   */
  readonly swap: ReadonlyMap<string, string>
}

/** Gragnola's layout from the CTR (`23D19 VLI#0.0` starts its west track). */
const LAYOUT: Layout = {
  drop: new Set([1156620650, 1156620651]),
  reserved: new Set(["23D19 VLI#0.0"]),
  swap: new Map([
    ["13949046317", "10756127162"],
    ["1541571998", "10756127166"],
  ]),
}

/** Consecutive samples k0…k1 matched on one CTR track, with their arc lengths `sig` on it (made monotone). */
interface Run {
  readonly track: number
  readonly k0: number
  k1: number
  readonly sig: Array<number>
}

/** Spacing of the samples matched along OSM's track, m. */
const STEP = 2
/** Plan tolerance of the CTR vertices kept on matched runs, m. */
const KEEP = 0.05
/** A vertex without an id this close to one with an id (m) is dropped: they would round onto one point. */
const NEAR_ID = 0.15
/** Residual limits on matched at-grade and bridge samples, m: the CTR's 1:2000 survey is good to a few decimetres. */
const RESIDUAL = { median: 0.2, p90: 0.5, max: 1 }

/** Median, 90th percentile and maximum, m. */
type Spread = readonly [number, number, number]
const spread = (xs: ReadonlyArray<number>): Spread => {
  const v = [...xs].sort((a, b) => a - b)
  const q = (f: number) =>
    v.length === 0 ? 0 : v[Math.min(v.length - 1, Math.floor(f * v.length))]!
  return [q(0.5), q(0.9), v.at(-1) ?? 0]
}

/** What the conflation did, for the build's summary. */
export interface Report {
  /** Per OSM piece: length, metres matched, OSM's offset from the CTR and the shipped residual on matched samples. */
  readonly pieces: ReadonlyArray<{
    readonly id: number
    readonly m: number
    readonly matched: number
    readonly offset: Spread
    readonly residual: Spread
  }>
  /** Over every matched at-grade and bridge sample. */
  readonly residual: Spread
  readonly offset: Spread
  /** Level-crossing nodes moved along their road onto the CTR track, m. */
  readonly crossings: ReadonlyArray<Slid>
  readonly extras: ExtraReport
  readonly spans: SpanReport
}

/** The result: running pieces on the CTR, the tracks only the CTR has, the roads and water, and every id's new position. */
interface Conflated {
  readonly rail: Array<RailF>
  readonly extra: Array<RailF>
  readonly roads: Array<RoadF>
  readonly water: Array<WaterF>
  readonly moves: ReadonlyMap<string, V>
  readonly report: Report
}

/** Samples every ~STEP m of a chain's polyline; those strictly inside a tunnel piece may not match. */
const samplesOf = (
  pts: ReadonlyArray<V>,
  s: ReadonlyArray<number>,
  tunnel: (at: number) => boolean,
) => {
  const n = Math.max(1, Math.ceil(s.at(-1)! / STEP)),
    h = s.at(-1)! / n
  const out: Array<Sample & { readonly at: number }> = []
  for (let k = 0; k <= n; k++) {
    const p = pointAt(pts, s, k * h)
    out.push({ x: p.x, y: p.y, tx: p.tx, ty: p.ty, free: tunnel(k * h), at: k * h })
  }
  return { out, h }
}

/** Point on the bounds' edge `e` along the line from `from` through `to`, or `to` itself. */
const ontoEdge = (from: V, to: V, e: "minX" | "maxX" | "minY" | "maxY"): V => {
  const vertical = e === "minX" || e === "maxX"
  const d = vertical ? to.x - from.x : to.y - from.y
  if (d === 0) return to
  const t = (BOUNDS[e] - (vertical ? from.x : from.y)) / d
  return { ...to, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}
const edgeOf = (v: V): "minX" | "maxX" | "minY" | "maxY" | undefined =>
  v.id === undefined
    ? (["minX", "maxX", "minY", "maxY"] as const).find(
        (e) => Math.abs((e === "minX" || e === "maxX" ? v.x : v.y) - BOUNDS[e]) < 1e-6,
      )
    : undefined

/** `pts` with every vertex whose id moved at its new position. */
const moved = <T extends V>(pts: ReadonlyArray<T>, moves: ReadonlyMap<string, V>): Array<T> =>
  pts.map((v) => {
    const to = v.id === undefined ? undefined : moves.get(v.id)
    return to === undefined ? v : { ...v, x: to.x, y: to.y }
  })

/**
 * Moves OSM's running rail onto the CTR tracks and adds the tracks only the CTR has. `roads` are
 * returned with their level-crossing nodes moved; throws when a crossing node would leave the
 * half of its road segment or the CTR's crossing polygon, an id is lost or the residuals break
 * the limits.
 */
export const conflateRail = (
  osmRail: ReadonlyArray<RailF>,
  osmRoads: ReadonlyArray<RoadF>,
  osmWater: ReadonlyArray<WaterF>,
  ctr: CtrRail,
  layout: Layout = LAYOUT,
): Conflated => {
  const lines: Array<Line> = ctr.tracks.map((t) => lineOf(simplifyLine(t.pts, KEEP)))
  const surveyed = ctr.tracks.map((t) => lineOf(t.pts))
  const reserved = ctr.tracks.map((t) => t.src.some((src) => layout.reserved.has(src)))
  // OSM's position of every node id on the rail, before any swap.
  const osmAt = new Map<string, V>()
  for (const r of osmRail) for (const v of r.pts) if (v.id !== undefined) osmAt.set(v.id, v)
  const rail = osmRail
    .filter((r) => !layout.drop.has(r.id))
    .map((r) => ({
      ...r,
      pts: r.pts.map((v) => {
        const id = v.id === undefined ? undefined : layout.swap.get(v.id)
        return id === undefined ? v : { ...v, id }
      }),
    }))
  const roadPts = osmRoads.map((r) => [...r.pts])
  const roadsAt = new Map<string, Array<{ readonly road: number; readonly i: number }>>()
  roadPts.forEach((pts, road) =>
    pts.forEach((v, i) => {
      if (v.id !== undefined) roadsAt.set(v.id, [...(roadsAt.get(v.id) ?? []), { road, i }])
    }),
  )
  const moves = new Map<string, V>()
  const crossings: Array<Slid> = []
  const used = ctr.tracks.map(() => false)
  const chains = chainsOf(rail).map((chain) => {
    const runs = chain.map(({ item, rev }) => (rev ? [...item.pts].reverse() : [...item.pts]))
    const pts = runs.flatMap((r, i) => (i === 0 ? r : r.slice(1)))
    const s = arcLengths(pts)
    const starts = [0]
    for (const r of runs) starts.push(starts.at(-1)! + arcLengths(r).at(-1)!)
    const pieceAt = (at: number) => {
      let i = 0
      while (i + 1 < chain.length && starts[i + 1]! <= at) i++
      return i
    }
    const { out: samples, h } = samplesOf(pts, s, (at) => {
      const i = pieceAt(at)
      return chain[i]!.item.tunnel === true && at > starts[i]! + 1e-6 && at < starts[i + 1]! - 1e-6
    })
    const match = matchSamples(samples, lines, (k) => !reserved[k])
    for (const m of match) if (m.track >= 0) used[m.track] = true
    // Each sample's displacement: to its foot where matched; between matched ends linear in s, held towards a chain end.
    const disp = samples.map((p, k) => {
      const f = match[k]!.foot
      return f === undefined ? undefined : { dx: f.x - p.x, dy: f.y - p.y }
    })
    for (let k = 0; k < disp.length; k++) {
      if (disp[k] !== undefined) continue
      let b = k
      while (b < disp.length && disp[b] === undefined) b++
      const left = disp[k - 1],
        right = disp[b]
      for (let j = k; j < b; j++) {
        const t = left === undefined || right === undefined ? 0 : (j - k + 1) / (b - k + 1)
        const a = left ?? right ?? { dx: 0, dy: 0 },
          c = right ?? left ?? { dx: 0, dy: 0 }
        disp[j] = { dx: a.dx + (c.dx - a.dx) * t, dy: a.dy + (c.dy - a.dy) * t }
      }
      k = b
    }
    const dispAt = (at: number) => {
      const k = Math.min(samples.length - 2, Math.floor(at / h)),
        t = Math.max(0, Math.min(1, at / h - k))
      const a = disp[k]!,
        b = disp[k + 1] ?? a
      return { dx: a.dx + (b.dx - a.dx) * t, dy: a.dy + (b.dy - a.dy) * t }
    }
    // Matched runs: consecutive samples on one CTR track, with arc length on it made monotone.
    const matched: Array<Run> = []
    for (let k = 0; k < samples.length; k++) {
      const t = match[k]!.track
      if (t < 0) continue
      const last = matched.at(-1)
      if (last?.track === t && last.k1 === k - 1) last.k1 = k
      else matched.push({ track: t, k0: k, k1: k, sig: [] })
    }
    for (const run of matched) {
      for (let k = run.k0; k <= run.k1; k++) run.sig.push(match[k]!.foot!.s)
      const dir = Math.sign(run.sig.at(-1)! - run.sig[0]!) || 1
      for (let i = 1; i < run.sig.length; i++)
        run.sig[i] = dir * Math.max(dir * run.sig[i]!, dir * run.sig[i - 1]!)
    }
    /** Chain arc length of the point at arc length `sig` along a run's CTR track. */
    const keyOf = (run: Run, sig: number) => {
      const dir = Math.sign(run.sig.at(-1)! - run.sig[0]!) || 1
      let i = 1
      while (i < run.sig.length - 1 && dir * run.sig[i]! < dir * sig) i++
      if (run.sig.length === 1) return run.k0 * h
      const a = run.sig[i - 1]!,
        b = run.sig[i]!
      const t = a === b ? 0 : Math.max(0, Math.min(1, (sig - a) / (b - a)))
      return (run.k0 + i - 1 + t) * h
    }
    const runAt = (at: number) =>
      matched.find((r) => r.k0 * h <= at + 1e-9 && at <= r.k1 * h + 1e-9 && r.k1 > r.k0)
    const items: Array<{ key: number; v: V }> = []
    for (const run of matched) {
      const line = lines[run.track]!,
        lo = Math.min(run.sig[0]!, run.sig.at(-1)!),
        hi = Math.max(run.sig[0]!, run.sig.at(-1)!)
      for (const k of [run.k0, run.k1]) items.push({ key: k * h, v: match[k]!.foot! })
      line.pts.forEach(([x, y], j) => {
        if (line.s[j]! > lo && line.s[j]! < hi)
          items.push({ key: keyOf(run, line.s[j]!), v: { x, y } })
      })
    }
    const isCrossing = (id: string | undefined) => id !== undefined && roadsAt.has(id)
    pts.forEach((v, j) => {
      if (isCrossing(v.id)) return // placed on the rail where it crosses the road, below
      const run = runAt(s[j]!)
      if (v.id === undefined && run !== undefined) return // the CTR's vertices stand there
      const placed = v.id === undefined ? undefined : moves.get(v.id)
      if (placed !== undefined) return items.push({ key: s[j]!, v: placed })
      let key = s[j]!,
        at: V
      const f: Foot | undefined =
        run === undefined ? undefined : footOn(lines[run.track]!, v.x, v.y)
      if (run !== undefined && f !== undefined) [key, at] = [keyOf(run, f.s), { x: f.x, y: f.y }]
      else {
        const d = dispAt(s[j]!)
        at = { x: v.x + d.dx, y: v.y + d.dy }
      }
      const out = v.id === undefined ? at : { ...at, id: v.id }
      if (v.id !== undefined) moves.set(v.id, out)
      items.push({ key, v: out })
    })
    items.sort((a, b) => a.key - b.key)
    // Where no CTR track guides it between two matched samples (a tunnel, a gap in the sheets),
    // OSM's few vertices are smoothed, holding the CTR's heading at both ends. Towards a chain end
    // OSM's line keeps its shape, moved as its last matched sample (smoothed, with no CTR at all a
    // 20° kink came back 6 m off OSM).
    for (let k = 0; k < samples.length; k++) {
      if (match[k]!.track >= 0) continue
      let b = k
      while (b < samples.length && match[b]!.track < 0) b++
      if (k > 0 && b < samples.length) smoothGap(items, (k - 1) * h, b * h, moves, KEEP)
      k = b
    }
    let line: Array<V> = items.map((it) => it.v)
    const ided = line.filter((v) => v.id !== undefined)
    line = line.filter(
      (v) => v.id !== undefined || ided.every((w) => Math.hypot(w.x - v.x, w.y - v.y) >= NEAR_ID),
    )
    line = line.filter(
      (v, i) =>
        i === 0 ||
        Math.hypot(v.x - line[i - 1]!.x, v.y - line[i - 1]!.y) > 0.01 ||
        v.id !== undefined,
    )
    // Ends on the play area's edge stay on it.
    for (const end of [0, 1] as const) {
      const e = edgeOf(end === 0 ? pts[0]! : pts.at(-1)!)
      if (e === undefined) continue
      if (end === 0) line[0] = ontoEdge(line[1]!, line[0]!, e)
      else line[line.length - 1] = ontoEdge(line.at(-2)!, line.at(-1)!, e)
    }
    // Level crossings: each node slides along its road to where the rail now crosses it.
    for (const v of pts)
      if (isCrossing(v.id)) crossings.push(slideCrossing(line, v.id!, roadsAt, osmRoads, moves))
    return { chain, pts, line, samples, match, starts }
  })

  // Bridges keep what they span; streams under at-grade track share a culvert vertex with it. A
  // bridge reaches past the cells under it that the at-grade track cannot take: a wide stream's
  // protected bed (w/2 + 1 m, build-map.ts) and a tertiary road's core (rank 0 beats the rail),
  // plus a cell's diagonal, the farthest a corner of a cell the track runs through lies off it.
  const waterPts = osmWater.map((w) => moved(w.pts, moves))
  const corner = GRID_CELL * Math.SQRT2
  const crossed: Array<Crossed> = [
    ...osmWater.map((w, k) => ({
      what: `water ${w.id}`,
      w: w.w,
      margin: w.w >= 4 ? 1 + corner : 0,
      osm: w.pts,
      pts: waterPts[k]!,
      water: true,
    })),
    ...osmRoads.map((r) => ({
      what: `road ${r.id}`,
      w: r.w,
      margin: r.cls === "tertiary" ? coreHalf(r.w, GRID_CELL) - r.w / 2 + corner : 0,
      osm: r.pts,
      pts: moved(r.pts, moves),
      water: false,
    })),
  ]
  const waterIds = new Set(
    osmWater.flatMap((w) => w.pts.flatMap((v) => (v.id === undefined ? [] : [v.id]))),
  )
  const spanReport: SpanReport = { slid: [], culverts: [], cut: [] }
  // The CTR's bridges, and the track over a drivable road's tunnel by its mouth (the road's profile cuts the mouth then, a path
  // keeps the terrain's), out past the road's core cells and a cell's diagonal.
  const bridges = [
    ...ctr.bridges.map((b) => b.rings),
    ...underpasses(
      chains.map((c) => c.line),
      osmRoads.flatMap((r) =>
        r.tunnel === true && isDrivable(r.cls)
          ? [{ pts: moved(r.pts, moves), half: coreHalf(r.w, GRID_CELL) + corner }]
          : [],
      ),
    ),
  ]
  const bridged = (x: number, y: number) => bridges.some((poly) => inPolygon(x, y, poly))
  for (const { chain, pts, line } of chains) {
    const spans = chain.map(({ item, rev }, i) => ({
      id: item.id,
      bridge: item.bridge === true,
      tunnel: item.tunnel === true,
      ...(i === 0 ? {} : { from: (rev ? item.pts.at(-1)! : item.pts[0]!).id! }),
      ...(i + 1 === chain.length ? {} : { to: (rev ? item.pts[0]! : item.pts.at(-1)!).id! }),
    }))
    const shared = (id: string) => roadsAt.has(id) || waterIds.has(id)
    keepSpans(pts, line, spans, crossed, shared, bridged, spanReport)
    cutAtBridges(line, spans, bridges, (id) => roadsAt.has(id), spanReport)
  }
  // A bridge end slid along the track, and the culverts, are where the lines now have them.
  for (const { line } of chains) for (const v of line) if (v.id !== undefined) moves.set(v.id, v)

  const extra = buildExtras({
    tracks: ctr.tracks,
    lines,
    extra: ctr.tracks.flatMap((_, k) => (used[k] ? [] : [k])),
    hosts: chains.map((c) => c.line),
    bridges: ctr.bridges.map((b) => b.rings),
    away: [...layout.swap.keys()].map((id) => osmAt.get(id)!).filter((v) => !roadsAt.has(v.id!)),
    roads: roadPts,
    osmRoads,
    moves,
  })

  // No short segment is left where a vertex was inserted beside one of the CTR's. The ids another
  // line or piece shares stay (joints, level crossings, culverts, switches); OSM's other vertices
  // only carried its drawing and may go.
  const joints = new Set(
    rail.flatMap((r) => [r.pts[0]!.id, r.pts.at(-1)!.id].filter((id) => id !== undefined)),
  )
  const needed = (v: V) =>
    v.id !== undefined &&
    (joints.has(v.id) || roadsAt.has(v.id) || waterIds.has(v.id) || !/^\d+$/.test(v.id))
  for (const c of chains) c.line = pruneShort(c.line, MIN_SEG, needed)

  // Pieces back out of each chain, between the ids at their joints, in their OSM direction.
  const out: Array<RailF> = []
  const report: Array<Report["pieces"][number]> = []
  const all = { offset: [] as Array<number>, residual: [] as Array<number> }
  for (const { chain, line, samples, match, starts } of chains) {
    const shipped = lineOf(line.map((v) => [r1(v.x), r1(v.y)] as const))
    let from = 0
    chain.forEach(({ item, rev }, i) => {
      const joint = i + 1 < chain.length ? (rev ? item.pts[0]! : item.pts.at(-1)!).id : undefined
      let to = line.length - 1
      if (joint !== undefined) {
        to = line.findIndex((v, j) => j > from && v.id === joint)
        if (to < 0) throw new Error(`rail ${item.id}: joint ${joint} lost`)
      }
      const pts = line.slice(from, to + 1)
      for (const v of item.pts)
        if (needed(v) && !pts.some((w) => w.id === v.id))
          throw new Error(`rail ${item.id}: node ${v.id} lost`)
      // At-grade pieces cut where the CTR maps a bridge: one piece per stretch, bridges flagged.
      const ends = [0]
      pts.forEach((v, j) => {
        if (j > 0 && j + 1 < pts.length && v.id?.startsWith("afe:") === true) ends.push(j)
      })
      ends.push(pts.length - 1)
      const pieces = ends.slice(1).map((b, n): RailF => {
        const part = pts.slice(ends[n], b + 1)
        const { bridge: _, ...rest } = item
        const bridge = item.bridge === true || (item.tunnel !== true && onBridge(part, bridges))
        return { ...rest, ...(bridge ? { bridge: true } : {}), pts: rev ? part.reverse() : part }
      })
      out.push(...(rev ? pieces.reverse() : pieces))
      // Statistics on this piece's matched samples: OSM's offset, and the shipped polyline's residual from the surveyed track.
      const offset: Array<number> = [],
        residual: Array<number> = []
      samples.forEach((p, k) => {
        const m = match[k]!
        if (m.foot === undefined || p.at < starts[i]! || p.at > starts[i + 1]!) return
        const q = footOn(shipped, m.foot.x, m.foot.y)
        offset.push(m.foot.d)
        residual.push(footOn(surveyed[m.track]!, q.x, q.y).d)
      })
      all.offset.push(...offset)
      all.residual.push(...residual)
      report.push({
        id: item.id,
        m: starts[i + 1]! - starts[i]!,
        matched: offset.length * STEP,
        offset: spread(offset),
        residual: spread(residual),
      })
      from = to
    })
  }
  const residual = spread(all.residual)
  if (residual[0] >= RESIDUAL.median || residual[1] >= RESIDUAL.p90 || residual[2] >= RESIDUAL.max)
    throw new Error(
      `rail residuals from the CTR ${residual.map((d) => d.toFixed(2)).join(" / ")} m over the limits`,
    )
  // Tracks meet only at piece ends: the running track is cut at its switches.
  const tracks = [...out, ...extra.pieces]
  const roads = osmRoads.map((r, k) => ({
    ...r,
    pts: roadPts[k]!.map((v) => (v.id === undefined ? v : (moves.get(v.id) ?? v))),
  }))
  checkCrossings(tracks, roads, ctr.crossings)
  return {
    rail: splitAtJunctions(out, tracks),
    extra: splitAtJunctions(extra.pieces, tracks),
    water: osmWater.map((w, k) => ({ ...w, pts: waterPts[k]! })),
    roads,
    moves,
    report: {
      pieces: report,
      residual,
      offset: spread(all.offset),
      crossings,
      extras: extra.report,
      spans: spanReport,
    },
  }
}
