// The sea's floor (issue #13): how deep the sea lies at a point, from Regione Liguria's survey of it
// (the P.T.A.M.C.'s isobaths, a line every metre of depth from the multibeam surveys of 2010–2019:
// `readIsobaths` in ucs.ts) and OSM's shore (its coastline less the mouths it closes across a river:
// `shoreLines` in coast.ts), and a shoreface profile by the distance from the shore where the survey
// stops (the Tuscan sea past the Parmignola, Liguria's sea border). The tile pass carves every node
// in the sea to it (`carveAreas`), node by node: a node's floor is a function of its point alone, so
// tiles meet bit for bit. Only + − × ÷ and sqrt, so every architecture builds the same floor
// (`map-key.test.ts`).
import type { CoastIndex } from "./coast.ts"
import type { P } from "./geometry.ts"

/** A contour line of the sea floor in local metres: its survey id, its depth (m under the sea) and its points. */
export interface Isobath {
  readonly id: number
  readonly depth: number
  readonly pts: ReadonlyArray<P>
}

/**
 * The shoreface's depth (m) by the distance from the shore (m), linear between its points and level
 * past the last: the issue's beach face (8 % down to 0.6 m); the median distance from the shore of
 * the vertices of the survey's isobaths that `seaFloor` reads off Marinella (x −9700…−8800, the
 * beach the Tuscan sea past the Parmignola continues), and its 10 m line's off Fiumaretta (x −10800…
 * −9700: Marinella's survey stops short of it); then the issue's EMODnet shelf off Marinella, 13 m
 * at 2.2 km and 17 m at 7.8 km. The shelf alone gave 1 m at 450 m and 8 m at 1.1 km, where the
 * survey reads 6.4 and 9.7 (measured 2026-11-17).
 */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [7.5, 0.6],
  [81, 2],
  [113, 3],
  [169, 4],
  [255, 5],
  [393, 6],
  [540, 7],
  [692, 8],
  [881, 9],
  [1212, 10],
  [2200, 13],
  [7800, 17],
]
/** Where the profile levels off, m from the shore. */
const LEVEL = PROFILE.at(-1)![0]

/** The profile's depth (m) at `d` m from the shore. */
const shoreface = (d: number): number => {
  for (let k = 1; k < PROFILE.length; k++) {
    const [d1, z1] = PROFILE[k]!
    if (d <= d1) {
      const [d0, z0] = PROFILE[k - 1]!
      return z0 + ((z1 - z0) * (d - d0)) / (d1 - d0)
    }
  }
  return PROFILE.at(-1)![1]
}

/**
 * An isobath shorter than this, m, is left out. Of magra-coast's 1,636 open lines 1,497 are: every
 * line of 17–25 m (none 20 m long, stacked a depth a metre within a few metres where the survey's
 * rasters meet or end, as along N 4877234.7 and at Liguria's sea border by the Parmignola, E
 * 581513.3: a wall of water no sea floor holds) and the shallow lines' broken bits; and so are 315
 * of its 368 rings, under 16 m across, which the 4 m grid draws as a node's spike.
 */
const SHORT = 50
/**
 * A contour counts within this of a point, m, its weight falling to nothing there; the survey's
 * floor fades into the profile from TRUST m from its nearest isobath to this. Every point of
 * magra-coast's sea but the Tuscan sea's far corner lies within 1.2 km of an isobath. `fetch-lig`
 * asks for the isobaths this far round a part, so a node by its edge reads the contours a bigger
 * region would.
 */
export const REACH = 1500
/** Within this of an isobath, m, the floor is the survey's alone. */
const TRUST = 1000
/** The side of the cells whose points share their contours' candidates, m. */
const CELL = 32
/** The side of the buckets the isobaths' segments are filed in, m. */
const SEG = 64
/** How far a cell's point lies from its centre at most, m. */
const HALF = (CELL * Math.SQRT2) / 2

/** The squared distance from (x, y) to segment s of `ends` (4 numbers a segment: its ends). */
const dist2 = (ends: Float64Array, s: number, x: number, y: number): number => {
  const ax = ends[4 * s]!,
    ay = ends[4 * s + 1]!,
    ex = ends[4 * s + 2]! - ax,
    ey = ends[4 * s + 3]! - ay,
    l2 = ex * ex + ey * ey
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2)) : 0
  const dx = ax + ex * t - x,
    dy = ay + ey * t - y
  return dx * dx + dy * dy
}

/** A line's length, m. */
const lengthOf = (pts: ReadonlyArray<P>): number => {
  let len = 0
  for (let k = 1; k < pts.length; k++) {
    const dx = pts[k]![0] - pts[k - 1]![0],
      dy = pts[k]![1] - pts[k - 1]![1]
    len += Math.sqrt(dx * dx + dy * dy)
  }
  return len
}

/** A bucket's key from its column and row. */
const keyOf = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768)

/**
 * The sea's floor (m a.s.l., at or under 0) at a point, from the shore's distances (`shore`, the
 * coastline less its mouths, islets included) and the survey's `isobaths`. The contours a point
 * reads are the shore, whose depth there is the profile's at its distance from it, and each depth's
 * nearest isobath within REACH. The two nearest, at d1 and d2, weigh 1/d − 1/d3 each, d3 the third's
 * distance (or REACH): the two-contour rule (a·d2 + b·d1)/(d1 + d2), which steps where a third
 * contour comes nearer than the second, made continuous, as the third takes the second's place with
 * its weight at 0. The floor is that within TRUST of an isobath, the profile from REACH, and between
 * them the one fading into the other; on a contour, its depth.
 */
