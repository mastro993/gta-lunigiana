import assert from "node:assert/strict"
import { test } from "node:test"

import type { V } from "../geometry.ts"
import { junctionReach } from "../junction-reach.ts"
import type { Linear } from "../profiles.ts"

const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })
/** A residential road's steepest grade (1.5 x 15 %). */
const GRADE = 0.225
// Along y 0: a 12 m link from junction A (set at 100 m) to B, the junction a fit is about to set;
// past B a road to C, 12 m in two pieces joined at J; a third road leaves J north.
const ab: Linear = { pts: [v(0, 0, "A"), v(12, 0, "B")] }
const bj: Linear = { pts: [v(12, 0, "B"), v(18, 0, "J")] }
const jc: Linear = { pts: [v(18, 0, "J"), v(24, 0, "C")] }
const north: Linear = { pts: [v(18, 0, "J"), v(18, 50, "N")] }
const graded = (pieces: ReadonlyArray<Linear>) => pieces.map((piece) => ({ piece, grade: GRADE }))
const set = (z: Record<string, number>) => (id: string) => z[id]
const all = () => true
/** Whether cone `got` is [lo, hi] to a nanometre. */
const near = (got: readonly [number, number] | undefined, lo: number, hi: number) =>
  got !== undefined && Math.abs(got[0] - lo) < 1e-9 && Math.abs(got[1] - hi) < 1e-9

test("junctionReach keeps a junction within its links' steepest grade of the junctions they lead to", () => {
  const flat = junctionReach(graded([ab, bj, jc]), () => 100)
  // The 12 m link to A: 2.7 m either way; the 12 m on to C through the joint J, where no other road
  // meets them: 2.7 m of C.
  assert.ok(near(flat("B", set({ A: 100 }), all), 97.3, 102.7))
  assert.ok(near(flat("B", set({ C: 90 }), all), 87.3, 92.7))
  // Cones that miss each other (A at 100, C at 90): the span between them.
  assert.ok(near(flat("B", set({ A: 100, C: 90 }), all), 92.7, 97.3))
  // A link already fitted, or the chain being fitted, bounds nothing; nor does a set node past a
  // joint another road meets.
  assert.equal(
    flat("B", set({ A: 100 }), (l) => l !== ab),
    undefined,
  )
  const branched = junctionReach(graded([ab, bj, jc, north]), () => 100)
  assert.equal(
    branched("B", set({ C: 90 }), (l) => l !== ab),
    undefined,
  )
  // Ground climbing 30 % from A to B, steeper than the link's grade: the ground's own climb.
  const steep = junctionReach(graded([ab]), (x) => 100 + 0.3 * x)
  assert.ok(near(steep("B", set({ A: 100 }), all), 96.4, 103.6))
})
