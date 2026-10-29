// The tracks only the CTR has, drawn beside the running line and driven by no train: Gragnola's
// loop and stub, Monzone's old yard siding, Equi Terme's disused second track and yard sidings. A
// track whose end lies on another track is joined to it by a switch vertex both share; bridges come
// from the CTR's ballast-on-bridge polygons; where a track crosses a road at grade, the two share a
// vertex, as OSM's level crossings do.
import { splitIn, type CtrTrack, type Polygon } from "./ctr-rail.ts"
import type { RailF, RoadF } from "./features.ts"
import { arcLengths, segDist2, type V } from "./geometry.ts"
import { hitsOn, insertOn, MIN_SEG, pruneShort, type Line } from "./rail-match.ts"

/** An end this close (m) to another track, heading along it within SWITCH.angle degrees, is a switch onto it. */
const SWITCH = { gap: 1, angle: 20 }
/** An end's heading is taken this far back along the track, m. */
const HEADING_SPAN = 5
/** Bridge or at-grade stretches shorter than this (m) after the split join their neighbour. */
const MIN_PIECE = 1
/** Re-homed OSM nodes go to an extra track within this distance, m. */
const REHOME = 8
/**
 * A road's own vertex (not its end, on no other rail) this close (m) to where an extra track
 * crosses it becomes the crossing (Gragnola's track-1 node, 0.47 m off the CTR track; the line's
 * crossing nodes move up to 2.9 m); farther, the road gets a new vertex there.
 */
const REUSE = 3

/** What `buildExtras` did to each track, for the build's summary. */
export type Report = ReadonlyArray<{
  readonly id: number
  readonly src: string
  readonly m: number
  readonly bridge: number
  /** Per end: "line" (a switch onto a running track), "track" (onto another extra track) or "free". */
  readonly ends: readonly [string, string]
  /** Level crossings: the road and the shared vertex id. */
  readonly crossings: ReadonlyArray<string>
}>

interface Input {
  readonly tracks: ReadonlyArray<CtrTrack>
  /** The tracks simplified (indexed like `tracks`). */
  readonly lines: ReadonlyArray<Line>
  /** Indices of the tracks to draw: those no OSM track matched. */
  readonly extra: ReadonlyArray<number>
  /** The running lines (on the CTR); switch vertices are inserted into them. */
  readonly hosts: ReadonlyArray<Array<V>>
  /** Ballast-on-bridge polygons (AFE 0140, Sede 063). */
  readonly bridges: ReadonlyArray<Polygon>
  /** OSM nodes that belong on an extra track: each goes to the foot on the nearest one. */
  readonly away: ReadonlyArray<V>
  /** Road polylines (indexed like `osmRoads`); level crossings with the extra tracks are added. */
  readonly roads: Array<Array<V>>
  readonly osmRoads: ReadonlyArray<RoadF>
  /** Every id the running rail has, and every new position. */
  readonly moves: Map<string, V>
}

/** Nearest point of a V polyline: distance, segment and the unit tangent there. */
const nearest = (pts: ReadonlyArray<V>, x: number, y: number) => {
  let best = { d2: Number.MAX_VALUE, i: 0, t: 0 }
  for (let i = 0; i + 1 < pts.length; i++) {
    const { d2, t } = segDist2(x, y, pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y)
    if (d2 < best.d2) best = { d2, i, t }
  }
  const a = pts[best.i]!,
    b = pts[best.i + 1]!,
    len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return {
    d: Math.sqrt(best.d2),
    x: a.x + (b.x - a.x) * best.t,
    y: a.y + (b.y - a.y) * best.t,
    tx: (b.x - a.x) / len,
    ty: (b.y - a.y) / len,
  }
}

/** Unit vector out of the track at its start (`end` 0) or its end (1). */
const outward = (pts: ReadonlyArray<V>, end: 0 | 1) => {
  const at = (i: number) => pts[end === 1 ? pts.length - 1 - i : i]!
  let back = at(pts.length - 1)
  for (let i = 1; i < pts.length; i++)
    if (Math.hypot(at(i).x - at(0).x, at(i).y - at(0).y) >= HEADING_SPAN) {
      back = at(i)
      break
    }
  const d = Math.hypot(at(0).x - back.x, at(0).y - back.y) || 1
  return { x: (at(0).x - back.x) / d, y: (at(0).y - back.y) / d }
}

/**
 * "23D11 VLI#2.0" → −1190020: negative like the CTR buildings' ids (ctr.ts), from the sheet,
 * record and part of the track's first line, so no two tracks share one; the pieces a track is cut
 * into (at bridges and switches) share it.
 */
const idOf = (src: string): number => {
  const [, sheet, record, part] = /^\d\dD(\d+) VLI#(\d+)\.(\d+)$/.exec(src)!
  return -(Number(sheet) * 1e5 + 9e4 + Number(record) * 10 + Number(part))
}

