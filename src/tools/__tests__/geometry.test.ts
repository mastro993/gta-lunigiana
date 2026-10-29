import assert from "node:assert/strict"
import { test } from "node:test"

import { BOUNDS, type P, clipRing } from "../geometry.ts"

/** A square from (x, y), `s` metres a side. */
const square = (x: number, y: number, s: number): Array<P> => [
  [x, y],
  [x, y + s],
  [x + s, y + s],
  [x + s, y],
]
const sorted = (ring: ReadonlyArray<P>) => ring.toSorted((a, b) => a[0] - b[0] || a[1] - b[1])

test("clipRing keeps the part of a ring inside a box", () => {
  assert.deepEqual(sorted(clipRing(square(-50, 900, 200), [0, 0, 1000, 1000])), [
    [0, 900],
    [0, 1000],
    [150, 900],
    [150, 1000],
  ])
  assert.deepEqual(clipRing(square(2000, 0, 10), [0, 0, 1000, 1000]), [])
})

test("clipRing clips to the play area by default", () => {
  const x = BOUNDS.maxX - 10
  assert.deepEqual(sorted(clipRing(square(x, 0, 20))), [
    [x, 0],
    [x, 20],
    [BOUNDS.maxX, 0],
    [BOUNDS.maxX, 20],
  ])
})
