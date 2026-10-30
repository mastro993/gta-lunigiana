import assert from "node:assert/strict"
import { test } from "node:test"

import { insideRings, ringsDistance } from "../../sim/map/outline.ts"
import { hash01, type V } from "../geometry.ts"
import {
  OUTLINE,
  clipLineTo,
  clipToPlay,
  inPlay,
  onOutline,
  outlineEdgeAt,
  outlineOf,
} from "../play-area.ts"
import { PARTS, type Part, type Rect } from "../region.ts"

/** A part of `rects`, with `mask` when given. */
const part = (rects: ReadonlyArray<Rect>, mask?: ReadonlyArray<number>): Part => ({
  key: "p",
  title: "P",
  rects,
  ...(mask === undefined ? {} : { mask }),
})

/** An L: a 200 by 100 m foot and a 100 by 200 m leg on its west half, the notch at its north-east. */
const L = [part([[0, 0, 200, 100]]), part([[0, 100, 100, 300]])]
const L_RING = [0, 0, 200, 0, 200, 100, 100, 100, 100, 300, 0, 300]

test("one rectangle's outline runs S, E, N, W from its south-west corner: lucido's is today's bounds", () => {
  const lucido = [-2900, -6100, 4900, -6100, 4900, 3900, -2900, 3900]
  assert.deepEqual(outlineOf(PARTS), [lucido])
  assert.deepEqual(OUTLINE, [lucido])
})

test("the outline of an L of two rectangles leaves out their seam", () => {
  assert.deepEqual(outlineOf(L), [L_RING])
  // one part with both rectangles: the same
  assert.deepEqual(
    outlineOf([
      part([
        [0, 0, 200, 100],
        [0, 100, 100, 300],
      ]),
    ]),
    [L_RING],
  )
})

test("overlapping rectangles make one ring round both", () => {
  assert.deepEqual(outlineOf([part([[0, 0, 100, 100]]), part([[50, 50, 150, 150]])]), [
    [0, 0, 100, 0, 100, 50, 150, 50, 150, 150, 50, 150, 50, 100, 0, 100],
  ])
  // one inside another adds nothing
  assert.deepEqual(outlineOf([part([[0, 0, 100, 100]]), part([[20, 20, 80, 80]])]), [
    [0, 0, 100, 0, 100, 100, 0, 100],
  ])
})

test("rectangles sharing a side make one rectangle, the side's collinear runs merged", () => {
  assert.deepEqual(outlineOf([part([[0, 0, 100, 100]]), part([[100, 0, 200, 100]])]), [
    [0, 0, 200, 0, 200, 100, 0, 100],
  ])
  // sharing part of a side: the longer side runs on past the shorter
  assert.deepEqual(outlineOf([part([[0, 0, 100, 100]]), part([[100, 20, 200, 60]])]), [
    [0, 0, 100, 0, 100, 20, 200, 20, 200, 60, 100, 60, 100, 100, 0, 100],
  ])
})

test("a diagonal mask is the outline of its part, and joins another part's rectangle where they cross", () => {
  const mask = [0, 0, 200, 0, 200, 50, 100, 100, 50, 300, 0, 300]
  assert.deepEqual(
    outlineOf([
      part(
        [
          [0, 0, 200, 100],
          [0, 100, 100, 300],
        ],
        mask,
      ),
    ]),
    [mask],
  )
  // a triangle and a rectangle across its long side, which cuts the rectangle's north side at x 70
  assert.deepEqual(
    outlineOf([part([[0, 0, 100, 100]], [0, 0, 100, 0, 0, 100]), part([[40, 0, 140, 30]])]),
    [[0, 0, 140, 0, 140, 30, 70, 30, 0, 100]],
  )
  // a crossing off the 0.1 m lattice is rounded to it
  assert.deepEqual(
    outlineOf([part([[0, 0, 100, 100]], [0, 0, 100, 0, 0, 100]), part([[40, 0, 140, 33.33]])]),
    [[0, 0, 140, 0, 140, 33.3, 66.7, 33.3, 0, 100]],
  )
})