export const seaFloor = (
  shore: CoastIndex,
  isobaths: ReadonlyArray<Isobath>,
): ((x: number, y: number) => number) => {
  const kept = isobaths.filter((l) => lengthOf(l.pts) >= SHORT)
  const depths = [...new Set(kept.map((l) => l.depth))].sort((a, b) => a - b)
  const slotOf = new Map(depths.map((d, k) => [d, k]))
  const endList: Array<number> = [],
    slotList: Array<number> = []
  for (const { depth, pts } of kept)
    for (let k = 0; k + 1 < pts.length; k++) {
      endList.push(pts[k]![0], pts[k]![1], pts[k + 1]![0], pts[k + 1]![1])
      slotList.push(slotOf.get(depth)!)
    }
  const ends = Float64Array.from(endList),
    slots = Int32Array.from(slotList)
  // Each segment in every bucket its box meets.
  const filed = new Map<number, Array<number>>()
  for (let s = 0; s < slots.length; s++) {
    const x0 = Math.min(ends[4 * s]!, ends[4 * s + 2]!),
      x1 = Math.max(ends[4 * s]!, ends[4 * s + 2]!),
      y0 = Math.min(ends[4 * s + 1]!, ends[4 * s + 3]!),
      y1 = Math.max(ends[4 * s + 1]!, ends[4 * s + 3]!)
    for (let i = Math.floor(x0 / SEG); i <= Math.floor(x1 / SEG); i++)
      for (let j = Math.floor(y0 / SEG); j <= Math.floor(y1 / SEG); j++) {
        const list = filed.get(keyOf(i, j))
        if (list === undefined) filed.set(keyOf(i, j), [s])
        else list.push(s)
      }
  }
  const cells = new Map<number, Int32Array>()
  /**
   * The segments that may be nearest a point of cell (i, j) of its depth, for each depth that may be
   * among its three nearest within REACH, in segment order. From the cell's centre C, a point of it
   * lies within HALF: a depth whose nearest lies more than 2 HALF farther from C than the third
   * nearest's (or REACH) is none of the point's three, and of a depth that may be, only its segments
   * within 2 HALF of its nearest from C may be nearest the point. The buckets are searched ring by
   * ring out from C's: past ring k, every segment within k SEG of C has been seen.
   */
  const candidates = (i: number, j: number): Int32Array => {
    const key = keyOf(i, j),
      known = cells.get(key)
    if (known !== undefined) return known
    const cx = (i + 0.5) * CELL,
      cy = (j + 0.5) * CELL,
      bi = Math.floor(cx / SEG),
      bj = Math.floor(cy / SEG)
    const least = new Float64Array(depths.length).fill(Infinity)
    const seen = new Map<number, number>()
    let reach = REACH + HALF
    for (let ring = 0; (ring - 1) * SEG < reach + 2 * HALF; ring++) {
      for (let a = bi - ring; a <= bi + ring; a++) {
        // The ring's own buckets: its first and last columns whole, the top and bottom of the rest.
        const side = a === bi - ring || a === bi + ring
        for (let b = bj - ring; b <= bj + ring; b += side || ring === 0 ? 1 : 2 * ring)
          for (const s of filed.get(keyOf(a, b)) ?? []) {
            if (seen.has(s)) continue
            const d = Math.sqrt(dist2(ends, s, cx, cy))
            seen.set(s, d)
            least[slots[s]!] = Math.min(least[slots[s]!]!, d)
          }
      }
      const third = [...least].sort((p, q) => p - q)[2] ?? Infinity
      reach = Math.min(third + 2 * HALF, REACH + HALF)
    }
    const list: Array<number> = []
    for (const [s, d] of seen) {
      const nearest = least[slots[s]!]!
      if (nearest <= reach && d <= nearest + 2 * HALF) list.push(s)
    }
    const out = Int32Array.from(list.sort((p, q) => p - q))
    cells.set(key, out)
    return out
  }
  const nearest2 = new Float64Array(depths.length).fill(Infinity),
    touched: Array<number> = []
  // The three nearest contours of the point being read within REACH (d1 ≤ d2 ≤ d3), the first two's depths.
  let d1 = REACH,
    v1 = 0,
    d2 = REACH,
    v2 = 0,
    d3 = REACH
  const take = (d: number, v: number) => {
    if (d >= d3) return
    if (d >= d2) {
      d3 = d
      return
    }
    d3 = d2
    if (d >= d1) {
      d2 = d
      v2 = v
      return
    }
    d2 = d1
    v2 = v1
    d1 = d
    v1 = v
  }
  return (x, y) => {
    const dc = shore.distance(x, y, LEVEL),
      profile = shoreface(dc)
    d1 = d2 = d3 = REACH
    v1 = v2 = 0
    let iso = Infinity
    take(dc, profile)
    for (const s of candidates(Math.floor(x / CELL), Math.floor(y / CELL))) {
      const slot = slots[s]!,
        d = dist2(ends, s, x, y)
      if (d < nearest2[slot]!) {
        if (nearest2[slot] === Infinity) touched.push(slot)
        nearest2[slot] = d
      }
    }
    for (const slot of touched) {
      const d = Math.sqrt(nearest2[slot]!)
      take(d, depths[slot]!)
      iso = Math.min(iso, d)
      nearest2[slot] = Infinity
    }
    touched.length = 0
    if (d1 >= REACH) return -profile
    const w1 = d1 === 0 ? 1 : 1 / d1 - 1 / d3,
      w2 = d1 === 0 || d2 >= d3 ? 0 : 1 / d2 - 1 / d3
    const survey = w1 + w2 > 0 ? (w1 * v1 + w2 * v2) / (w1 + w2) : v1
    const trust = iso <= TRUST ? 1 : iso >= REACH ? 0 : (REACH - iso) / (REACH - TRUST)
    return -(trust * survey + (1 - trust) * profile)
  }
}
