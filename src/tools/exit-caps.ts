// The road-block caps a few metres inside the play area's outline where a drivable road leaves it
// (its cut end, which has no id): a drive wall across the road, so a car stops short of the edge.
import { isDrivable } from "../sim/map/kinds.ts"
import type { RoadF } from "./features.ts"
import { type V } from "./geometry.ts"
import { segIndex } from "./spatial-index.ts"

/** How far inside the outline a cap stands, along its road from its cut end, m. */
const IN = 4
/** How far past its carriageway's edges a cap reaches, m. */
const PAST = 1
/** The step a cap is walked by to find where another road's carriageway crosses it, m. */
const STEP = 0.1
/**
 * The narrowest piece of a cap kept, m: a Panda's width (`VEHICLES` in src/sim/vehicles.ts). A
 * narrower one, left between other roads' carriageways, shuts no way a car could take.
 */
const NARROWEST = 1.65

/** Where a cap stands: a point on its road, the road's direction there toward the cut end, the piece's half-width there, and the pieces of its run. */
interface Site {
  readonly x: number
  readonly y: number
  readonly tx: number
  readonly ty: number
  readonly h: number
  readonly run: ReadonlySet<RoadF>
}

/** `pts` from its first point (or its last, `reversed`), with no point repeating the one before it. */
const walked = (pts: ReadonlyArray<V>, reversed: boolean): Array<V> =>
  (reversed ? [...pts].reverse() : pts).filter(
    (p, k, all) => k === 0 || p.x !== all[k - 1]!.x || p.y !== all[k - 1]!.y,
  )

/**
 * The site IN m in from the cut end of `r` (its first point when `first`) along it, and on along the
 * pieces joined end to end with it at a node no third way meets (`ways`, by node id): its run, one
 * road that OSM split. Where the run ends sooner (a junction), the site stands on along its last
 * segment's line, as every cap stood before the run was walked. The run takes in the piece joined on
 * past the site's piece too, whose carriageway may reach back over the site: Cesena's 26491046,
 * 4.1 m from the cut end to its joint with 26491045, lost its cap to that piece's.
 */
const siteOf = (
  r: RoadF,
  first: boolean,
  ways: ReadonlyMap<string, ReadonlyArray<RoadF>>,
): Site => {
  const run = new Set([r])
  /** The piece joined end to end with `piece` at its point `b`, where no third way meets them. */
  const joinedAt = (piece: RoadF, b: V) => {
    const at = b.id === undefined ? undefined : ways.get(b.id)
    const on = at?.length === 2 ? at.find((q) => q !== piece) : undefined
    return on !== undefined &&
      isDrivable(on.cls) &&
      !run.has(on) &&
      (on.pts[0]!.id === b.id || on.pts.at(-1)!.id === b.id)
      ? on
      : undefined
  }
  let piece = r,
    pts = walked(r.pts, !first),
    left = IN
  for (;;) {
    if (pts.length < 2) return { x: pts[0]!.x, y: pts[0]!.y, tx: 1, ty: 0, h: piece.w / 2, run }
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k]!,
        b = pts[k + 1]!
      const len = Math.hypot(b.x - a.x, b.y - a.y),
        tx = (a.x - b.x) / len,
        ty = (a.y - b.y) / len
      if (len >= left) {
        const past = joinedAt(piece, pts.at(-1)!)
        if (past !== undefined) run.add(past)
        return { x: a.x - tx * left, y: a.y - ty * left, tx, ty, h: piece.w / 2, run }
      }
      left -= len
      if (k + 2 < pts.length) continue
      const on = joinedAt(piece, b)
      if (on === undefined)
        return { x: b.x - tx * left, y: b.y - ty * left, tx, ty, h: piece.w / 2, run }
      run.add(on)
      piece = on
      pts = walked(on.pts, on.pts[0]!.id !== b.id)
      break
    }
  }
}

/**
 * Each cap, (ax, ay, bx, by): across its road IN m inside its cut end along the road (`siteOf`),
 * over its carriageway and PAST m beyond each edge, but on no other drivable road's carriageway (a
 * tunnel's lies under the ground; the pieces of its run are its own road), no piece of it
 * narrower than a car, nor a gap between two that a car would pass: a cap shuts its own road alone,
 * and the outline's walls close the edge behind it. A stub leaving a few metres from a junction,
 * whose site lies on the other roads' carriageways, has none. Split where the L's 719407874 leaves
 * 7.4 m from its junction with 175092604, whose carriageway reached 1 m across the cap's middle,
 * the cap's two 3 m pieces shut it as one. Whole, the cap of the A12's Genova carriageway leaving at y 3900 reached 4.3 m into its twin's
 * 5 m, 11 m inside the outline, and a residential stub leaving 4.3 m from its junction with the Via
 * Aurelia at Ponte di Arcola capped the Via Aurelia's lanes 1 m off its traffic edge. Trimmed against
 * its own run too, the cap of the L's primary bridge 1551433107, cut 2.3 m from its joint with
 * 552595853, stood on that road alone and was gone.
 */
export const exitCaps = (
  roads: ReadonlyArray<RoadF>,
): Array<readonly [number, number, number, number]> => {
  const carriageways = segIndex<RoadF>()
  const ways = new Map<string, Array<RoadF>>()
  for (const r of roads) {
    if (isDrivable(r.cls) && r.tunnel !== true) carriageways.addLine(r.pts, r.w / 2, r)
    for (const id of new Set(r.pts.map((v) => v.id)))
      if (id !== undefined) ways.set(id, [...(ways.get(id) ?? []), r])
  }
  const out: Array<readonly [number, number, number, number]> = []
  for (const r of roads) {
    if (!isDrivable(r.cls)) continue
    for (const first of [true, false]) {
      if ((first ? r.pts[0]! : r.pts.at(-1)!).id !== undefined) continue
      const { x, y, tx, ty, h: half, run } = siteOf(r, first, ways)
      // Walked from -h to h across the road, the runs of it on no other road's carriageway, those
      // apart by less than a car joined across the gap.
      const h = half + PAST,
        n = Math.ceil((2 * h) / STEP),
        at = (k: number) => (k === n ? h : -h + (2 * h * k) / n)
      const pieces: Array<[number, number]> = []
      let from: number | undefined
      for (let k = 0; k <= n; k++) {
        const a = at(k),
          free = !carriageways.covers(x + ty * a, y - tx * a, (o) => !run.has(o))
        if (free && from === undefined) from = a
        if (from !== undefined && (!free || k === n)) {
          const to = free ? a : at(k - 1),
            last = pieces.at(-1)
          if (last !== undefined && from - last[1] < NARROWEST) last[1] = to
          else pieces.push([from, to])
          from = undefined
        }
      }
      for (const [a, b] of pieces)
        if (b - a >= NARROWEST) out.push([x + ty * a, y - tx * a, x + ty * b, y - tx * b])
    }
  }
  return out
}
