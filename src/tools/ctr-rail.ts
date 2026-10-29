// Regione Toscana CTR 1:2000 rail layers (data/raw/rt/ctr) in local metres, clipped to the play
// area: the railway track centrelines (VLI 0117) chained into tracks and cut at the tunnels, the
// ballast bed's bridge and tunnel spans (AFE 0140), the station platforms (AGE 0141) and the
// level-crossing areas (AGE 0122). `fetch-rt.ts ctr` writes the VLI and AFE files; AGE is the
// file `ctr.ts` reads garages and ruins from.
import { ctrRecords, local, polygonsOf, type CtrRecord } from "./ctr.ts"
import { clipLine, pointInRing, type P, type V } from "./geometry.ts"

/** A polygon as flat rings: the outer one counter-clockwise first, then its holes clockwise. */
export type Polygon = ReadonlyArray<ReadonlyArray<number>>

/** A polygon of one CTR record; `src` names it `<sheet> <layer>#<record>` (records from 0, in file order). */
export interface CtrArea {
  readonly src: string
  readonly rings: Polygon
}

/** A track centreline as the CTR draws it, in local metres; `src` names it `<sheet> VLI#<record>.<part>`. */
export interface CtrLine {
  readonly src: string
  readonly pts: ReadonlyArray<P>
}

/** CTR track lines chained end to end, in local metres; `src` lists the lines in order along `pts`. */
export interface CtrTrack {
  readonly src: ReadonlyArray<string>
  readonly pts: ReadonlyArray<P>
}

/** What `readCtrRail` reads. */
export interface CtrRail {
  /** The track centrelines (VLI 0117), chained, cut at the tunnels and clipped to the play area. */
  readonly tracks: ReadonlyArray<CtrTrack>
  /** Ballast bed on bridges (AFE 0140, Sede 063; all 26 such polygons are at Livello 102). */
  readonly bridges: ReadonlyArray<CtrArea>
  /** Ballast bed in tunnels (AFE 0140, Sede 054); no track line is surveyed inside. */
  readonly tunnels: ReadonlyArray<CtrArea>
  /** Station platforms (AGE 0141). */
  readonly platforms: ReadonlyArray<CtrArea>
  /** Level-crossing areas (AGE 0122); the AFE's Sede 061 polygons are the same four boxes. */
  readonly crossings: ReadonlyArray<CtrArea>
}

/**
 * Two line ends this close (m), heading on within this angle (degrees), join. The sheet edges
 * (y 3150 at Gragnola, x 830 by the Onda tunnel) match exactly; the Monzone siding's 23D36 and
 * 23D35 ends lie 0.465 m apart. Turnouts diverge at about 5°, but switches are not drawn: a
 * diverging track ends beside the through track's middle, never at one of its ends.
 */
const JOIN = { gap: 1, angle: 10 }
/** An end's heading is taken to the first vertex at least this far back (m), past a sheet edge's short cut segment. */
const HEADING_SPAN = 5
/** Pieces shorter than this (m) after the tunnel cut and the clip are dropped. */
const MIN_LENGTH = 1

const lengthOf = (pts: ReadonlyArray<P>): number => {
  let s = 0
  for (let i = 1; i < pts.length; i++)
    s += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])
  return s
}

/** Whether (x, y) lies inside the polygon: in its outer ring and in none of its holes. */
export const inPolygon = (x: number, y: number, [outer, ...holes]: Polygon): boolean =>
  pointInRing(x, y, outer!) && !holes.some((h) => pointInRing(x, y, h))

/** Parameters t in (0, 1) where segment a-b crosses an edge of `ring`. */
const ringCuts = (a: V, b: V, ring: ReadonlyArray<number>, out: Array<number>): void => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    n = ring.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const cx = ring[2 * j]!,
      cy = ring[2 * j + 1]!,
      ex = ring[2 * i]! - cx,
      ey = ring[2 * i + 1]! - cy
    const den = dx * ey - dy * ex
    if (den === 0) continue
    const t = ((cx - a.x) * ey - (cy - a.y) * ex) / den,
      u = ((cx - a.x) * dy - (cy - a.y) * dx) / den
    if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push(t)
  }
}

