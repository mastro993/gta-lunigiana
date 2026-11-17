// The sea closed from synthetic coastlines (coast.ts) over a 100 m box: the sea on the right of a
// line crossing it, a corner walked on the sea's side, an islet's hole, boxes wholly sea or land, a
// line along the box's edge, two seas apart, lines disagreeing on the sea's side; the chaining of
// OSM's ways; and the index's distances against every segment measured.
import assert from "node:assert/strict"
import { test } from "node:test"

import type { Area } from "../../sim/map/index.ts"
import { type CoastLine, coastIndex, coastLines, seaAreas } from "../coast.ts"
import { hash01, type P, pointInRing, segDist2, signedArea } from "../geometry.ts"
import type { Osm } from "../osm.ts"
import type { Rect } from "../region.ts"

const BOX: Rect = [0, 0, 100, 100]

/** An open chain through `pts`. */
const chain = (...pts: Array<P>): CoastLine => ({ pts, closed: false })
/** A closed ring through `pts`, the first repeated last. */
const ring = (...pts: Array<P>): CoastLine => ({ pts: [...pts, pts[0]!], closed: true })

/** A flat ring as points. */
const points = (r: ReadonlyArray<number>): Array<P> => {
  const out: Array<P> = []
  for (let i = 0; i < r.length; i += 2) out.push([r[i]!, r[i + 1]!])
  return out
}
/** An area's sea, m²: its outer ring less its holes. */
const seaOf = (a: Area) => a.rings.reduce((s, r) => s + signedArea(points(r)), 0)
/** The sea in `box`, its areas' total, m². */
const total = (areas: ReadonlyArray<Area>) => areas.reduce((s, a) => s + seaOf(a), 0)
/** Whether (x, y) lies in the sea of `areas`: in an outer ring and in none of its holes. */
const inSea = (areas: ReadonlyArray<Area>, x: number, y: number) =>
  areas.some(
    (a) => pointInRing(x, y, a.rings[0]!) && !a.rings.slice(1).some((h) => pointInRing(x, y, h)),
  )

test("a coastline across the box closes into one counter-clockwise sea ring on its right", () => {
  const east = seaAreas([chain([-10, 50], [40, 50], [110, 50])], [BOX])
  assert.equal(east.length, 1)
  assert.equal(east[0]!.kind, "sea")
  assert.equal(east[0]!.level, 0)
  assert.equal(east[0]!.rings.length, 1)
  assert.ok(signedArea(points(east[0]!.rings[0]!)) > 0, "counter-clockwise")
  assert.equal(total(east), 5000)
  assert.ok(inSea(east, 50, 25) && !inSea(east, 50, 75))
  // Drawn the other way, the sea is north.
  const west = seaAreas([chain([110, 50], [-10, 50])], [BOX])
  assert.equal(total(west), 5000)
  assert.ok(inSea(west, 50, 75) && !inSea(west, 50, 25))
})

test("the ring walks the box's corners on the sea's side, and none on the land's", () => {
  // In through the west edge, out through the north: the sea south-east of it.
  const se = seaAreas([chain([-10, 40], [60, 110])], [BOX])
  assert.equal(total(se), 10000 - (50 * 50) / 2)
  assert.deepEqual(
    new Set(points(se[0]!.rings[0]!).map((p) => p.join(","))),
    new Set(["0,50", "50,100", "100,100", "100,0", "0,0"]),
  )
  const nw = seaAreas([chain([60, 110], [-10, 40])], [BOX])
  assert.equal(total(nw), (50 * 50) / 2)
  assert.equal(nw[0]!.rings[0]!.length, 2 * 3)
})

test("an islet in the sea is a clockwise hole in it, though it covers the box's centre", () => {
  // The mainland north of the box, the sea south of it, and an islet over the centre.
  const islet = ring([30, 30], [70, 30], [70, 70], [30, 70])
  const areas = seaAreas([chain([-10, 150], [110, 150]), islet], [BOX])
  assert.equal(areas.length, 1)
  assert.equal(areas[0]!.rings.length, 2)
  assert.ok(signedArea(points(areas[0]!.rings[1]!)) < 0, "the hole runs clockwise")
  assert.equal(total(areas), 10000 - 1600)
  assert.ok(inSea(areas, 10, 10) && !inSea(areas, 50, 50))
  // An islet across the box's edge is cut there and walked like the mainland.
  const cut = seaAreas(
    [chain([-10, 150], [110, 150]), ring([80, 40], [120, 40], [120, 60], [80, 60])],
    [BOX],
  )
  assert.equal(total(cut), 10000 - 400)
  assert.equal(cut[0]!.rings.length, 1)
})

test("a box no coastline crosses is sea whole or land whole, by the side of the nearest", () => {
  const coast = [chain([-100, 150], [300, 150])]
  assert.equal(total(seaAreas(coast, [BOX])), 10000)
  assert.deepEqual(seaAreas(coast, [[0, 200, 100, 300]]), [])
  assert.deepEqual(seaAreas([], [BOX]), [])
  // Each box of several on its own: the land one adds nothing.
  assert.equal(seaAreas(coast, [BOX, [0, 200, 100, 300], [100, 0, 200, 100]]).length, 2)
})

