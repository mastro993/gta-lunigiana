import assert from "node:assert/strict"
import { test } from "node:test"

import { wallsNear } from "../index.ts"
import { TILE } from "../kinds.ts"
import { provideTile, residentTiles, tilesOver } from "../tiles.ts"
import { emptied, fromDisk, outlineOnSeam, wallsAt } from "./tile-kit.ts"

// Reads the tiles round four spots twice over, in two orders: about 0.5 s alone, past pnpm test's
// 0.4 s line, and more as the parts round the outline's box grow.
test("wallsNear gives the same answer, in the same order, whatever is in memory and in whichever order it came", () => {
  // Boxes across the x = 0 and y = 0 seams near Monzone station, at the tile corner (0, 0), and on a
  // bounds wall reaching into the next tile, where the outline crosses a seam (found by geometry).
  const [ox, oy] = outlineOnSeam()
  const boxes = [
    [0, 30, 30],
    [-25, 0, 24],
    [0, 0, 40],
    [ox, oy, 40],
  ] as const
  const answer = () =>
    boxes.flatMap(([x, y, r]) =>
      (["walk", "land", "drive", "traffic"] as const).map((kind) => wallsAt(kind, x, y, r)),
    )
  emptied()
  const lazy = answer()
  const touched = residentTiles()
  // The tiles the answers read, and every tile beside them: more than they need, in two orders.
  const around = [
    ...new Set(boxes.flatMap(([x, y]) => tilesOver(x - TILE, y - TILE, x + TILE, y + TILE))),
  ]
  for (const order of [around, [...around].reverse()]) {
    emptied()
    for (const key of order) provideTile(fromDisk(key))
    assert.deepEqual(answer(), lazy)
  }
  assert.ok(touched.length >= 5, touched.join(" "))
  assert.ok(around.length > touched.length, around.join(" "))
  // Each box holds a wall of every kind itself, not only the 16 m cells round it that its broad phase
  // answers: their corner, the kind's lowest wall, moves as a part grows the box (`MAP.walls.lattice`)
  for (const [x, y, r] of boxes)
    for (const kind of ["walk", "land", "drive", "traffic"] as const)
      assert.ok(
        wallsNear(kind, x - r, y - r, x + r, y + r).some(
          (s) =>
            Math.max(s.ax, s.bx) >= x - r &&
            Math.min(s.ax, s.bx) <= x + r &&
            Math.max(s.ay, s.by) >= y - r &&
            Math.min(s.ay, s.by) <= y + r,
        ),
        `${kind} at ${x},${y}`,
      )
})
