import assert from "node:assert/strict"
import { test } from "node:test"

import { fillPolygon, segDist2 } from "../../sim/collide.ts"
import type { P } from "../geometry.ts"
import { ucsAreas } from "../ucs.ts"

/** The 2 m pixels of [0, 1600)² that `areas` fill (even-odd within each, OR across them), from the local origin. */
const BLOCK = { c0: 0, r0: 0, cols: 800, rows: 800 }
const filled = (areas: ReadonlyArray<{ readonly rings: ReadonlyArray<ReadonlyArray<number>> }>) => {
  const mask = new Uint8Array(BLOCK.cols * BLOCK.rows)
  for (const { rings } of areas) fillPolygon(rings, 0, 0, 2, BLOCK, (k) => (mask[k] = 1))
  return mask
}

// A wood across four 500 m squares and their seams, bent into an L, with a clearing across the
// x = 500 seam and a hole wholly in one square.
const OUTER: Array<P> = [
  [100, 100],
  [1400, 120],
  [1380, 700],
  [800, 690],
  [820, 1450],
  [90, 1430],
]
const HOLES: Array<Array<P>> = [
  [
    [440, 300],
    [440, 380],
    [560, 380],
    [560, 300],
  ],
  [
    [150, 1000],
    [150, 1100],
    [300, 1100],
    [300, 1000],
  ],
]

/** Distance from (x, y) to the nearest edge of `rings`, m. */
const toEdge = (rings: ReadonlyArray<ReadonlyArray<P>>, x: number, y: number) => {
  let d2 = Infinity
  for (const ring of rings)
    for (let k = 0; k < ring.length; k++) {
      const [ax, ay] = ring[k]!,
        [bx, by] = ring[(k + 1) % ring.length]!
      d2 = Math.min(d2, segDist2(x, y, ax, ay, bx, by).d2)
    }
  return Math.sqrt(d2)
}

test("ucsAreas: a wood comes in pieces on the 500 m squares, 4 m past each, filling the pixels the whole wood fills but by its edges", () => {
  const pieces = ucsAreas("forest", OUTER, HOLES)
  assert.ok(pieces.length >= 6, `${pieces.length} pieces`)
  let west = 0,
    south = 0
  for (const { kind, rings } of pieces) {
    assert.equal(kind, "forest")
    const xs = rings[0]!.filter((_, k) => k % 2 === 0),
      ys = rings[0]!.filter((_, k) => k % 2 === 1)
    const i = Math.floor((Math.min(...xs) + 4) / 500),
      j = Math.floor((Math.min(...ys) + 4) / 500)
    assert.ok(Math.max(...xs) <= 500 * (i + 1) + 4 && Math.max(...ys) <= 500 * (j + 1) + 4)
    // Reaching 4 m past its square's west or south side where the wood runs on past it.
    if (i > 0 && Math.min(...xs) === 500 * i - 4) west++
    if (j > 0 && Math.min(...ys) === 500 * j - 4) south++
  }
  assert.ok(
    west >= 3 && south >= 3,
    `${west} pieces reach past a west side, ${south} past a south one`,
  )
  const [whole] = ucsAreas("rock", OUTER, HOLES)
  assert.equal(ucsAreas("rock", OUTER, HOLES).length, 1, "an open cover stays whole")
  // A cut rounds the points where it crosses an edge to 0.1 m (`flatRing`), moving the edge by at
  // most 5 cm there: only a pixel whose centre lies that close to the wood's edge may differ.
  const cut = filled(pieces),
    uncut = filled([whole!])
  let differ = 0
  for (let k = 0; k < cut.length; k++) {
    if (cut[k] === uncut[k]) continue
    differ++
    const x = 2 * (k % BLOCK.cols) + 1,
      y = 2 * Math.floor(k / BLOCK.cols) + 1
    assert.ok(toEdge([OUTER, ...HOLES], x, y) < 0.06, `(${x}, ${y})`)
  }
  assert.ok(differ < 40, `${differ} pixels differ`)
})

test("ucsAreas: a clearing wider than a piece stays clear in every piece, whichever vertex its ring starts at and whichever way it runs", () => {
  // A wood 2 km square round a clearing of 1.8 km: some pieces lie wholly in the clearing, their
  // cut holes with no vertex off the pieces' edges.
  const outer: Array<P> = [
    [0, 0],
    [1600, 0],
    [1600, 1600],
    [0, 1600],
  ]
  const ring: Array<P> = [
    [100, 100],
    [100, 1500],
    [1500, 1500],
    [1500, 100],
  ]
  for (const way of [ring, [...ring].reverse()])
    for (let start = 0; start < way.length; start++) {
      const hole = [...way.slice(start), ...way.slice(0, start)]
      const mask = filled(ucsAreas("forest", outer, [hole]))
      let wooded = 0
      for (let r = 75; r < 725; r++)
        for (let c = 75; c < 725; c++) wooded += mask[r * BLOCK.cols + c]!
      assert.equal(
        wooded,
        0,
        `the ring from ${hole[0]!.join(", ")}, ${way === ring ? "clockwise" : "anticlockwise"}`,
      )
    }
})
