// The sea (issue #13) from OpenStreetMap's coastline, its `natural=coastline` ways, whose land lies
// on their left and the sea on their right (OSM's rule): the ways chained into lines in local metres
// (`coastLines`), the lines closed over each box the caller names into the sea's areas at 0 m
// (`seaAreas`), and a bucketed index of their segments for the distance from the coastline and the
// side of it a point lies on (`coastIndex`). It takes its boxes and its projection as arguments, so
// `fetch-rt`'s terrain chain (`sea-fill.ts`) and the build share it. Only + − × ÷ and sqrt, so every
// architecture builds the same sea (`map-key.test.ts`).
import type { Area } from "../sim/map/index.ts"
import { flatRing, type P, pointInRing, segDist2, signedArea, toLocal } from "./geometry.ts"
import type { Osm, OsmWay } from "./osm.ts"
import { clipLineTo } from "./play-area.ts"
import { type Rect, rectRing } from "./region.ts"

/**
 * A line of the coastline in local metres, in OSM's direction (the land on its left): an open
 * chain, or a closed ring (an islet, the land inside it) whose first point is repeated last.
 */
export interface CoastLine {
  readonly pts: ReadonlyArray<P>
  readonly closed: boolean
}

/**
 * The coastline of `osm` as lines: its `natural=coastline` ways, in id order, each joined to the way
 * that starts at the node it ends at, its points through `local` (lat, lon → local metres), a point
 * repeated at once dropped. Throws where two ways start or two end at one node (the coastline
 * branches) or a way's node is missing.
 */
export const coastLines = (
  osm: Osm,
  local: (lat: number, lon: number) => P = toLocal,
): Array<CoastLine> => {
  const ways = [...osm.ways.values()]
    .filter((w) => w.tags.natural === "coastline" && w.nds.length > 1)
    .sort((a, b) => Number(a.id) - Number(b.id))
  const starting = new Map<string, OsmWay>(),
    ending = new Set<string>()
  for (const w of ways) {
    const first = w.nds[0]!,
      last = w.nds.at(-1)!
    if (starting.has(first) || ending.has(last))
      throw new Error(`the coastline branches at way ${w.id}: two ways start or end at one node`)
    starting.set(first, w)
    ending.add(last)
  }
  const used = new Set<string>()
  /** The nodes of the line from `w` on, each way it takes marked used. */
  const follow = (w: OsmWay): Array<string> => {
    const nds = [...w.nds]
    used.add(w.id)
    for (
      let next = starting.get(nds.at(-1)!);
      next !== undefined && !used.has(next.id);
      next = starting.get(nds.at(-1)!)
    ) {
      used.add(next.id)
      nds.push(...next.nds.slice(1))
    }
    return nds
  }
  const line = (nds: ReadonlyArray<string>): CoastLine => {
    const pts: Array<P> = []
    for (const id of nds) {
      const n = osm.nodes.get(id)
      if (n === undefined) throw new Error(`coastline node ${id} missing from the extract`)
      const p = local(n.lat, n.lon),
        last = pts.at(-1)
      if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) pts.push(p)
    }
    return { pts, closed: nds[0] === nds.at(-1) }
  }
  // The chains first, from each way no other leads into; every way left lies on a ring.
  const chains = ways.filter((w) => !ending.has(w.nds[0]!)).map((w) => line(follow(w)))
  const rings = ways.flatMap((w) => (used.has(w.id) ? [] : [line(follow(w))]))
  return [...chains, ...rings]
}

/** Within this distance (m) of a box's edge a piece's end lies on it: the clip cuts on the edge to within rounding. */
const ON_EDGE = 1e-6

/**
 * The sea within each of `boxes` as areas at level 0, one per connected piece of sea in a box, its
 * outer ring counter-clockwise and the islets in it clockwise holes, on 0.1 m (`flatRing`). The
 * lines are clipped to the box; from where a piece leaves it the ring runs along the box's edge
 * clockwise (the sea's side, on the piece's right) to where the next piece enters, corners and all,
 * and on along that piece, until it closes. A ring of the coastline inside the box is an islet, a
 * hole in the sea round it, or, drawn clockwise, sea inside land. A box no line crosses is sea but
 * for its islets when its corner lies on the sea's side of the nearest coastline (`seaward`), and
 * land otherwise. Throws where a line ends inside a box (an extract that cuts the coastline short)
 * or two lines disagree on the sea's side along its edge.
 */