/**
 * A line split where it crosses the rings of `polygons` into runs inside and outside them (each
 * stretch between two cuts goes by its midpoint). Vertices keep their ids; cut points have none.
 */
export const splitIn = (
  pts: ReadonlyArray<V>,
  polygons: ReadonlyArray<Polygon>,
): Array<{ readonly inside: boolean; readonly pts: Array<V> }> => {
  const runs: Array<{ inside: boolean; pts: Array<V> }> = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!,
      b = pts[i]!,
      ts = [0, 1]
    for (const poly of polygons) for (const ring of poly) ringCuts(a, b, ring, ts)
    ts.sort((p, q) => p - q)
    for (let k = 1; k < ts.length; k++) {
      if (ts[k] === ts[k - 1]) continue
      const at = (t: number): V =>
        t === 0 ? a : t === 1 ? b : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      const mid = at((ts[k - 1]! + ts[k]!) / 2)
      const inside = polygons.some((poly) => inPolygon(mid.x, mid.y, poly))
      const last = runs.at(-1)
      if (last?.inside === inside) last.pts.push(at(ts[k]!))
      else runs.push({ inside, pts: [last?.pts.at(-1) ?? at(ts[k - 1]!), at(ts[k]!)] })
    }
  }
  return runs
}

/** The runs of a line outside every polygon. */
const cutOut = (pts: ReadonlyArray<P>, polygons: ReadonlyArray<Polygon>): Array<Array<P>> =>
  splitIn(
    pts.map(([x, y]) => ({ x, y })),
    polygons,
  )
    .filter((run) => !run.inside)
    .map((run) => run.pts.map((v): P => [v.x, v.y]))

/** Unit vector pointing out of the line at its start (`end` false) or its end. */
const outward = (pts: ReadonlyArray<P>, end: boolean): P => {
  const at = (i: number) => pts[end ? pts.length - 1 - i : i]!
  const tip = at(0)
  let back = at(pts.length - 1)
  for (let i = 1; i < pts.length; i++)
    if (Math.hypot(at(i)[0] - tip[0], at(i)[1] - tip[1]) >= HEADING_SPAN) {
      back = at(i)
      break
    }
  const dx = tip[0] - back[0],
    dy = tip[1] - back[1],
    d = Math.hypot(dx, dy)
  return [dx / d, dy / d]
}

/**
 * Chains track lines into tracks: two ends within JOIN.gap whose headings run on within
 * JOIN.angle join, nearest pairs first (ties by line order), each end once, never into a loop;
 * a joint off by a gap becomes the two ends' midpoint. Each track runs the way its first line in
 * `lines` order runs; tracks come in that order too. Lines are cut out of `tunnels` and clipped to
 * the play area first, and pieces under MIN_LENGTH dropped.
 */
