import assert from "node:assert/strict"
import { test } from "node:test"

import { anchorOf, LANE, laneOffset, laneWidth, SHOULDER, tileKey, tilesRound } from "../kinds.ts"

/** An L of tiles: i −2…1 by j 0…1 less its notch, tiles (0, 1) and (1, 1). */
const L = new Set(["-2_0", "-1_0", "0_0", "1_0", "-2_1", "-1_1"])
const inL = (i: number, j: number) => L.has(tileKey(i, j))

test("tilesRound: the listed tiles of the nearest ring round an unlisted tile holding any, in key order", () => {
  const keys = (i: number, j: number) => tilesRound(i, j, inL).map(([ti, tj]) => tileKey(ti, tj))
  assert.deepEqual(keys(0, 1), ["-1_0", "0_0", "1_0", "-1_1"])
  assert.deepEqual(keys(1, 1), ["0_0", "1_0"])
  // the first two rings round (3, 3) hold none
  assert.deepEqual(keys(3, 3), ["0_0", "1_0"])
  assert.throws(() => tilesRound(0, 0, () => false), /no listed tile/)
})

test("anchorOf: the region's anchor and its column and row, the first node where the map names none", () => {
  const hm = { cell: 4, x0: -900, y0: -4100 }
  assert.deepEqual(anchorOf({ ...hm, ax: -2900, ay: -6100 }), {
    x: -2900,
    y: -6100,
    i: -500,
    j: -500,
  })
  assert.deepEqual(anchorOf({ ...hm, ax: -100, ay: 3900 }), { x: -100, y: 3900, i: 200, j: 2000 })
  assert.deepEqual(anchorOf(hm), { x: -900, y: -4100, i: 0, j: 0 })
})

test("laneOffset: a oneway 11 m motorway's lane lies inside its right lane, left of the hard shoulder", () => {
  // Two LANE-wide lanes, then the SHOULDER, from the left: lane 2 runs from 1 m left of the
  // centreline to 2.5 m right of it (right is positive).
  const w = 11,
    right = { from: w / 2 - SHOULDER - LANE, to: w / 2 - SHOULDER }
  const side = laneOffset({ cls: "motorway", w, oneway: true })
  const truck = 2.45 // the widest model's body (vehicles.ts)
  assert.ok(side - truck / 2 >= right.from && side + truck / 2 <= right.to, `lane at ${side} m`)
  // Two-way roads keep w/4 + 0.2 (a 5 m road's 1.45 m), narrower ones 0.5 m.
  assert.equal(laneOffset({ cls: "tertiary", w: 5 }), 1.45)
  assert.equal(laneOffset({ cls: "service", w: 3.5 }), 0.5)
  // A oneway road narrower than a lane drives on its centreline, a wider one in its right lane.
  assert.equal(laneOffset({ cls: "service", w: 3.5, oneway: true }), 0)
  assert.equal(laneOffset({ cls: "unclassified", w: 5, oneway: true }), 0.75)
})

test("laneWidth: a main road's lanes tag gives LANE per lane, plus a motorway's shoulder; other classes keep their default", () => {
  assert.equal(laneWidth("primary", 2), 7)
  assert.equal(laneWidth("motorway", 2), 10)
  assert.equal(laneWidth("tertiary", 2), undefined)
})
