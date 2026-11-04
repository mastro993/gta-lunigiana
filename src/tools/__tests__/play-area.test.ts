import assert from "node:assert/strict"
import { test } from "node:test"

import { hash01, r1, type V } from "../geometry.ts"
import {
  OUTLINE,
  clipBeyond,
  clipLineTo,
  clipPieces,
  heldInPlay,
  inPlay,
  onOutline,
  outlineEdgeAt,
  outlineOf,
} from "../play-area.ts"
import { PARTS, type Part, partOf, type Rect, rectRing, regionFromArgs } from "../region.ts"

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

/** Lucido's rectangle, the region's first part, and Fivizzano's mask, the part beside it. */
const LUCIDO = partOf("lucido"),
  FIVIZZANO = partOf("fivizzano")
const [LX0, LY0, LX1, LY1] = LUCIDO.rects[0]!

/** A flat ring's area, positive counter-clockwise. */
const areaOf = (ring: ReadonlyArray<number>) => {
  let a = 0
  for (let i = 0, n = ring.length; i < n; i += 2)
    a += ring[i]! * ring[(i + 3) % n]! - ring[(i + 2) % n]! * ring[i + 1]!
  return a / 2
}

test("one rectangle's outline runs S, E, N, W from its south-west corner: lucido's is its rectangle", () => {
  assert.deepEqual(outlineOf([LUCIDO]), [[LX0, LY0, LX1, LY0, LX1, LY1, LX0, LY1]])
})

