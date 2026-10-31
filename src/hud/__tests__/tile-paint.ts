// The check minimap.test.ts (Monzone's tile, against the features within 1 km of it) and
// minimap.map-test.ts (two tiles, against the whole map) share: a tile's canvas, painted from only
// the features near it, gets every path a wider paint draws on it, in order.
import assert from "node:assert/strict"

import { TILE } from "../../sim/map/index.ts"
import { paintMap, tileReach } from "../minimap.ts"

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
      save: () => {},
      restore: () => {},
      clip: () => {},
      fill: (p: Points) => drawn.push(p),
      stroke: (p: Points) => drawn.push(p),
    },
    { set: () => true },
  )
  Object.assign(globalThis, { Path2D: Points })
  paintMap(ctx as unknown as CanvasRenderingContext2D, ...args)
  return drawn
}

/** A tile canvas's side, px. */
const SIDE = 602
/** Canvas px past its side a path may reach and still show: the widest stroke's half (a 12 m road drawn 1.6 times as wide, at 0.3 px/m). */
const PAD = 3

const onCanvas = (p: Points) => {
  const xs = p.pts.filter((_, k) => k % 2 === 0),
    ys = p.pts.filter((_, k) => k % 2 === 1)
  return (
    Math.min(...xs) <= SIDE + PAD &&
    Math.max(...xs) >= -PAD &&
    Math.min(...ys) <= SIDE + PAD &&
    Math.max(...ys) >= -PAD
  )
}

/**
 * Paints tile (i, j)'s canvas from the features `tileReach` gives it, and again from those
 * reaching `wider` (a map box, m; the whole map when left out), and checks the first draws every
 * path the second draws on the canvas, in order, and little more; the tile holds a village.
 */
export const checkTilePaint = (
  i: number,
  j: number,
  wider?: readonly [number, number, number, number],
): void => {
  const corner = { minX: i * TILE, maxY: (j + 1) * TILE }
  const all = painted(0.3, corner, { ox: 1, oy: 1, within: wider }).filter(onCanvas)
  const near = painted(0.3, corner, { ox: 1, oy: 1, within: tileReach(i, j) })
  assert.ok(all.length > 500, `${i}_${j} holds the village`)
  assert.deepEqual(near.filter(onCanvas), all, `${i}_${j}`)
  assert.ok(near.length < 1.2 * all.length, "and little more")
}
