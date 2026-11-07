import assert from "node:assert/strict"
import { test } from "node:test"

import { apartFrom, type Footprint, overlapShare } from "../overlap.ts"

/** The counter-clockwise flat ring of the `w` × `h` m rectangle from (x, y). */
const rect = (x: number, y: number, w: number, h = w) => [x, y, x + w, y, x + w, y + h, x, y + h]
const at = (x: number, y: number, w: number, h = w): Footprint => ({ outer: rect(x, y, w, h) })
/** An L of 2 m arms round the corner (x + 10, y + 10) of the 10 m square from (x, y), outside it: its vertex mean lies inside the square. */
const ell = (x: number, y: number): Footprint => ({
  outer: [x + 10, y, x + 12, y, x + 12, y + 12, x + 5, y + 12, x + 5, y + 10, x + 10, y + 10],
})

test("overlapShare is the share of the smaller footprint's area both cover, holes excluded", () => {
  assert.equal(overlapShare(at(0, 0, 10), at(0, 0, 10)), 1)
  assert.equal(overlapShare(at(0, 0, 10), at(5, 0, 10)), 0.5)
  assert.equal(overlapShare(at(0, 0, 10), at(6, 0, 10)), 0.4)
  assert.equal(overlapShare(at(0, 0, 40), at(10, 10, 5)), 1) // the smaller one, whole
  assert.equal(overlapShare(at(0, 0, 10), at(20, 0, 10)), 0)
  assert.equal(overlapShare(at(0, 0, 10), ell(0, 0)), 0) // they meet only along an edge
  // A house in a courtyard: the courtyard is no ground of the building round it.
  const court: Footprint = { outer: rect(0, 0, 30), holes: [[10, 10, 10, 20, 20, 20, 20, 10]] }
  assert.equal(overlapShare(court, at(11, 11, 8)), 0)
  // Anywhere on the map: pixels count from (0, 0), not from the footprints' corner.
  assert.equal(overlapShare(at(-6123.4, 1052.6, 10), at(-6118.4, 1052.6, 10)), 0.5)
})

// Regression: a later source's building was dropped only where its centroid lay in an earlier
// source's mapped area, so a 2019 CTR house outside its sheets' AZR stood twice at the Liguria
// border with the NC5's copy (-283940288538918 and -1475896793484707, overlap 1.00), and 22 OSM
// buildings in Fosdinovo's part stood over a CTR unit. A centroid test misses OSM 700763305 (646 m²)
// over 10 CTR units, and drops the CTR 2009 ruin -846894537277171 wrapped round a house's corner.
test("apartFrom drops a later footprint sharing half the smaller one's area with a kept one, and only that", () => {
  const kept = [at(0, 0, 10), at(100, 0, 4), at(106, 0, 4), at(200, 0, 10)]
  const later = [
    at(1, 1, 10), // 81 of its 100 m² over the first: a copy
    at(98, -2, 14), // larger, over two small kept ones
    at(206, 0, 10), // 40% of either: another building
    ell(200, 0), // round the fourth's corner, its vertex mean inside it: no ground in common
    at(300, 0, 10), // over none
  ]
  assert.deepEqual(apartFrom(kept, later), later.slice(2))
  assert.deepEqual(apartFrom([], later), later)
})
