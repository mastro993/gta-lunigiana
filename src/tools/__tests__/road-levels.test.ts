import assert from "node:assert/strict"
import { test } from "node:test"

import type { RoadF } from "../features.ts"
import type { V } from "../geometry.ts"
import type { Linear } from "../profiles.ts"
import { passesOver, roadLevels, TWINS } from "../road-levels.ts"

const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })
const road = (
  id: number,
  cls: RoadF["cls"],
  pts: ReadonlyArray<V>,
  more: Partial<RoadF> = {},
): RoadF => ({
  id,
  cls,
  w: 6,
  surface: "asphalt",
  private: false,
  pts,
  ...more,
})
// Ground flat at 100 m. A motorway bridge along y 0 over x 0–200 crosses three local roads at
// x 50, 100 and 150; a trunk tunnel along y 50 runs under a residential street at x 100; a service
// road at grade crosses a service tunnel (a car park's ramp) at x 300.
const motorway = road(1, "motorway", [v(0, 0), v(200, 0)], { bridge: true })
const under = road(2, "residential", [v(50, -30), v(50, 30)])
const tagged = road(3, "residential", [v(100, -30), v(100, 30)], { maxheight: 3.2 })
const path = road(4, "path", [v(150, -30), v(150, 30)])
const trunk = road(5, "trunk", [v(0, 50), v(200, 50)], { tunnel: true })
const street = road(6, "residential", [v(100, 20), v(100, 80)])
const square = road(7, "service", [v(300, -30), v(300, 30)])
const ramp = road(8, "service", [v(270, 0), v(330, 0)], { tunnel: true })
// A footway at grade over a car park's aisle (2.1 m clear) at x 400; a footbridge over a residential
// street at x 500; a path at grade over a path's underpass at x 600; a footbridge over a path at x 700.
const footway = road(9, "path", [v(400, -30), v(400, 30)])
const aisle = road(10, "service", [v(370, 0), v(430, 0)], { tunnel: true, maxheight: 2.1 })
const footbridge = road(11, "path", [v(470, 0), v(530, 0)], { bridge: true })
const lane = road(12, "residential", [v(500, -30), v(500, 30)])
const over = road(13, "path", [v(600, -30), v(600, 30)])
const underpass = road(14, "path", [v(570, 0), v(630, 0)], { tunnel: true })
const steps = road(15, "steps", [v(670, 0), v(730, 0)], { bridge: true })
const below = road(16, "path", [v(700, -30), v(700, 30)])
const roads = [
  motorway,
  under,
  tagged,
  path,
  trunk,
  street,
  square,
  ramp,
  footway,
  aisle,
  footbridge,
  lane,
  over,
  underpass,
  steps,
  below,
]
const make = (fitted: ReadonlyArray<RoadF>) =>
  roadLevels({
    roads,
    ground: () => 100,
    fitted: (l: Linear) => fitted.includes(l as RoadF),
    zAt: () => 110,
  })
const zs = (bounds: ReadonlyArray<{ readonly z: number; readonly kind?: string }>) => [
  ...new Set(bounds.map((b) => `${b.kind} ${b.z.toFixed(1)}`)),
]

test("passesOver: a bridge or a road over a tunnel, on a higher OSM level", () => {
  assert.equal(passesOver({ bridge: true }, {}), true)
  assert.equal(passesOver({}, { tunnel: true }), true)
  assert.equal(passesOver({ bridge: true, layer: 1 }, { bridge: true, layer: 2 }), false)
  assert.equal(passesOver({}, {}), false)
})