test("the region's outline is one ring round lucido's rectangle and Fivizzano's mask, from lucido's south-west corner", () => {
  assert.deepEqual(OUTLINE, outlineOf(PARTS))
  assert.equal(OUTLINE.length, 1)
  const ring = OUTLINE[0]!
  assert.deepEqual(ring.slice(0, 4), [LX0, LY0, LX1, LY0])
  // The parts meet along their seams alone, so the union's area is theirs summed.
  assert.ok(
    Math.abs(areaOf(ring) - areaOf(rectRing(LUCIDO.rects[0]!)) - areaOf(FIVIZZANO.mask!)) < 1,
  )
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

test("a hole touching the outer ring, or another hole, at a corner is a ring of its own", () => {
  // the frame's north-east corner square left out: its hole meets the outside at (200, 200)
  const frame = [
    part([[0, 0, 300, 100]]),
    part([[0, 100, 100, 300]]),
    part([[100, 200, 200, 300]]),
    part([[200, 100, 300, 200]]),
  ]
  assert.deepEqual(outlineOf(frame), [
    [0, 0, 300, 0, 300, 200, 200, 200, 200, 300, 0, 300],
    [100, 100, 100, 200, 200, 200, 200, 100],
  ])
  // the hole's south-west and north-east quarters filled: two holes meeting at (150, 150)
  const pinched = [
    part([[0, 0, 300, 100]]),
    part([[0, 200, 300, 300]]),
    part([[0, 100, 100, 200]]),
    part([[200, 100, 300, 200]]),
    part([[100, 100, 150, 150]]),
    part([[150, 150, 200, 200]]),
  ]
  assert.deepEqual(outlineOf(pinched), [
    [0, 0, 300, 0, 300, 300, 0, 300],
    [150, 100, 150, 150, 200, 150, 200, 100],
    [100, 150, 100, 200, 150, 200, 150, 150],
  ])
})

test("inPlay, onOutline and outlineEdgeAt answer for the play area: lucido's outer sides on the outline, its seams inside", () => {
  // Lucido's east side is the outline from its south-east corner up to where Fivizzano's leg starts.
  const ring = OUTLINE[0]!,
    leg = ring[5]!,
    y = (LY0 + leg) / 2
  assert.deepEqual(ring.slice(2, 6), [LX1, LY0, LX1, leg])
  assert.ok(leg < LY1)
  assert.ok(inPlay(0, 0) && inPlay(LX1, y) && inPlay(LX0, 0) && inPlay(0, LY0))
  assert.ok(!inPlay(LX1 + 0.01, y) && !inPlay(0, LY0 - 0.01) && !inPlay(LX0 - 0.01, 0))
  assert.ok(inPlay(LX1 - 5, y, 5) && !inPlay(LX1 - 4.99, y, 5) && !inPlay(LX0 + 1.2, 0, 1.3))
  assert.ok(onOutline(LX1, y) && onOutline(0, LY0) && !onOutline(LX1 - 0.1, y))
  assert.deepEqual(outlineEdgeAt(LX1, y, 1e-6), [LX1, LY0, LX1, leg])
  assert.deepEqual(outlineEdgeAt(10, LY0, 1e-6), [LX0, LY0, LX1, LY0])
  assert.equal(outlineEdgeAt(LX1 - 1, y, 1e-6), undefined)
  // Its seams with Fivizzano lie inside, off the outline: its north side, and its east side north
  // of the leg's start.
  for (const [x, sy] of [
    [0, LY1],
    [LX1, (leg + LY1) / 2],
  ] as const) {
    assert.ok(inPlay(x, sy, 50) && !onOutline(x, sy), `${x}, ${sy}`)
    assert.equal(outlineEdgeAt(x, sy, 1e-6), undefined)
  }
})

test("onOutline finds a line's end cut on a slanted edge and rounded to 0.1 m: a rail terminal", () => {
  const rings = [[0, 0, 1000, 0, 1000, 937.3]]
  // up to 0.05·√2 m off the edge once rounded, as flatLine writes it: (0.15, 0.1406) to (0.2, 0.1)
  for (let k = 1; k < 1999; k++) {
    const x = r1((1000 * k) / 1999),
      y = r1((937.3 * k) / 1999)
    assert.ok(onOutline(x, y, rings), `${x}, ${y}`)
  }
  assert.ok(onOutline(0.2, 0.1, rings) && onOutline(1.4, 1.5, [[0, 0, 1000, 0, 1000, 1003.7]]))
  assert.ok(!onOutline(500, 0.1, rings) && !onOutline(999.9, 400, rings))
})

test("heldInPlay keeps a level crossing or platform whole by its centroid, as buildings are kept", () => {
  /** A 10 m square centred on (x, y), with a hole. */
  const square = (src: string, x: number, y: number) => ({
    src,
    rings: [
      [x - 5, y - 5, x + 5, y - 5, x + 5, y + 5, x - 5, y + 5],
      [x - 1, y - 1, x - 1, y + 1, x + 1, y + 1, x + 1, y - 1],
    ],
  })
  const kept = heldInPlay(
    [
      square("in the leg", 50, 200),
      square("in the notch", 150, 200),
      square("across the notch's side, centre in", 98, 200),
      square("across the notch's side, centre out", 102, 200),
    ],
    [L_RING],
  )
  assert.deepEqual(
    kept.map((a) => a.src),
    ["in the leg", "across the notch's side, centre in"],
  )
  assert.deepEqual(kept[1]!.rings, square("", 98, 200).rings)
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

test("each piece of a clipped line knows how far along the whole line it starts", () => {
  const rings = [L_RING]
  const pieces = clipPieces(rings, [v(50, 250, "a"), v(150, 150, "b"), v(180, 50, "c")])
  assert.deepEqual(
    pieces.map((p) => p.pts),
    clipLineTo(rings, [v(50, 250, "a"), v(150, 150, "b"), v(180, 50, "c")]),
  )
  // The foot's piece starts at (165, 100), half way down the second segment.
  const [leg, foot] = pieces.map((p) => p.from)
  assert.equal(leg, 0)
  assert.ok(Math.abs(foot! - (Math.hypot(100, 100) + Math.hypot(30, 100) / 2)) < 1e-9, `${foot}`)
  // A line starting in the notch: its one piece starts where it enters the leg.
  const [entered] = clipPieces(rings, [v(150, 250, "a"), v(50, 250, "b")])
  assert.equal(entered!.from, 50)
})

test("outside, clipPieces keeps what the area leaves out, and clipBeyond what of it the region's box holds", () => {
  const rings = [L_RING]
  const line = [v(50, 250, "a"), v(150, 150, "b"), v(180, 50, "c")]
  // the bend in the notch, between where the line leaves the leg and enters the foot
  const [notch, ...rest] = clipPieces(rings, line, true)
  assert.deepEqual(rest, [])
  assert.deepEqual(notch!.pts, [v(100, 200), v(150, 150, "b"), v(165, 100)])
  assert.ok(Math.abs(notch!.from - Math.hypot(50, 50)) < 1e-9, `${notch!.from}`)
  // along the outline is in, so not out
  assert.deepEqual(clipPieces(rings, [v(100, 150, "a"), v(100, 250, "b")], true), [])
  // From past the box's west side across its notch west of lucido into lucido: the notch's stretch,
  // from the box's side to lucido's, 100 m along the line
  const { minX } = regionFromArgs([]).bounds
  assert.ok(minX < LX0 && !inPlay((minX + LX0) / 2, 0))
  assert.deepEqual(clipBeyond([v(minX - 100, 0, "a"), v(0, 0, "b"), v(LX1 - 100, LY0, "c")]), [
    { pts: [v(minX, 0), v(LX0, 0)], from: 100 },
  ])
  // wholly in the play area, nothing
  assert.deepEqual(clipBeyond([v(0, 0, "a"), v(LX1, LY1, "b")]), [])
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
  // lucido's rectangle, the cases below on its sides and corners
  const box: Rect = [LX0, LY0, LX1, LY1]
  assert.deepEqual([...box], [-2900, -6100, 4900, 3900])
  const rings = outlineOf([LUCIDO])
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
