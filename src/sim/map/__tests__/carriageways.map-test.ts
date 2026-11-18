// Every motorway carriageway of every built region (Lunigiana, Cesena and the L) keeps the motorway
// pass's grade limit over any stretch as long as the pass's smoothing half-window: the fit may
// relax the limit (RELAX) over a short stretch where the ground leaves it no other way, never over
// a motorway's length. The A15's Parma carriageway at Calcinara, its bridge's ends bound to its
// twin's level along its slope before the fit, sagged 8.1 m under its twin and climbed 6.7% over
// 100 m out of the sag (issue #19's acceptance: two motorway carriageways within the motorway grade
// limit).
import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { ROAD_PASSES } from "../../../tools/profiles.ts"
import type { Road } from "../index.ts"
import { REGIONS } from "./regions.ts"

const MOTORWAY = ROAD_PASSES.find((p) => (p.classes as ReadonlyArray<string>).includes("motorway"))!
/** The map's elevations are rounded to 0.1 m. */
const ROUNDING = 0.1

/**
 * The motorway pieces joined end to start into carriageways, each a line of points (x, y, z): a
 * piece runs on into the next where it ends at the start of one motorway piece alone.
 */
const carriageways = (roads: ReadonlyArray<Road>) => {
  const pieces = roads.filter((r) => r.cls === "motorway")
  const key = (pts: ReadonlyArray<number>, i: number) => `${pts[2 * i]},${pts[2 * i + 1]}`
  const starts = new Map<string, Array<Road>>(),
    ends = new Map<string, number>()
  for (const r of pieces) {
    const k = key(r.pts, 0)
    starts.set(k, [...(starts.get(k) ?? []), r])
    const e = key(r.pts, r.z.length - 1)
    ends.set(e, (ends.get(e) ?? 0) + 1)
  }
  const next = (r: Road) => {
    const e = key(r.pts, r.z.length - 1),
      on = starts.get(e) ?? []
    return on.length === 1 && ends.get(e) === 1 ? on[0] : undefined
  }
  const led = new Set(pieces.flatMap((r) => [next(r) ?? []].flat()))
  const used = new Set<Road>()
  const lines: Array<{ readonly ids: Array<number>; readonly p: Array<readonly number[]> }> = []
  for (const first of [...pieces.filter((r) => !led.has(r)), ...pieces])
    if (!used.has(first)) {
      const line = { ids: [] as Array<number>, p: [] as Array<readonly number[]> }
      for (let r: Road | undefined = first; r !== undefined && !used.has(r); r = next(r)) {
        used.add(r)
        line.ids.push(r.id)
        for (let i = line.p.length === 0 ? 0 : 1; i < r.z.length; i++)
          line.p.push([r.pts[2 * i]!, r.pts[2 * i + 1]!, r.z[i]!])
      }
      lines.push(line)
    }
  return lines
}

for (const [region, read, skip] of REGIONS)
  test(
    `carriageways: on ${region}, every motorway climbs or falls at most ${MOTORWAY.grade * 100}% over any ${MOTORWAY.half} m, plus the ${ROUNDING} m rounding`,
    { skip },
    () => {
      const limit = MOTORWAY.grade + ROUNDING / MOTORWAY.half
      const out: Array<string> = []
      for (const { ids, p } of carriageways(read().roads)) {
        const s = [0]
        for (let i = 1; i < p.length; i++)
          s.push(s[i - 1]! + Ops.hypot(p[i]![0]! - p[i - 1]![0]!, p[i]![1]! - p[i - 1]![1]!))
        let worst = 0,
          at = 0
        for (let i = 0, j = 0; i < p.length; i++) {
          while (j < p.length && s[j]! - s[i]! < MOTORWAY.half) j++
          if (j === p.length) break
          const g = Math.abs(p[j]![2]! - p[i]![2]!) / (s[j]! - s[i]!)
          if (g > worst) [worst, at] = [g, i]
        }
        if (worst > limit)
          out.push(
            `motorway ${ids[0]}…${ids.at(-1)} ${(worst * 100).toFixed(2)}% at ${p[at]![0]},${p[at]![1]}`,
          )
      }
      assert.deepEqual(out, [])
    },
  )
