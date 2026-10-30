import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { QUARTER, screenAxes } from "../../sim/view.ts"
import { minimapRotation, tilesNear } from "../minimap.ts"

test("the minimap turns screen-up to the top, whichever way the view is turned", () => {
  for (const turns of [0, 1, 2, 3, -1]) {
    // North-up canvas vector of screen-up, rotated by the canvas transform (y grows downwards).
    const { up } = screenAxes(turns),
      r = minimapRotation(turns * QUARTER)
    const u = up.x,
      v = -up.y,
      c = Math.cos(r),
      s = Math.sin(r)
    assert.ok(Math.abs(u * c - v * s) < 1e-9, `turns ${turns}`)
    assert.ok(Math.abs(u * s + v * c + 1) < 1e-9, `turns ${turns}`)
  }
})

/** The minimap's reach from the player: the corner of its 300 m square, which a turn brings onto either axis. */
const VIEW = 150 * Math.SQRT2

test("the minimap shows the tiles its turned square can reach, nearest first, and none off the map", () => {
  const keys = (x: number, y: number, r: number) => tilesNear(x, y, r).map((t) => t.key)
  assert.deepEqual(keys(1000, 1000, VIEW), ["0_0"], "mid-tile: one tile")
  assert.deepEqual(
    keys(5, 1990, VIEW),
    ["0_0", "-1_0", "0_1", "-1_1"],
    "by a corner: four, nearest first",
  )
  assert.deepEqual(
    keys(1000, 1000, 1000),
    ["0_0"],
    "the neighbours of mid-tile lie a kilometre off",
  )
  assert.deepEqual(
    keys(900, 1500, 1000),
    ["0_0", "0_1", "-1_0", "-1_1"],
    "the tile in view is painted before those ahead, then the nearest",
  )
  const { minX, minY } = MAP.bounds
  for (const t of tilesNear(minX + 10, minY + 10, 1500))
    assert.ok(
      MAP.tiles.some(({ i, j }) => i === t.i && j === t.j),
      `${t.key} is a listed tile`,
    )
})