test("a coastline along the box's edge leaves no spike on the ring", () => {
  // Down to the south edge, along it, and out: the sea west of the turn, the land east.
  const along = seaAreas([chain([-10, 50], [50, 50], [50, 0], [80, 0], [80, -10])], [BOX])
  assert.equal(total(along), 2500)
  assert.equal(along[0]!.rings[0]!.length, 2 * 4)
  // Along the whole south edge with the sea on the box's side, and on the other.
  assert.equal(total(seaAreas([chain([110, 0], [-10, 0])], [BOX])), 10000)
  assert.deepEqual(seaAreas([chain([-10, 0], [110, 0])], [BOX]), [])
})

test("two seas apart in one box are two areas", () => {
  // A strip of land from y 30 to 70 between them.
  const areas = seaAreas([chain([-10, 30], [110, 30]), chain([110, 70], [-10, 70])], [BOX])
  assert.equal(areas.length, 2)
  assert.deepEqual(areas.map(seaOf), [3000, 3000])
})

test("lines that disagree on the sea's side, or one that ends in the box, throw", () => {
  assert.throws(
    () => seaAreas([chain([-10, 30], [110, 30]), chain([-10, 70], [110, 70])], [BOX]),
    /disagree on the sea's side/,
  )
  assert.throws(() => seaAreas([chain([-10, 30], [50, 30])], [BOX]), /ends inside the box/)
})

test("seaward takes the right of the nearest segment, and at a vertex the turn there", () => {
  const left = coastIndex([chain([-10, 0], [0, 0], [0, 10])])
  assert.equal(left.seaward(5, -5), true) // outside the left turn
  assert.equal(left.seaward(-5, 5), false)
  assert.equal(left.seaward(-5, -1), true)
  const right = coastIndex([chain([-10, 0], [0, 0], [0, -10])])
  assert.equal(right.seaward(5, 5), false) // outside the right turn
  assert.equal(right.seaward(-5, -5), true)
  assert.equal(coastIndex([]).seaward(0, 0), false)
})

test("the index's distance is the nearest segment's, exactly, and capped", () => {
  // A wiggly coast of 300 segments and an islet, across 2 km.
  const coast: Array<P> = Array.from({ length: 301 }, (_, k) => [
    -1000 + (2000 * k) / 300,
    200 * hash01(k, 1) - 100,
  ])
  const islet = ring([300, -600], [340, -600], [320, -560])
  const lines = [chain(...coast), islet]
  const segments = lines.flatMap(({ pts }) => pts.slice(1).map((b, k) => [pts[k]!, b] as const))
  const index = coastIndex(lines)
  for (let k = 0; k < 2000; k++) {
    const x = -1500 + 3000 * hash01(k, 2),
      y = -1500 + 3000 * hash01(k, 3)
    const brute = Math.sqrt(
      Math.min(...segments.map(([a, b]) => segDist2(x, y, a[0], a[1], b[0], b[1]).d2)),
    )
    assert.equal(index.distance(x, y), brute, `${x}, ${y}`)
    assert.equal(index.distance(x, y, 300), Math.min(brute, 300), `${x}, ${y} capped`)
  }
  assert.equal(coastIndex([]).distance(0, 0, 17), 17)
})

/** An extract of `ways` (id → nodes) over nodes at (lat, lon) = (y, x), every way a coastline but `tags`'. */
const extract = (
  nodes: Record<string, P>,
  ways: Record<string, ReadonlyArray<string>>,
  tags: Record<string, Record<string, string>> = {},
): Osm => ({
  nodes: new Map(
    Object.entries(nodes).map(([id, [x, y]]) => [id, { id, lat: y, lon: x, tags: {} }]),
  ),
  ways: new Map(
    Object.entries(ways).map(([id, nds]) => [
      id,
      { id, nds, tags: tags[id] ?? { natural: "coastline" } },
    ]),
  ),
  relations: new Map(),
})
const identity = (lat: number, lon: number): P => [lon, lat]

test("coastLines chains the ways end to start in OSM's direction, then the rings", () => {
  const osm = extract(
    {
      1: [0, 0],
      2: [10, 0],
      3: [20, 0],
      4: [30, 5],
      5: [40, 5],
      7: [5, 5],
      8: [6, 5],
      9: [6, 6],
      10: [0, 9],
    },
    // Out of order: 30 runs on from 20, which runs on from 10; a closed islet; a road.
    {
      30: ["3", "4", "5"],
      10: ["1", "2"],
      20: ["2", "3"],
      40: ["7", "8", "9", "7"],
      50: ["1", "10"],
    },
    { 50: { highway: "track" } },
  )
  assert.deepEqual(coastLines(osm, identity), [
    {
      pts: [
        [0, 0],
        [10, 0],
        [20, 0],
        [30, 5],
        [40, 5],
      ],
      closed: false,
    },
    {
      pts: [
        [5, 5],
        [6, 5],
        [6, 6],
        [5, 5],
      ],
      closed: true,
    },
  ])
  // A ring of two ways is one closed line.
  const two = extract({ 1: [0, 0], 2: [10, 0], 3: [5, 5] }, { 1: ["1", "2"], 2: ["2", "3", "1"] })
  assert.deepEqual(coastLines(two, identity), [
    {
      pts: [
        [0, 0],
        [10, 0],
        [5, 5],
        [0, 0],
      ],
      closed: true,
    },
  ])
})

test("coastLines throws where the coastline branches or a node is missing", () => {
  const nodes: Record<string, P> = { 1: [0, 0], 2: [10, 0], 3: [20, 0] }
  assert.throws(
    () => coastLines(extract(nodes, { 1: ["1", "2"], 2: ["1", "3"] }), identity),
    /branches/,
  )
  assert.throws(() => coastLines(extract(nodes, { 1: ["1", "4"] }), identity), /node 4 missing/)
})
