import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP, TILE } from "../../sim/map/index.ts"
import { QUARTER, screenAxes } from "../../sim/view.ts"
import { minimapRotation, paintMap, tileReach, tilesNear } from "../minimap.ts"

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

/** A stand-in for the browser's Path2D: it keeps the points it is given. */
class Points {
  readonly pts: Array<number> = []
  moveTo(x: number, y: number) {
    this.pts.push(x, y)
  }
  lineTo(x: number, y: number) {
    this.pts.push(x, y)
  }
  closePath() {}
}

/** The paths `paintMap` fills and strokes, in order, on a stand-in 2D context. */
const painted = (
  ...args: Parameters<typeof paintMap> extends [unknown, ...infer R] ? R : never
) => {
  const drawn: Array<Points> = []
  const ctx = new Proxy(
    {
      fillRect: () => {},
      fill: (p: Points) => drawn.push(p),
      stroke: (p: Points) => drawn.push(p),
    },
    { set: () => true },
  )
  Object.assign(globalThis, { Path2D: Points })
  paintMap(ctx as unknown as CanvasRenderingContext2D, ...args)
  return drawn
}

test("a tile's canvas, painted from only the features near it, gets every path the whole map would draw on it, in order", () => {
  const side = 602,
    pad = 3 // canvas px: the widest stroke's half (a 12 m road drawn 1.6 times as wide, at 0.3 px/m)
  const onCanvas = (p: Points) => {
    const xs = p.pts.filter((_, k) => k % 2 === 0),
      ys = p.pts.filter((_, k) => k % 2 === 1)
    return (
      Math.min(...xs) <= side + pad &&
      Math.max(...xs) >= -pad &&
      Math.min(...ys) <= side + pad &&
      Math.max(...ys) >= -pad
    )
  }
  // Monzone's tile, and the one east of it across the x = 0 seam.
  for (const [i, j] of [
    [-1, 0],
    [0, 0],
  ] as const) {
    const corner = { minX: i * TILE, maxY: (j + 1) * TILE }
    const all = painted(0.3, corner, { ox: 1, oy: 1 }).filter(onCanvas)
    const near = painted(0.3, corner, { ox: 1, oy: 1, within: tileReach(i, j) })
    assert.ok(all.length > 500, `${i}_${j} holds the village`)
    assert.deepEqual(near.filter(onCanvas), all, `${i}_${j}`)
    assert.ok(near.length < 1.2 * all.length, "and little more")
  }
})