test("a hole is a clockwise ring, after the outer ring; rings touching at a corner stay apart", () => {
  const frame = [
    part([[0, 0, 300, 100]]),
    part([[0, 200, 300, 300]]),
    part([[0, 100, 100, 200]]),
    part([[200, 100, 300, 200]]),
  ]
  assert.deepEqual(outlineOf(frame), [
    [0, 0, 300, 0, 300, 300, 0, 300],
    [100, 100, 100, 200, 200, 200, 200, 100],
  ])
  assert.deepEqual(outlineOf([part([[0, 0, 100, 100]]), part([[100, 100, 200, 200]])]), [
    [0, 0, 100, 0, 100, 100, 0, 100],
    [100, 100, 200, 100, 200, 200, 100, 200],
  ])
})

test("inPlay, onOutline and outlineEdgeAt answer for the play area: lucido's rectangle", () => {
  assert.ok(inPlay(0, 0) && inPlay(4900, 3900) && inPlay(-2900, 0))
  assert.ok(!inPlay(4900.01, 0) && !inPlay(0, -6100.01))
  assert.ok(inPlay(4895, 0, 5) && !inPlay(4895.01, 0, 5) && !inPlay(-2898.8, 0, 1.3))
  assert.ok(onOutline(4899.95, 0, 0.06) && !onOutline(4899.9, 0, 0.06))
  assert.deepEqual(outlineEdgeAt(4900, 10, 1e-6), [4900, -6100, 4900, 3900])
  assert.deepEqual(outlineEdgeAt(10, -6100, 1e-6), [-2900, -6100, 4900, -6100])
  assert.equal(outlineEdgeAt(4899, 10, 1e-6), undefined)
})

test("insideRings: margins round a reflex corner are discs, beside an edge bands; an edge is inside", () => {
  const rings = [L_RING]
  // 7.07 m from the notch's corner (100, 100), beside neither of its edges
  assert.ok(insideRings(rings, 95, 95, 7) && !insideRings(rings, 95, 95, 7.1))
  // 3 m under the notch's south side, 3 m west of its west side
  assert.ok(insideRings(rings, 150, 97, 3) && !insideRings(rings, 150, 97, 3.01))
  assert.ok(insideRings(rings, 97, 150, 3) && !insideRings(rings, 97, 150, 3.01))
  assert.ok(!insideRings(rings, 105, 105) && !insideRings(rings, 150, 100.001))
  for (const [x, y] of [
    [150, 100],
    [100, 250],
    [200, 50],
    [0, 300],
    [100, 100],
  ] as const)
    assert.ok(insideRings(rings, x, y), `${x}, ${y} on the outline`)
  assert.equal(ringsDistance(rings, 95, 95), Math.hypot(5, 5))
  assert.equal(ringsDistance(rings, 150, 97), 3)
})

const v = (x: number, y: number, id?: string): V => ({ x, y, ...(id === undefined ? {} : { id }) })

test("the L's notch cuts a line through it into two pieces: ids on the original vertices, none on the cuts", () => {
  const rings = [L_RING]
  // a bend in the notch
  assert.deepEqual(clipLineTo(rings, [v(50, 250, "a"), v(150, 150, "b"), v(180, 50, "c")]), [
    [v(50, 250, "a"), v(100, 200)],
    [v(165, 100), v(180, 50, "c")],
  ])
  // one segment across it
  const [foot, leg] = clipLineTo(rings, [v(180, 50, "a"), v(50, 250, "b")])
  assert.deepEqual(foot, [v(180, 50, "a"), v(180 - 130 * 0.25, 100)])
  assert.equal(leg!.length, 2)
  assert.equal(leg![0]!.x, 100)
  assert.equal(leg![0]!.id, undefined)
  assert.deepEqual(leg![1], v(50, 250, "b"))
  // along the outline is inside; wholly in the notch is nothing
  assert.deepEqual(clipLineTo(rings, [v(100, 150, "a"), v(100, 250, "b")]), [
    [v(100, 150, "a"), v(100, 250, "b")],
  ])
  assert.deepEqual(clipLineTo(rings, [v(150, 150, "a"), v(190, 290, "b")]), [])
})

