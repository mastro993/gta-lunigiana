import assert from "node:assert/strict"
import { test } from "node:test"

import { TILE } from "../../sim/map/index.ts"
import { paintMap, tileReach } from "../minimap.ts"

// Map check (pnpm test:map): the minimap's tiles against the whole map painted.
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
