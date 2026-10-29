// The build's report on the rail: each running piece's fit to the CTR, the tracks only the CTR has,
// the platforms, and the rail's part of the summary (the conflation, the rail bed, the lines,
// stations, level crossings and the verges pulled in off the track).
import type { LevelCrossing, Station } from "../sim/map/index.ts"
import type { Report } from "./conflate.ts"
import type { PlatformOut } from "./platforms.ts"
import type { ClearReport } from "./rail-clear.ts"
import type { LineOut } from "./rail-graph.ts"

const spreadOf = (v: ReadonlyArray<number>) => v.map((d) => d.toFixed(2)).join("/")

/** One line per running piece (length, metres matched to the CTR, OSM's offset and the shipped residual, median / p90 / max), per CTR-only track and per platform. */
export const printRail = (report: Report, platforms: ReadonlyArray<PlatformOut>): void => {
  for (const p of report.pieces)
    console.log(
      `rail ${String(p.id).padStart(10)} ${p.m.toFixed(0).padStart(5)} m, ${String(p.matched).padStart(4)} m on the CTR, offset ${spreadOf(p.offset)}, residual ${spreadOf(p.residual)}`,
    )
  for (const e of report.extras)
    console.log(
      `ctr ${e.id} ${e.m.toFixed(1)} m (${e.bridge.toFixed(1)} on bridges), ends ${e.ends.join("/")}: ${e.src}${e.crossings.length > 0 ? `, crosses ${e.crossings.join(", ")}` : ""}`,
    )
  for (const p of platforms)
    console.log(
      `${p.walkway ? "walkway" : "platform"} ${p.src} ${p.name ?? "-"}: ${p.area.toFixed(0)} m², ${p.width.toFixed(2)} m wide, ${(100 * p.between).toFixed(0)}% between tracks, ${p.clear.toFixed(2)} m from a track`,
    )
}

/** What the summary says of the rail. */
interface RailSummary {
  readonly report: Report
  readonly running: number
  readonly extra: number
  readonly bed: {
    readonly nodes: number
    readonly deepest: number
    readonly raised: number
    readonly fill: number
  }
  readonly lines: ReadonlyArray<LineOut>
  readonly stations: ReadonlyArray<Station>
  readonly crossings: ReadonlyArray<LevelCrossing>
  readonly verges: ClearReport
  /** Road names (or ids) by road index. */
  readonly roadName: (road: number) => string
  readonly roadId: (road: number) => number
}

/**
 * The summary's rail parts: on the CTR (running pieces and CTR-only tracks, OSM's offset from the CTR
 * and the shipped residual, median / p90 / max m, the level crossings' slide along their roads, the
 * bridge ends slid to keep what they span, the culverts, the at-grade track cut into the CTR's
 * bridges and the rail bed's lowered and raised terrain), and the
 * railway (lines: pieces and length; stations: s0–s1 along the line and side; level-crossing boxes:
 * road, nodes and s; roads whose verge was pulled in off the running track: nearest sample before).
 */
export const railSummary = (r: RailSummary) => ({
  railOnCtr: {
    running: r.running,
    extra: r.extra,
    extraM: Math.round(r.report.extras.reduce((sum, e) => sum + e.m, 0)),
    offset: r.report.offset.map((d) => +d.toFixed(2)),
    residual: r.report.residual.map((d) => +d.toFixed(2)),
    crossings: r.report.crossings.map((c) => `${c.id} ${c.shift.toFixed(2)} m`),
    slid: r.report.spans.slid.map((x) => `${x.bridge} ${x.end} ${x.by.toFixed(2)} m`),
    culverts: r.report.spans.culverts.length,
    cut: r.report.spans.cut.map((x) => `${x.piece} ${x.m.toFixed(1)} m`),
    bed: {
      nodes: r.bed.nodes,
      deepest: +r.bed.deepest.toFixed(2),
      raised: r.bed.raised,
      fill: +r.bed.fill.toFixed(2),
    },
  },
  railway: {
    lines: r.lines.map((l) => `${l.pieces.length} pieces, ${l.length.toFixed(1)} m`),
    stations: r.stations.map((st) => `${st.name} ${st.s0}–${st.s1} side ${st.side}`),
    crossings: r.crossings.map((c) => `${r.roadName(c.road)} ×${c.nodes.length} s ${c.s}`),
    verges: r.verges.verges.map(
      (v) => `${r.roadId(v.road)} ${v.before.toFixed(2)} m, verge ${v.verge}`,
    ),
  },
})
