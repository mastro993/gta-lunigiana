// The road-block caps a few metres inside the play area's outline where a drivable road leaves it
// (its cut end, which has no id): a drive wall across the road, so a car stops short of the edge.
import { isDrivable } from "../sim/map/kinds.ts"
import type { RoadF } from "./features.ts"
import { segIndex } from "./geometry.ts"

/** How far inside the outline a cap stands, along its road from its cut end, m. */
const IN = 4
/** How far past its carriageway's edges a cap reaches, m. */
const PAST = 1
/** The step a cap is walked by to find where another road's carriageway crosses it, m. */
const STEP = 0.1

/**
 * Each cap, (ax, ay, bx, by): across its road IN m inside its cut end, over its carriageway and PAST
 * m beyond each edge, but on no other drivable road's carriageway (a tunnel's lies under the
 * ground): a cap shuts its own road alone, and the outline's walls close the edge behind it. Whole,
 * the cap of the A12's Genova carriageway leaving at y 3900 reached 4.3 m into its twin's 5 m, 11 m
 * inside the outline, and a residential stub leaving 4.3 m from its junction with the Via Aurelia at
 * Ponte di Arcola capped the Via Aurelia's lanes 1 m off its traffic edge.
 */
export const exitCaps = (
  roads: ReadonlyArray<RoadF>,
): Array<readonly [number, number, number, number]> => {
  const carriageways = segIndex<RoadF>()
  for (const r of roads)
    if (isDrivable(r.cls) && r.tunnel !== true) carriageways.addLine(r.pts, r.w / 2, r)
  const out: Array<readonly [number, number, number, number]> = []
  for (const r of roads) {
    if (!isDrivable(r.cls)) continue
    for (const [end, prev] of [
      [r.pts[0]!, r.pts[1]!],
      [r.pts.at(-1)!, r.pts.at(-2)!],
    ] as const) {
      if (end.id !== undefined) continue
      const len = Math.hypot(end.x - prev.x, end.y - prev.y) || 1
      const tx = (end.x - prev.x) / len,
        ty = (end.y - prev.y) / len,
        cx = end.x - tx * IN,
        cy = end.y - ty * IN,
        h = r.w / 2 + PAST
      // Walked from -h to h across the road, the runs of it on no other road's carriageway.
      const n = Math.ceil((2 * h) / STEP),
        at = (k: number) => (k === n ? h : -h + (2 * h * k) / n)
      let from: number | undefined
      for (let k = 0; k <= n; k++) {
        const a = at(k),
          free = !carriageways.covers(cx + ty * a, cy - tx * a, (o) => o !== r)
        if (free && from === undefined) from = a
        if (from !== undefined && (!free || k === n)) {
          const to = free ? a : at(k - 1)
          if (to > from) out.push([cx + ty * from, cy - tx * from, cx + ty * to, cy - tx * to])
          from = undefined
        }
      }
    }
  }
  return out
}
