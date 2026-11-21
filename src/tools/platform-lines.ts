// Station platforms OSM draws as lines (open `railway=platform` ways: all of Sarzana's but its
// shelter roof, and Arcola's), as the platforms are cut from areas: each line's band PLATFORM_HALF m
// either side of it, which `buildPlatforms` clips clear of every track, off the roads and to the
// ground like any other platform's outline; but a line OSM draws along a platform it maps as an area
// too (Aulla Lunigiana's), which is that platform.
import { lineVertices } from "./features.ts"
import { arcLengths, flatRing, type P, pointAt, pointInRing, type V } from "./geometry.ts"
import type { Osm } from "./osm.ts"

/**
 * Half the width (m) of a platform OSM draws as a line, its centreline, with no `width` tag: RFI's
 * side platforms are 3–4 m wide and its islands 6–8 m; the tracks' clearance (1.6 m) cuts an island
 * drawn between two tracks to its room between them.
 */
export const PLATFORM_HALF = 3

/** The band `half` m either side of polyline `pts`, its bends mitred (at most twice `half` out), as a counter-clockwise flat ring. */
export const band = (pts: ReadonlyArray<V>, half: number): Array<number> | undefined => {
  if (pts.length < 2) return undefined
  const normal = (a: V, b: V): P => {
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return [-(b.y - a.y) / d, (b.x - a.x) / d]
  }
  const offsets = pts.map((_, k): P => {
    const n0 = normal(pts[Math.max(0, k - 1)]!, pts[Math.max(1, k)]!),
      n1 = normal(pts[Math.min(k, pts.length - 2)]!, pts[Math.min(k + 1, pts.length - 1)]!)
    const mx = n0[0] + n1[0],
      my = n0[1] + n1[1],
      m = Math.hypot(mx, my) || 1
    // The mitre: the bisector, as far out as keeps `half` from both segments.
    const cos = (mx * n0[0] + my * n0[1]) / m,
      reach = Math.min(2 * half, half / Math.max(cos, 1e-9))
    return [(mx / m) * reach, (my / m) * reach]
  })
  return flatRing(
    [
      ...pts.map((v, k): P => [v.x + offsets[k]![0], v.y + offsets[k]![1]]),
      ...pts.map((v, k): P => [v.x - offsets[k]![0], v.y - offsets[k]![1]]).reverse(),
    ],
    true,
  )
}

/** Whether OSM's tags `t` make a station's platform (not a bus stop's: `bus` or `highway` say so), as for its areas (`areaKind`). */
const isPlatform = (t: Readonly<Record<string, string>>): boolean =>
  t.railway === "platform" ||
  (t.public_transport === "platform" && t.bus === undefined && t.highway === undefined)

/**
 * The platforms OSM draws as lines in `osm`: each one's band about it, its `width` tag's half or
 * PLATFORM_HALF either side, but a line whose middle lies in one of the platforms it maps as areas
 * (`areas`, each one's rings, the outer first).
 */
export const platformLines = (
  osm: Osm,
  areas: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>,
): Array<ReadonlyArray<ReadonlyArray<number>>> =>
  [...osm.ways.values()].flatMap((w) => {
    if (w.nds.length < 2 || w.nds[0] === w.nds.at(-1) || !isPlatform(w.tags)) return []
    const pts = lineVertices(osm, w.nds),
      s = arcLengths(pts),
      mid = pointAt(pts, s, s.at(-1)! / 2)
    if (areas.some(([outer]) => pointInRing(mid.x, mid.y, outer!))) return []
    const width = Number.parseFloat(w.tags.width ?? "")
    const ring = band(pts, width > 0 ? width / 2 : PLATFORM_HALF)
    return ring === undefined ? [] : [[ring]]
  })