/** The extra tracks as rail pieces, joined, bridged and crossed as the module header says. */
export const buildExtras = (input: Input): { pieces: Array<RailF>; report: Report } => {
  const { tracks, lines, hosts, roads, osmRoads, moves } = input
  const extras = input.extra.map((k) => ({
    k,
    src: tracks[k]!.src,
    pts: lines[k]!.pts.map(([x, y]): V => ({ x, y })),
    ends: ["free", "free"] as [string, string],
  }))
  // Switches: an end beside another track joins it at its foot there.
  for (const e of extras)
    for (const end of [0, 1] as const) {
      const tip = e.pts[end === 0 ? 0 : e.pts.length - 1]!,
        out = outward(e.pts, end)
      let best:
        | { host: Array<V>; on: "line" | "track"; x: number; y: number; d: number }
        | undefined
      for (const [on, list] of [
        ["line", hosts],
        ["track", extras.filter((o) => o !== e).map((o) => o.pts)],
      ] as const)
        for (const host of list) {
          const f = nearest(host, tip.x, tip.y)
          const along = Math.abs(f.tx * out.x + f.ty * out.y)
          const fits = f.d <= SWITCH.gap && along >= Math.cos((SWITCH.angle * Math.PI) / 180)
          if (fits && (best === undefined || f.d < best.d))
            best = { host, on, x: f.x, y: f.y, d: f.d }
        }
      if (best === undefined) continue
      const sw: V = {
        x: best.x,
        y: best.y,
        id: `ctr:${end === 0 ? e.src[0] : e.src.at(-1)}:${end}`,
      }
      insertOn(best.host, sw)
      e.pts[end === 0 ? 0 : e.pts.length - 1] = sw
      moves.set(sw.id!, sw)
      e.ends[end] = best.on
    }
  // OSM nodes re-homed onto an extra track (Gragnola's track-1 stop).
  for (const v of input.away) {
    let best: { e: (typeof extras)[number]; x: number; y: number; d: number } | undefined
    for (const e of extras) {
      const f = nearest(e.pts, v.x, v.y)
      if (f.d <= REHOME && (best === undefined || f.d < best.d))
        best = { e, x: f.x, y: f.y, d: f.d }
    }
    if (best === undefined) throw new Error(`node ${v.id}: no extra track within ${REHOME} m`)
    const at: V = { x: best.x, y: best.y, id: v.id! }
    insertOn(best.e.pts, at)
    moves.set(v.id!, at)
  }
  const pieces: Array<RailF> = []
  const report: Array<Report[number]> = []
  const railIds = new Set(moves.keys())
  for (const e of extras) {
    const id = idOf(e.src[0]!)
    // Bridges from the AFE polygons; stretches under MIN_PIECE join the one before (or after).
    const runs: Array<{ inside: boolean; pts: Array<V> }> = []
    for (const run of splitIn(e.pts, input.bridges)) {
      const last = runs.at(-1)
      const short = arcLengths(run.pts).at(-1)! < MIN_PIECE
      if (last !== undefined && (short || last.inside === run.inside))
        last.pts.push(...run.pts.slice(1))
      else runs.push({ ...run })
    }
    if (runs.length > 1 && arcLengths(runs[0]!.pts).at(-1)! < MIN_PIECE) {
      runs[1]!.pts.unshift(...runs[0]!.pts.slice(0, -1))
      runs.shift()
    }
    const crossed: Array<string> = []
    let made = 0
    for (const run of runs) {
      if (!run.inside)
        osmRoads.forEach((road, r) => {
          if (road.bridge === true || road.tunnel === true) return
          for (let m = 0; m + 1 < run.pts.length; m++) {
            for (const hit of hitsOn(roads[r]!, run.pts[m]!, run.pts[m + 1]!)) {
              const rp = roads[r]!
              const a = rp[hit.i]!,
                b = rp[hit.i + 1]!
              const at = (v: V) => Math.hypot(v.x - hit.x, v.y - hit.y)
              if (
                [a, b].some(
                  (v) => v.id !== undefined && at(v) < 1e-6 && run.pts.some((w) => w.id === v.id),
                )
              )
                continue
              const near = at(a) <= at(b) ? a : b
              const mid = near !== rp[0] && near !== rp.at(-1)
              const half = Math.hypot(b.x - a.x, b.y - a.y) / 2
              let vid: string
              if (
                near.id !== undefined &&
                !railIds.has(near.id) &&
                mid &&
                at(near) < Math.min(REUSE, half)
              ) {
                vid = near.id
                for (const list of roads)
                  list.forEach((v, j) => {
                    if (v.id === vid) list[j] = { x: hit.x, y: hit.y, id: vid }
                  })
              } else {
                vid = `ctr:${e.src[0]}:x${made++}`
                rp.splice(hit.i + 1, 0, { x: hit.x, y: hit.y, id: vid })
              }
              railIds.add(vid)
              const v: V = { x: hit.x, y: hit.y, id: vid }
              run.pts.splice(m + 1, 0, v)
              moves.set(vid, v)
              crossed.push(`${road.id} ${vid}`)
              m++
              break
            }
          }
        })
      pieces.push({
        id,
        ...(run.inside ? { bridge: true } : {}),
        pts: pruneShort(run.pts, MIN_SEG),
      })
    }
    report.push({
      id,
      src: e.src.join(" + "),
      m: arcLengths(e.pts).at(-1)!,
      bridge: runs.filter((r) => r.inside).reduce((sum, r) => sum + arcLengths(r.pts).at(-1)!, 0),
      ends: e.ends,
      crossings: crossed,
    })
  }
  return { pieces, report }
}