export const seaAreas = (
  lines: ReadonlyArray<CoastLine>,
  boxes: ReadonlyArray<Rect>,
  index: CoastIndex = coastIndex(lines),
): Array<Area> => {
  if (lines.length === 0) return []
  const lineBoxes = lines.map(({ pts }) => boxOf(pts))
  return boxes.flatMap((box) =>
    seaIn(
      lines.filter((_, k) => meets(lineBoxes[k]!, box)),
      box,
      index,
    ),
  )
}

/** The box [x0, y0, x1, y1] round points. */
const boxOf = (pts: ReadonlyArray<P>): Rect => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const [x, y] of pts)
    [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)]
  return [x0, y0, x1, y1]
}

/** Whether two boxes meet, touching included. */
const meets = (a: Rect, b: Rect): boolean =>
  a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]

/** The sea in one box (`seaAreas`), from the lines that may meet it. */
const seaIn = (lines: ReadonlyArray<CoastLine>, box: Rect, index: CoastIndex): Array<Area> => {
  const [x0, y0, x1, y1] = box,
    w = x1 - x0,
    h = y1 - y0,
    round = 2 * (w + h)
  const inBox = ([x, y]: P) => x >= x0 && x <= x1 && y >= y0 && y <= y1
  /** How far clockwise round the box's edge from its south-west corner a point on it lies, m. */
  const around = ([x, y]: P): number => {
    if (Math.abs(x - x0) <= ON_EDGE) return Math.min(h, Math.max(0, y - y0))
    if (Math.abs(y - y1) <= ON_EDGE) return h + Math.min(w, Math.max(0, x - x0))
    if (Math.abs(x - x1) <= ON_EDGE) return h + w + Math.min(h, Math.max(0, y1 - y))
    if (Math.abs(y - y0) <= ON_EDGE) return 2 * h + w + Math.min(w, Math.max(0, x1 - x))
    throw new Error(`the coastline ends inside the box ${box.join(", ")} at ${x}, ${y}`)
  }
  /** How far clockwise from `from` round the edge `to` lies, in [0, round). */
  const ahead = (from: number, to: number) => (((to - from) % round) + round) % round
  const corners: ReadonlyArray<readonly [number, P]> = [
    [0, [x0, y0]],
    [h, [x0, y1]],
    [h + w, [x1, y1]],
    [2 * h + w, [x1, y0]],
  ]
  const pieces: Array<ReadonlyArray<P>> = [],
    inner: Array<ReadonlyArray<P>> = []
  const edge = [rectRing(box)]
  for (const { pts, closed } of lines) {
    let line = pts
    if (closed) {
      // A ring wholly in the box is one; another is cut from a point outside, so no piece ends
      // where the ring starts.
      const out = pts.findIndex((p) => !inBox(p))
      if (out < 0) {
        inner.push(pts.slice(0, -1))
        continue
      }
      line = [...pts.slice(out, -1), ...pts.slice(0, out + 1)]
    }
    for (const piece of clipLineTo(
      edge,
      line.map(([x, y]) => ({ x, y })),
    ))
      pieces.push(piece.map((v): P => [v.x, v.y]))
  }
  const enters = pieces.map((p) => around(p[0]!)),
    leaves = pieces.map((p) => around(p.at(-1)!))
  const outers: Array<ReadonlyArray<P>> = [],
    holes: Array<ReadonlyArray<P>> = []
  const taken = new Uint8Array(pieces.length)
  for (let first = 0; first < pieces.length; first++) {
    if (taken[first] === 1) continue
    const ring: Array<P> = []
    for (let k = first; ;) {
      taken[k] = 1
      ring.push(...pieces[k]!)
      const from = leaves[k]!
      let next = -1,
        gap = Infinity
      for (let q = 0; q < pieces.length; q++) {
        const d = ahead(from, enters[q]!)
        if (d < gap) [next, gap] = [q, d]
      }
      for (let q = 0; q < pieces.length; q++) {
        const d = ahead(from, leaves[q]!)
        if (q !== k && d > 0 && d < gap)
          throw new Error(
            `the coastline leaves the box ${box.join(", ")} twice in a row along its edge: two lines disagree on the sea's side`,
          )
      }
      for (const [s, p] of [...corners].sort((a, b) => ahead(from, a[0]) - ahead(from, b[0]))) {
        const d = ahead(from, s)
        if (d > 0 && d < gap) ring.push(p)
      }
      if (next === first) break
      if (taken[next] === 1)
        throw new Error(`the coastline's pieces in the box ${box.join(", ")} close no ring`)
      k = next
    }
    outers.push(ring)
  }
  // A ring drawn counter-clockwise has its land inside (on its left): an islet.
  for (const ring of inner) (signedArea(ring) > 0 ? holes : outers).push(ring)
  if (pieces.length === 0 && index.seaward(x0, y0)) outers.push(boxRing(box))
  const flat = outers.map((ring) => ring.flat()),
    sizes = outers.map((ring) => Math.abs(signedArea(ring)))
  const held = outers.map((): Array<Array<number>> => [])
  for (const hole of holes) {
    // The smallest sea ring round the islet holds it; one in no sea is land in land.
    let best = -1
    for (let k = 0; k < outers.length; k++)
      if (pointInRing(hole[0]![0], hole[0]![1], flat[k]!) && (best < 0 || sizes[k]! < sizes[best]!))
        best = k
    const ring = flatRing(hole, false)
    if (best >= 0 && ring !== undefined) held[best]!.push(ring)
  }
  return outers.flatMap((ring, k) => {
    const outer = flatRing(ring, true),
      clean = outer === undefined ? undefined : dropSpikes(outer)
    return clean === undefined ? [] : [{ kind: "sea", level: 0, rings: [clean, ...held[k]!] }]
  })
}