test("a line past a reflex corner within a micrometre stays whole: both its sides are in play", () => {
  const rings = [L_RING]
  // through the notch's corner (100, 100), and up to 1 µm inside it or into the notch
  for (const eps of [0, 1e-7, 5e-7, 1e-6, -5e-7]) {
    const pts = [v(50, 150 - eps, "a"), v(150, 50 - eps, "b")]
    assert.deepEqual(clipLineTo(rings, pts), [pts], `${eps}`)
  }
  // a mask's reflex vertex between two slanted edges, met where float rounding parts the crossings
  const mask = [[0, 0, 300, 0, 300, 300, 150, 120, 0, 300]]
  for (const [ax, ay, bx, by] of [
    [50.00000493480215, 119.96858407398088, 249.99999506519785, 120.03141592601912],
    [50.00001110330474, 119.95287611194026, 249.99998889669524, 120.04712388805974],
  ] as const) {
    const pts = [v(ax, ay, "a"), v(bx, by, "b")]
    assert.deepEqual(clipLineTo(mask, pts), [pts])
  }
})

/** Liang–Barsky to a box per segment, consecutive inside parts merged: the clipping before the play area's outline. */
const liangBarsky = (
  [X0, Y0, X1, Y1]: readonly [number, number, number, number],
  pts: ReadonlyArray<V>,
): Array<Array<V>> => {
  const out: Array<Array<V>> = []
  let cur: Array<V> = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!,
      b = pts[i]!
    const dx = b.x - a.x,
      dy = b.y - a.y
    let t0 = 0,
      t1 = 1,
      ok = true
    for (const [p, q] of [
      [-dx, a.x - X0],
      [dx, X1 - a.x],
      [-dy, a.y - Y0],
      [dy, Y1 - a.y],
    ] as const) {
      if (p === 0) {
        if (q < 0) ok = false
        continue
      }
      const r = q / p
      if (p < 0) t0 = Math.max(t0, r)
      else t1 = Math.min(t1, r)
    }
    if (!ok || t1 <= t0) {
      if (cur.length > 1) out.push(cur)
      cur = []
      continue
    }
    if (cur.length === 0) cur.push(t0 === 0 ? a : { x: a.x + t0 * dx, y: a.y + t0 * dy })
    cur.push(t1 === 1 ? b : { x: a.x + t1 * dx, y: a.y + t1 * dy })
    if (t1 < 1) {
      out.push(cur)
      cur = []
    }
  }
  if (cur.length > 1) out.push(cur)
  return out
}

test("clipping to one rectangle's outline is Liang–Barsky's, to the bit, on random lines", () => {
  const box = [-2900, -6100, 4900, 3900] as const
  const rings = [[-2900, -6100, 4900, -6100, 4900, 3900, -2900, 3900]]
  // Coordinates near the box, a fifth of them on one of its sides or corners.
  const coord = (k: number, lo: number, hi: number) => {
    const h = hash01(k, 1)
    if (h < 0.1) return lo
    if (h < 0.2) return hi
    return lo - 300 + (hi - lo + 600) * hash01(k, 2)
  }
  let pieces = 0
  for (let line = 0; line < 4000; line++) {
    const pts = Array.from({ length: 2 + Math.floor(hash01(line, 3) * 5) }, (_, i) =>
      v(
        coord(line * 16 + 2 * i, box[0], box[2]),
        coord(line * 16 + 2 * i + 1, box[1], box[3]),
        `${i}`,
      ),
    )
    const want = liangBarsky(box, pts)
    pieces += want.length
    assert.deepEqual(clipLineTo(rings, pts), want, JSON.stringify(pts))
    assert.deepEqual(clipToPlay(pts), liangBarsky(box, pts))
  }
  assert.ok(pieces > 2000, `${pieces} pieces`)
  // through a corner, along a side, from and to a side, a point, a repeated vertex
  for (const pts of [
    [v(-3000, -6200, "a"), v(-2800, -6000, "b")],
    [v(-2900, -7000, "a"), v(-2900, 0, "b"), v(-2900, 5000, "c")],
    [v(0, 3900, "a"), v(10, 4000, "b"), v(20, 3900, "c"), v(30, 3800, "d")],
    [v(0, 0, "a"), v(0, 0, "b"), v(10, 10, "c")],
    [v(-2900, -6100, "a"), v(4900, 3900, "b")],
    // into the box past its north-east corner, crossing x 4900 a micrometre north of it
    [v(4946.846429937269, 3900.001225046605, "a"), v(4839.09964108155, 3899.9984074394133, "b")],
    [v(-2900.001394850508, -6085.315484118628, "a"), v(-2899.99818669434, -6119.089870645784, "b")],
  ])
    assert.deepEqual(clipLineTo(rings, pts), liangBarsky(box, pts), JSON.stringify(pts))
})
