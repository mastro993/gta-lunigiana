// Level crossings through the conflation: a crossing node slides along its road to where the moved
// rail crosses it, and every crossing ends up inside the CTR's level-crossing polygon (AGE 0122)
// where the sheets map one.
import { inPolygon, type CtrArea } from "./ctr-rail.ts"
import type { RailF, RoadF } from "./features.ts"
import { crossings, segDist2, type V } from "./geometry.ts"
import { hitsOn, insertOn } from "./rail-match.ts"

/** A crossing node's new place: its id, the OSM road it is on, how far it slid along it (m), where it is. */
export interface Slid {
  readonly id: string
  readonly road: number
  readonly shift: number
  readonly x: number
  readonly y: number
}

/** A level-crossing node this close (m) to a CTR level-crossing polygon must lie inside it. */
const CROSSING_NEAR = 10

/**
 * Puts crossing node `id` into the moved rail `line` where it crosses the node's road (`roadsAt`:
 * each road and vertex index holding it), recording it in `moves`; a road that only ends on the rail
 * keeps ending on it, where it is nearest. Throws when the rail no longer crosses a road it runs
 * through, or when the node would slide half its road segment or more.
 */
export const slideCrossing = (
  line: Array<V>,
  id: string,
  roadsAt: ReadonlyMap<string, ReadonlyArray<{ readonly road: number; readonly i: number }>>,
  roads: ReadonlyArray<RoadF>,
  moves: Map<string, V>,
): Slid => {
  let best: { x: number; y: number; road: number; shift: number; half: number } | undefined
  for (const { road, i } of roadsAt.get(id)!) {
    const rp = roads[road]!.pts
    for (const j of [i - 1, i]) {
      if (j < 0 || j + 1 >= rp.length) continue
      for (const hit of hitsOn(line, rp[j]!, rp[j + 1]!)) {
        const shift = Math.hypot(hit.x - rp[i]!.x, hit.y - rp[i]!.y)
        if (best === undefined || shift < best.shift)
          best = {
            x: hit.x,
            y: hit.y,
            road,
            shift,
            half: Math.hypot(rp[j + 1]!.x - rp[j]!.x, rp[j + 1]!.y - rp[j]!.y) / 2,
          }
      }
    }
  }
  // A road that only ends on the rail (its node each road's first or last) follows it, to where the
  // moved rail is nearest: the CTR may have moved the rail short of its last segment (driveway
  // 1455968336 at Santo Stefano di Magra, which ends on the Pontremolese).
  const holders = roadsAt.get(id)!
  if (
    best === undefined &&
    holders.every(({ road, i }) => i === 0 || i === roads[road]!.pts.length - 1)
  )
    for (const { road, i } of holders) {
      const rp = roads[road]!.pts,
        next = rp[i === 0 ? 1 : i - 1]!
      let near: { x: number; y: number; d2: number } | undefined
      for (let k = 0; k + 1 < line.length; k++) {
        const { d2, t } = segDist2(
          rp[i]!.x,
          rp[i]!.y,
          line[k]!.x,
          line[k]!.y,
          line[k + 1]!.x,
          line[k + 1]!.y,
        )
        if (near === undefined || d2 < near.d2)
          near = {
            x: line[k]!.x + t * (line[k + 1]!.x - line[k]!.x),
            y: line[k]!.y + t * (line[k + 1]!.y - line[k]!.y),
            d2,
          }
      }
      const shift = Math.sqrt(near!.d2),
        half = Math.hypot(next.x - rp[i]!.x, next.y - rp[i]!.y) / 2
      if (best === undefined || shift < best.shift)
        best = { x: near!.x, y: near!.y, road, shift, half }
    }
  if (best === undefined)
    throw new Error(`level crossing ${id}: the rail no longer crosses its road`)
  if (best.shift >= best.half)
    throw new Error(
      `level crossing ${id}: shifts ${best.shift.toFixed(2)} m along road ${roads[best.road]!.id}, half its segment is ${best.half.toFixed(2)} m`,
    )
  const at = { x: best.x, y: best.y, id }
  insertOn(line, at)
  moves.set(id, at)
  return { id, road: roads[best.road]!.id, shift: best.shift, x: at.x, y: at.y }
}

/**
 * Throws unless every CTR level-crossing polygon holds a level-crossing node (a vertex a road and a
 * track share) and every node near one lies inside it.
 */
export const checkCrossings = (
  rail: ReadonlyArray<RailF>,
  roads: ReadonlyArray<RoadF>,
  polygons: ReadonlyArray<CtrArea>,
): void => {
  const railIds = new Set(
    rail.flatMap((r) => r.pts.flatMap((v) => (v.id === undefined ? [] : [v.id]))),
  )
  const nodes = roads.flatMap((r) => r.pts.filter((v) => v.id !== undefined && railIds.has(v.id)))
  const gap = (v: V, rings: CtrArea["rings"]) => {
    if (inPolygon(v.x, v.y, rings)) return 0
    let d2 = Number.MAX_VALUE
    for (const ring of rings)
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2)
        d2 = Math.min(d2, segDist2(v.x, v.y, ring[j]!, ring[j + 1]!, ring[i]!, ring[i + 1]!).d2)
    return Math.sqrt(d2)
  }
  for (const c of polygons)
    if (!nodes.some((v) => gap(v, c.rings) === 0))
      throw new Error(`CTR level crossing ${c.src} holds no level-crossing node`)
  for (const v of nodes)
    for (const c of polygons) {
      const d = gap(v, c.rings)
      if (d > 0 && d < CROSSING_NEAR)
        throw new Error(`level crossing ${v.id} lies ${d.toFixed(2)} m outside CTR ${c.src}`)
    }
}

/**
 * The roads, each one OSM lays on a lower layer than at-grade track it crosses with no node in common
 * now in a tunnel: it runs under the track, though OSM tags no tunnel (the farm track 205932314, 17.7
 * m at layer −1 under the Genova–Pisa's bank by Sarzana, crossed both its tracks at grade between
 * their vertices). The tunnel is then the track's underpass as any other (`underpasses` in
 * rail-spans.ts, `railLevels`).
 */
export const underRail = (
  roads: ReadonlyArray<RoadF>,
  rail: ReadonlyArray<RailF>,
): Array<RoadF> => {
  const track = rail.filter((r) => r.bridge !== true && r.tunnel !== true)
  return roads.map((r) => {
    if (r.bridge === true || r.tunnel === true) return r
    const ids = new Set(r.pts.flatMap((v) => (v.id === undefined ? [] : [v.id])))
    const under = track.some(
      (t) =>
        (r.layer ?? 0) < (t.layer ?? 0) &&
        crossings(t.pts, r.pts).some(
          (c) =>
            !t.pts.some(
              (v) => v.id !== undefined && ids.has(v.id) && Math.hypot(v.x - c.x, v.y - c.y) < 0.1,
            ),
        ),
    )
    return under ? { ...r, tunnel: true } : r
  })
}