/** A box's ring of corners. */
const boxRing = ([x0, y0, x1, y1]: Rect): Array<P> => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]

/**
 * `ring` (flat, on 0.1 m) without the vertices where it doubles back along one line, a point
 * repeated with them: where the coastline runs along the box's edge, the ring goes out along it and
 * back along the edge. In whole decimetres, so collinear is exact. Undefined when under 3 are left.
 */
const dropSpikes = (ring: ReadonlyArray<number>): Array<number> | undefined => {
  type Q = readonly [number, number]
  const spike = (a: Q, b: Q, c: Q): boolean => {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      vx = c[0] - b[0],
      vy = c[1] - b[1]
    return (ux === 0 && uy === 0) || (ux * vy - uy * vx === 0 && ux * vx + uy * vy < 0)
  }
  const out: Array<Q> = []
  for (let i = 0; i + 1 < ring.length; i += 2) {
    out.push([Math.round(ring[i]! * 10), Math.round(ring[i + 1]! * 10)])
    while (out.length >= 3 && spike(out.at(-3)!, out.at(-2)!, out.at(-1)!)) out.splice(-2, 1)
  }
  // Where the ring closes, its last point back onto its first.
  while (out.length >= 3) {
    const n = out.length
    if (spike(out[n - 1]!, out[0]!, out[0]!) || spike(out[n - 2]!, out[n - 1]!, out[0]!)) out.pop()
    else if (spike(out[n - 1]!, out[0]!, out[1]!)) out.shift()
    else break
  }
  return out.length < 3 ? undefined : out.flatMap(([x, y]) => [x / 10, y / 10])
}

/** The side of the index's buckets, m. */
const BUCKET = 32
/** Rounding allowed for in the index's bounds, m. */
const SLACK = 1e-6

/** Distances from the coastline and the side of it a point lies on (`coastIndex`). */
export interface CoastIndex {
  /** The distance from (x, y) to the nearest segment of the coastline, m, or `cap` when none lies nearer (and with no coastline). */
  readonly distance: (x: number, y: number, cap?: number) => number
  /**
   * Whether (x, y) lies on the sea's side (the right) of the nearest segment of the coastline; at a
   * vertex the turn there settles it (the sea lies outside a left turn). False with no coastline.
   */
  readonly seaward: (x: number, y: number) => boolean
}

