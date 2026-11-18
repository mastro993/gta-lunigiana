import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"

import { hash01 } from "../geometry.ts"
import { traceLoops } from "../loops.ts"

/** A `cols` × `rows` grid of 4 m cells and its mask of cells blocked with odds `share` (seeded by `seed`). */
const masked = (cols: number, rows: number, share: number, seed: number) => ({
  g: { cell: 4, cols: cols + 1, rows: rows + 1, x0: -10, y0: 20 },
  blocked: Uint8Array.from({ length: cols * rows }, (_, k) => (hash01(seed, k) < share ? 1 : 0)),
})

test("traceLoops gives the loops it gave as a map of every crossing: the same points, in the same order", () => {
  // Masks from sparse to dense, saddles and the grid's edges among their cells; the digest is of
  // the loops the build traced before it walked the crossings one square at a time.
  const digest = createHash("sha256")
  let loops = 0
  for (const [cols, rows, share, seed] of [
    [1, 1, 1, 1],
    [7, 3, 0.5, 2],
    [40, 30, 0.1, 3],
    [40, 30, 0.5, 4],
    [40, 30, 0.9, 5],
    [64, 9, 0.3, 6],
  ] as const) {
    const { g, blocked } = masked(cols, rows, share, seed)
    for (const loop of traceLoops(g, blocked)) {
      loops++
      assert.deepEqual(loop[0], loop.at(-1), "a loop closes")
      digest.update(new Float64Array(loop.flat()))
    }
  }
  assert.ok(loops > 100, `${loops} loops`)
  assert.equal(digest.digest("hex").slice(0, 16), "420f6c724eec9b4a")
})

test("traceLoops traces a lone cell anticlockwise from its lowest crossing, and nothing round an open grid", () => {
  const g = { cell: 2, cols: 4, rows: 4, x0: 0, y0: 0 }
  const lone = new Uint8Array(9)
  lone[4] = 1
  assert.deepEqual(
    [...traceLoops(g, lone)],
    [
      [
        [3, 2],
        [4, 3],
        [3, 4],
        [2, 3],
        [3, 2],
      ],
    ],
  )
  assert.deepEqual([...traceLoops(g, new Uint8Array(9))], [])
})