// Regression: Cesena's roads crossed under its bridges with 1.25 m to spare, and a service road ran 1.6 m under a slip road
// whose bridge the junction under it held down.
test("roadLevels: a road under a bridge keeps maxheight (4 m untagged) plus a 1.5 m deck; a bridge or tunnel in an earlier pass keeps it from the other's natural level", () => {
  // A path at grade follows the terrain: no road's bridge over one is bound. A path's bridge or
  // tunnel keeps a person's clearance (2.5 m) from a path, a vehicle's from a road.
  assert.deepEqual(
    make([]).over.map((o) => [o.up.id, o.down.id, o.clear]),
    [
      [1, 2, 5.5],
      [1, 3, 4.7],
      [6, 5, 5.5],
      [7, 8, 5.5],
      [9, 10, 3.6],
      [11, 12, 5.5],
      [13, 14, 4],
      [15, 16, 4],
    ],
  )
  // The motorway, fitted first, rises 5.5 m (4.7 m over the tagged road) and 0.3 m of slack over the
  // local roads' natural level, at the crossing and 2 m either side; its own tunnel dips as far under
  // the street's.
  assert.deepEqual(zs(make([]).bounds([{ item: motorway }])), ["min 105.8", "min 105.0"])
  assert.equal(make([]).bounds([{ item: motorway }]).length, 6)
  assert.deepEqual(zs(make([]).bounds([{ item: trunk }])), ["max 94.2"])
  // A local road fitted after it dips under the fitted deck, and the street under the trunk's...
  assert.deepEqual(zs(make([motorway]).bounds([{ item: under }])), ["max 104.5"])
  assert.deepEqual(zs(make([motorway]).bounds([{ item: tagged }])), ["max 105.3"])
  // ...but a road at grade never rises over a tunnel, and one pass fits the square and its ramp
  // in either order: the ramp dips under the square only once the square is fitted.
  assert.deepEqual(make([trunk]).bounds([{ item: street }]), [])
  assert.deepEqual(make([ramp]).bounds([{ item: square }]), [])
  assert.deepEqual(make([]).bounds([{ item: ramp }]), [])
  assert.deepEqual(zs(make([square]).bounds([{ item: ramp }])), ["max 104.5"])
})

// Regression: the aisles of Aulla's covered car park (1452661267, 1452913566, 1452913567: maxheight
// 2.1) ran 0.4–2.1 m under the footways over them, and its paths' bridges and underpasses ran
// straight between their ends at the terrain's level, 0.6 m under to 0.4 m over what they cross.
test("roadLevels: a road's tunnel dips under a path at grade over it; a path's bridge or tunnel, fitted after every road, keeps its clearance from the way it crosses and binds no road", () => {
  // The aisle 2.1 m plus the deck under the footway's natural level, less the slack.
  assert.deepEqual(zs(make([]).bounds([{ item: aisle }])), ["max 96.1"])
  // A footbridge 5.5 m over the fitted street; the street takes nothing from it.
  assert.deepEqual(zs(make([lane]).bounds([{ item: footbridge }])), ["min 115.5"])
  assert.deepEqual(make([]).bounds([{ item: lane }]), [])
  // A path's underpass and bridge keep a person's 2.5 m and the deck from a path at grade's natural level.
  assert.deepEqual(zs(make([]).bounds([{ item: underpass }])), ["max 95.7"])
  assert.deepEqual(zs(make([]).bounds([{ item: steps }])), ["min 104.3"])
})

test("roadLevels: a path's bridge ending on a road's deck of its OSM level takes the deck's level there", () => {
  // A primary road's 10 m bridge along y 0 over x 0–100; a sidewalk drawn as its own 1.5 m bridge
  // 5.5 m beside it (their carriageways overlap by 0.25 m), from x 50 to 150, past the road's end.
  const deck = road(30, "primary", [v(0, 0), v(100, 0)], { bridge: true, w: 10 })
  const sidewalk = road(31, "path", [v(50, 5.5), v(150, 5.5)], { bridge: true, w: 1.5 })
  const { deckUnder } = roadLevels({
    roads: [deck, sidewalk],
    ground: () => 100,
    fitted: (l: Linear) => l === deck,
    zAt: () => 110,
  })
  assert.equal(deckUnder(sidewalk.pts[0]!, sidewalk), 110)
  assert.equal(deckUnder(sidewalk.pts[1]!, sidewalk), undefined, "past the deck's end")
  assert.equal(deckUnder(sidewalk.pts[0]!, { ...sidewalk, layer: 2 }), undefined, "over it")
})