/**
 * The index of the coastline's segments in BUCKET m buckets, each holding, once asked, the segments
 * no farther from its centre than the nearest one's distance plus its diagonal: any point of the
 * bucket lies within half the diagonal of the centre, so its own nearest segment is among them. A
 * lookup measures those alone, so it is exact and costs a scan of every segment once a bucket.
 */
export const coastIndex = (lines: ReadonlyArray<CoastLine>): CoastIndex => {
  // Each segment's ends, and the segments before and after it along its line (-1 at a chain's end).
  const ends: Array<number> = [],
    before: Array<number> = [],
    after: Array<number> = []
  for (const { pts, closed } of lines) {
    const first = before.length,
      n = pts.length - 1
    for (let k = 0; k < n; k++) {
      ends.push(pts[k]![0], pts[k]![1], pts[k + 1]![0], pts[k + 1]![1])
      before.push(k > 0 ? first + k - 1 : closed ? first + n - 1 : -1)
      after.push(k < n - 1 ? first + k + 1 : closed ? first : -1)
    }
  }
  const count = before.length,
    diagonal = BUCKET * Math.SQRT2,
    scratch = new Float64Array(count)
  const buckets = new Map<number, { readonly low: number; readonly near: Int32Array }>()
  const dist2 = (x: number, y: number, s: number) =>
    segDist2(x, y, ends[4 * s]!, ends[4 * s + 1]!, ends[4 * s + 2]!, ends[4 * s + 3]!)
  /** The bucket of (x, y): the least distance from any point in it, and the segments that may be nearest one. */
  const bucketAt = (x: number, y: number) => {
    const i = Math.floor(x / BUCKET),
      j = Math.floor(y / BUCKET),
      key = (i + 32768) * 65536 + (j + 32768)
    let b = buckets.get(key)
    if (b === undefined) {
      const cx = (i + 0.5) * BUCKET,
        cy = (j + 0.5) * BUCKET
      let best = Infinity
      for (let s = 0; s < count; s++) {
        scratch[s] = Math.sqrt(dist2(cx, cy, s).d2)
        best = Math.min(best, scratch[s]!)
      }
      const near: Array<number> = []
      for (let s = 0; s < count; s++) if (scratch[s]! <= best + diagonal + SLACK) near.push(s)
      b = { low: best - diagonal / 2 - SLACK, near: Int32Array.from(near) }
      buckets.set(key, b)
    }
    return b
  }
  /** The nearest segment to (x, y) among `near` (the first on a tie), its squared distance and where along it. */
  const nearest = (x: number, y: number, near: Int32Array) => {
    let d2 = Infinity,
      s = -1,
      t = 0
    for (const q of near) {
      const r = dist2(x, y, q)
      if (r.d2 < d2) [d2, s, t] = [r.d2, q, r.t]
    }
    return { d2, s, t }
  }
  /** The cross product of segment s's direction with that of q (q undefined: with (x, y) − its start). */
  const cross = (s: number, x: number, y: number, q?: number) => {
    const ux = ends[4 * s + 2]! - ends[4 * s]!,
      uy = ends[4 * s + 3]! - ends[4 * s + 1]!
    const vx = q === undefined ? x - ends[4 * s]! : ends[4 * q + 2]! - ends[4 * q]!,
      vy = q === undefined ? y - ends[4 * s + 1]! : ends[4 * q + 3]! - ends[4 * q + 1]!
    return ux * vy - uy * vx
  }
  return {
    distance: (x, y, cap = Infinity) => {
      if (count === 0) return cap
      const b = bucketAt(x, y)
      return b.low >= cap ? cap : Math.min(cap, Math.sqrt(nearest(x, y, b.near).d2))
    },
    seaward: (x, y) => {
      if (count === 0) return false
      const { s, t } = nearest(x, y, bucketAt(x, y).near)
      const at = t === 0 ? before[s]! : t === 1 ? after[s]! : -1
      if (at >= 0) {
        const turn = t === 0 ? cross(at, x, y, s) : cross(s, x, y, at)
        if (turn !== 0) return turn > 0
      }
      return cross(s, x, y) < 0
    },
  }
}