export const chainTracks = (
  lines: ReadonlyArray<CtrLine>,
  tunnels: ReadonlyArray<Polygon>,
): Array<CtrTrack> => {
  const pieces = lines.flatMap(({ src, pts }) =>
    cutOut(pts, tunnels)
      .flatMap((run) => clipLine(run.map(([x, y]) => ({ x, y }))))
      .map((clipped) => ({ src, pts: clipped.map((v): P => [v.x, v.y]) }))
      .filter((p) => lengthOf(p.pts) >= MIN_LENGTH),
  )
  // End e = 2 * piece + (0 start, 1 end).
  const tip = (e: number): P => {
    const pts = pieces[e >> 1]!.pts
    return e & 1 ? pts.at(-1)! : pts[0]!
  }
  const heading = pieces.flatMap((p) => [outward(p.pts, false), outward(p.pts, true)])
  const cosMax = -Math.cos((JOIN.angle * Math.PI) / 180)
  const pairs: Array<{ a: number; b: number; d: number }> = []
  for (let a = 0; a < heading.length; a++)
    for (let b = a + 2 - (a & 1); b < heading.length; b++) {
      const d = Math.hypot(tip(a)[0] - tip(b)[0], tip(a)[1] - tip(b)[1])
      const dot = heading[a]![0] * heading[b]![0] + heading[a]![1] * heading[b]![1]
      if (d <= JOIN.gap && dot <= cosMax) pairs.push({ a, b, d })
    }
  pairs.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b)
  const link = Array.from({ length: heading.length }, () => -1)
  const root = pieces.map((_, i) => i)
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)))
  for (const { a, b } of pairs) {
    if (link[a]! >= 0 || link[b]! >= 0 || find(a >> 1) === find(b >> 1)) continue
    link[a] = b
    link[b] = a
    root[find(a >> 1)] = find(b >> 1)
  }
  const done = pieces.map(() => false)
  const tracks: Array<CtrTrack> = []
  for (let first = 0; first < pieces.length; first++) {
    if (done[first]) continue
    done[first] = true
    const pts = [...pieces[first]!.pts],
      src = [pieces[first]!.src]
    // Forward from the first piece's end, then backward from its start.
    for (const ahead of [true, false]) {
      for (let e = link[2 * first + (ahead ? 1 : 0)]!; e >= 0;) {
        const i = e >> 1
        done[i] = true
        // The piece's points from the end the walk enters it at.
        const next = (e & 1) === 0 ? [...pieces[i]!.pts] : [...pieces[i]!.pts].reverse()
        const joint = ahead ? pts.length - 1 : 0,
          meet = next[0]!
        const [jx, jy] = pts[joint]!
        if (jx !== meet[0] || jy !== meet[1]) pts[joint] = [(jx + meet[0]) / 2, (jy + meet[1]) / 2]
        if (ahead) {
          pts.push(...next.slice(1))
          src.push(pieces[i]!.src)
        } else {
          pts.unshift(...next.slice(1).reverse())
          src.unshift(pieces[i]!.src)
        }
        e = link[e ^ 1]!
      }
    }
    tracks.push({ src, pts })
  }
  return tracks
}

/** Every polygon of the records `keep` accepts, labelled `<sheet> <layer>#<record>`. */
const areas = (
  records: ReadonlyArray<CtrRecord>,
  layer: string,
  keep: (attrs: Readonly<Record<string, string>>) => boolean,
): Array<CtrArea> =>
  records
    .filter(({ rec }) => keep(rec.attrs))
    .flatMap(({ sheet, index, rec }) =>
      polygonsOf(rec).map((rings) => ({ src: `${sheet} ${layer}#${index}`, rings })),
    )

/** The CTR's rail layers from `dir`: tracks, bridge and tunnel spans, platforms and level crossings. */
export const readCtrRail = (dir: string): CtrRail => {
  const afe = ctrRecords(dir, "AFE"),
    age = ctrRecords(dir, "AGE")
  const tunnels = areas(afe, "AFE", (a) => a.Cod_CTR === "0140" && a.Sede === "054")
  const lines = ctrRecords(dir, "VLI")
    .filter(({ rec }) => rec.attrs.Cod_CTR === "0117")
    .flatMap(({ sheet, index, rec }) =>
      rec.parts.map((part, k) => ({ src: `${sheet} VLI#${index}.${k}`, pts: part.map(local) })),
    )
  return {
    tracks: chainTracks(
      lines,
      tunnels.map((t) => t.rings),
    ),
    bridges: areas(afe, "AFE", (a) => a.Cod_CTR === "0140" && a.Sede === "063"),
    tunnels,
    platforms: areas(age, "AGE", (a) => a.Cod_CTR === "0141"),
    crossings: areas(age, "AGE", (a) => a.Cod_CTR === "0122"),
  }
}