// Regression: the SR445's loop at Gassano runs under its own bridge 13.6 m from where it leaves it;
// one chain held both, so neither was bound and the bridge stood 0.85 m over the loop.
test("roadLevels: a chain over itself is bound from one natural level, the bridge clear over the road below it", () => {
  // Ground flat at 100 m. A bridge from E to W, then a loop from W round south and back north,
  // under the bridge 14 m from W; the same loop, at grade, over a tunnel that leaves it.
  const loop = (bridge: boolean) => {
    const over = road(10, "primary", [v(80, 0, "E"), v(0, 0, "W")], bridge ? { bridge: true } : {})
    const under = road(
      11,
      "primary",
      [v(0, 0, "W"), v(-30, -30), v(0, -60), v(14, -30), v(14, 20)],
      bridge ? {} : { tunnel: true },
    )
    const levels = roadLevels({
      roads: [over, under],
      ground: () => 100,
      fitted: () => false,
      zAt: () => 110,
    })
    const bounds = levels.bounds([{ item: over }, { item: under }])
    assert.equal(bounds.length, 6, "the crossing and 2 m either side, on each road")
    return zs(bounds)
  }
  // The road below stays at most 0.3 m over its natural level, and the bridge 5.5 m over that...
  assert.deepEqual(loop(true), ["max 100.3", "min 105.8"])
  // ...or, over its own tunnel, the road at grade keeps 0.3 m under its natural level at least,
  // the tunnel 5.5 m under that.
  assert.deepEqual(loop(false), ["max 94.2", "min 99.7"])
})

// Regression: the A15's two carriageways north of the Aulla junction (136455102, 491154922), each
// fitted alone, overlap in plan by up to 2.8 m with their decks 1.2–2.7 m apart, and each one's
// parapet stopped the cars on the other.
test("roadLevels: two oneway carriageways of one road overlapping in plan keep within TWINS of each other there, the one fitted second bound", () => {
  // Two 10 m motorway carriageways of the A15 9 m apart (their carriageways overlap by 1 m), and
  // one of the A12 another 9 m on; and the A15's second carriageway once more, sharing a node.
  const a = road(20, "motorway", [v(0, 0, "a0"), v(200, 0)], { oneway: true, ref: "A15", w: 10 })
  const b = road(21, "motorway", [v(0, 9), v(200, 9)], { oneway: true, ref: "A15", w: 10 })
  const c = road(22, "motorway", [v(0, 18), v(200, 18)], { oneway: true, ref: "A12", w: 10 })
  const joined = road(23, "motorway", [v(0, 0, "a0"), v(0, 9), v(200, 9)], {
    oneway: true,
    ref: "A15",
    w: 10,
  })
  const levels = (all: ReadonlyArray<RoadF>, fitted: ReadonlyArray<RoadF>) =>
    roadLevels({
      roads: all,
      ground: () => 100,
      fitted: (l: Linear) => fitted.includes(l as RoadF),
      zAt: () => 110,
    })
  const bound = levels([a, b, c], [a]).bounds([{ item: b }])
  assert.deepEqual(zs(bound), [
    `min ${(110 - TWINS).toFixed(1)}`,
    `max ${(110 + TWINS).toFixed(1)}`,
  ])
  assert.equal(bound.length, 2 * 101, "both bounds every 2 m along the 200 m it overlaps")
  assert.deepEqual(levels([a, b, c], []).bounds([{ item: b }]), [], "the first not fitted yet")
  assert.deepEqual(levels([a, b, c], [b]).bounds([{ item: c }]), [], "another road's")
  assert.deepEqual(levels([a, joined], [a]).bounds([{ item: joined }]), [], "a node shared")
})
