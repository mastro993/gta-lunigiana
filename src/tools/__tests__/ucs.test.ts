import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type TestContext, test } from "node:test"
import { gzipSync } from "node:zlib"

import { fillPolygon, segDist2 } from "../../sim/collide.ts"
import { gaussBoagaToLatLon, latLonToGaussBoaga, latLonToUtm32, utm32ToLatLon } from "../crs.ts"
import { centroid, fromLocal, type P, toLocal } from "../geometry.ts"
import { kindOfCode, readUcs, ucsAreas } from "../ucs.ts"

/** A closed square ring [e, n, …] of side `s` from (e, n). */
const square = (e: number, n: number, s: number) => [e, n, e + s, n, e + s, n + s, e, n + s, e, n]

/** Writes a land cover file as fetch-rt (`EPSG:3003`) and fetch-lig (`EPSG:25832`) do; its path. */
const file = (
  t: TestContext,
  crs: string,
  polygons: ReadonlyArray<{ id: number; code: string; rings: Array<Array<number>> }>,
): string => {
  const dir = mkdtempSync(join(tmpdir(), "ucs-"))
  t.after(() => rmSync(dir, { recursive: true }))
  const path = join(dir, "cover.json.gz")
  writeFileSync(path, gzipSync(JSON.stringify({ crs, year: 2025, polygons })))
  return path
}

test("readUcs reads Tuscany's EPSG:3003 and Liguria's EPSG:25832 by each file's crs, classes by their first three digits", (t) => {
  // Two 100 m squares inside lucido's box (the default TERRAIN_BOX), one in each CRS.
  const [ge, gn] = latLonToGaussBoaga(...fromLocal(0, 0)),
    [ue, un] = latLonToUtm32(...fromLocal(500, 500))
  const tuscany = file(t, "EPSG:3003", [{ id: 7, code: "332", rings: [square(ge, gn, 100)] }])
  const liguria = file(t, "EPSG:25832", [
    { id: 57712, code: "131", rings: [square(ue, un, 100)] },
    { id: 23568, code: "5121", rings: [square(ue + 200, un, 100)] }, // a natural basin: 512
    { id: 29266, code: "5111", rings: [square(ue + 400, un, 100)] }, // a river's bed: not kept
  ])
  const areas = readUcs([tuscany, liguria])
  assert.deepEqual(
    areas.map((a) => a.kind),
    ["rock", "quarry", "lake"],
  )
  const near = (ring: ReadonlyArray<number>, [x, y]: readonly [number, number]) => {
    const [cx, cy] = centroid(ring)
    return Math.hypot(cx - x, cy - y) < 0.2
  }
  assert.ok(near(areas[0]!.rings[0]!, toLocal(...gaussBoagaToLatLon(ge + 50, gn + 50))))
  assert.ok(near(areas[1]!.rings[0]!, toLocal(...utm32ToLatLon(ue + 50, un + 50))))
  const elsewhere = file(t, "EPSG:4326", [])
  assert.throws(() => readUcs([elsewhere]), /land cover in EPSG:4326/)
})

test("kindOfCode: olive groves (223) and vineyards (221); Liguria's vines mixed with olives and abandoned olive groves are olive groves, its abandoned vines no kept class", () => {
  assert.equal(kindOfCode("223"), "olive")
  assert.equal(kindOfCode("221"), "vineyard")
  assert.equal(kindOfCode("2211"), "olive") // vigneti misti ad oliveti
  assert.equal(kindOfCode("2231"), "olive") // oliveti abbandonati
  assert.equal(kindOfCode("2212"), undefined) // vigneti e/o altre colture permanenti abbandonate
  assert.equal(kindOfCode("3115"), "forest") // castagno: a broadleaf wood, by its third level
  assert.equal(kindOfCode("222"), undefined) // frutteti
})

test("readUcs reads Liguria's fourth-level codes as kindOfCode does", (t) => {
  const [e, n] = latLonToUtm32(...fromLocal(0, 0))
  const liguria = file(t, "EPSG:25832", [
    { id: 1, code: "2211", rings: [square(e, n, 100)] },
    { id: 2, code: "2212", rings: [square(e + 200, n, 100)] },
    { id: 3, code: "2231", rings: [square(e + 400, n, 100)] },
    { id: 4, code: "221", rings: [square(e + 600, n, 100)] },
  ])
  assert.deepEqual(
    readUcs([liguria]).map((a) => a.kind),
    ["olive", "olive", "vineyard"],
  )
})

test("readUcs reads a polygon two parts' files hold once, and every polygon of a multipolygon", (t) => {
  const [e, n] = latLonToUtm32(...fromLocal(0, 0))
  // A multipolygon: one entry a polygon, under the same id.
  const polygons = [
    { id: 1, code: "332", rings: [square(e, n, 100)] },
    { id: 1, code: "332", rings: [square(e + 200, n, 100)] },
    { id: 2, code: "131", rings: [square(e + 400, n, 100)] },
  ]
  // The next part's file: what the WFS gives for its box, the multipolygon whole and one more.
  const a = file(t, "EPSG:25832", polygons),
    b = file(t, "EPSG:25832", [
      ...polygons.slice(0, 2),
      { id: 3, code: "131", rings: [square(e + 600, n, 100)] },
    ])
  assert.equal(readUcs([a]).length, 3)
  assert.equal(readUcs([a, b]).length, 4)
  assert.equal(readUcs([b, a]).length, 4)
  // Tuscany's ids are another file's, in another CRS.
  const [ge, gn] = latLonToGaussBoaga(...fromLocal(0, 0))
  const tuscany = file(t, "EPSG:3003", [{ id: 1, code: "332", rings: [square(ge, gn, 100)] }])
  assert.equal(readUcs([a, tuscany]).length, 4)
})

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
