import assert from "node:assert/strict"
import { test } from "node:test"

import { chainsOf, type Linear } from "../chains.ts"
import type { V } from "../geometry.ts"
import { HEADING_SPAN, MAX_TURN } from "../rail-graph.ts"

const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })

test("chainsOf with `through` runs a track on through its switches, the track that diverges alone ending there", () => {
  const pieces: Array<Linear & { readonly id: number }> = [
    { id: 1, pts: [v(-100, 0), v(0, 0, "s")] },
    { id: 2, pts: [v(0, 0, "s"), v(100, 0, "t")] },
    { id: 3, pts: [v(100, 0, "t"), v(200, 0)] },
    // Diverging at 5.7° from the switch, and at 30° (a crossing's way, past no turn) from "t".
    { id: 4, pts: [v(0, 0, "s"), v(50, 5), v(150, 15)] },
    { id: 5, pts: [v(100, 0, "t"), v(150, -29)] },
  ]
  const ids = (through?: { readonly turn: number; readonly span: number }) =>
    chainsOf(pieces, through)
      .map((c) => c.map((m) => m.item.id).sort((a, b) => a - b))
      .sort((a, b) => a[0]! - b[0]!)
  assert.deepEqual(ids(), [[1], [2], [3], [4], [5]])
  assert.deepEqual(ids({ turn: MAX_TURN, span: HEADING_SPAN }), [[1, 2, 3], [4], [5]])
})
