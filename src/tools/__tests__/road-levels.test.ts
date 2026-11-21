import assert from "node:assert/strict"
import { test } from "node:test"

import { footReach } from "../../sim/map/kinds.ts"
import type { Linear } from "../chains.ts"
import { CORRIDOR, walkSide } from "../deck-space.ts"
import type { RoadF } from "../features.ts"
import type { V } from "../geometry.ts"
import type { Bound } from "../profiles.ts"
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
  // A path's bridge or tunnel, or a path at grade under a road's bridge, keeps a person's clearance
  // (2.5 m) from a path, a vehicle's from a road.
  assert.deepEqual(
    make([]).over.map((o) => [o.up.id, o.down.id, o.clear]),
    [
      [1, 2, 5.5],
      [1, 3, 4.7],
      [1, 4, 4],
      [6, 5, 5.5],
      [7, 8, 5.5],
      [9, 10, 3.6],
      [11, 12, 5.5],
      [13, 14, 4],
      [15, 16, 4],
    ],
  )
  // The motorway, fitted first, rises 5.5 m (4.7 m over the tagged road) and 0.3 m of slack over the
  // local roads' natural level, every 2 m across their 6 m carriageways and 2 m past them (7
  // samples a crossing, 6 m either side), but over the path at grade, which dips under it
  // (`clearances`); its own tunnel dips as far under the street's.
  assert.deepEqual(zs(make([]).bounds([{ item: motorway }])), ["min 105.8", "min 105.0"])
  assert.equal(make([]).bounds([{ item: motorway }]).length, 2 * 7)
  assert.deepEqual(zs(make([]).bounds([{ item: trunk }])), ["max 94.2"])
  // A local road fitted after it dips under the fitted deck, and the street under the trunk's...
  assert.deepEqual(zs(make([motorway]).bounds([{ item: under }])), ["max 104.5"])
  assert.deepEqual(zs(make([motorway]).bounds([{ item: tagged }])), ["max 105.3"])
  // ...but a road at grade never rises over a tunnel, and one pass fits the square and its ramp
  // in either order: fitted first, the ramp dips under the square's natural level, as under a later
  // pass's road (issue #20: fitted first and bound by nothing, the A15's slip road 1364364906 stood
  // 0.36 m over the A12's 23487716 at grade over it), and fitted after it under its level.
  assert.deepEqual(make([trunk]).bounds([{ item: street }]), [])
  assert.deepEqual(make([ramp]).bounds([{ item: square }]), [])
  assert.deepEqual(zs(make([]).bounds([{ item: ramp }])), ["max 94.2"])
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

// Regression: a path or steps at grade under a road's bridge kept the ground's level there, which
// the deck's approaches' cores lifted: the steps 374756566 ran 1.23 m under the A15's deck at Santo
// Stefano di Magra, and the path 205452561 2.25 m under the A12's, 6 m over its natural level.
test("roadLevels: a path or steps at grade keeps its clearance under a fitted bridge over it and over a fitted tunnel under it, across the other's carriageway", () => {
  // Under the motorway's 6 m deck at 110 m, 4 m (a person's 2.5 m and the deck) every 2 m along it
  // as far off the deck's line as its walk walls read a way under it, and a step of 2 m past that.
  const kept = make([motorway]).clearances().get(path)!,
    walls = walkSide(motorway) + footReach(path.cls, path.w) + CORRIDOR
  assert.deepEqual(zs(kept), ["max 106.0"])
  const ys = kept.map((b) => b.y)
  assert.deepEqual(
    ys,
    ys.map((_, k) => 2 * k + ys[0]!),
  )
  assert.ok(ys[0]! <= -walls && ys.at(-1)! >= walls, `${ys} past ${walls}`)
  assert.ok(ys[0]! >= -walls - 4 && ys.at(-1)! <= walls + 4, `${ys} within a step past ${walls}`)
  // Over the fitted underpass, the same clearance over it; unfitted, none.
  assert.deepEqual(zs(make([underpass]).clearances().get(over)!), ["min 114.0"])
  assert.equal(make([]).clearances().has(over), false)
  assert.equal(make([]).clearances().has(path), false)
  // A road at grade keeps its own pass's bounds (`bounds`), never these.
  assert.equal(make([motorway]).clearances().has(under), false)
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
    assert.equal(bounds.length, 2 * 7, "across the other's carriageway, on each road")
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

// Regression (review of #19): the A15's Parma carriageway's bridge at Calcinara (136414830) overlaps
// its twin's (31135803) midway alone; its ends, bound through it along its slope before the fit,
// stood 5.1 m under its twin's and 5.4 m over it, and its approach sagged 8.1 m under it.
test("roadLevels: a carriageway's deck or bore overlapping its twin anywhere keeps its ends within TWINS of the twin's level abeam of them", () => {
  // A 10 m carriageway's bridge along y 0, fitted climbing 5% east; its twin's, of two pieces, from
  // (50, 12) to (150, 12) by (100, 9), overlapping it only round x 100.
  const shared = { oneway: true, ref: "A15", w: 10, bridge: true } as const
  const a = road(60, "motorway", [v(0, 0), v(200, 0)], shared)
  const b0 = road(61, "motorway", [v(50, 12, "b0"), v(100, 9, "j")], shared)
  const b1 = road(62, "motorway", [v(100, 9, "j"), v(150, 12, "b1")], shared)
  const bounds = roadLevels({
    roads: [a, b0, b1],
    ground: () => 100,
    fitted: (l: Linear) => l === a,
    zAt: (_, s) => 100 + 0.05 * s,
  }).bounds([{ item: b0 }, { item: b1 }])
  // Its ends alone, each within TWINS of the twin's level abeam of it (102.5 and 107.5 m).
  assert.deepEqual(
    bounds.map((b) => [b.x, b.y, b.kind, b.z.toFixed(2), b.on]),
    [
      [50, 12, "min", (102.5 - TWINS).toFixed(2), b0],
      [50, 12, "max", (102.5 + TWINS).toFixed(2), b0],
      [150, 12, "min", (107.5 - TWINS).toFixed(2), b1],
      [150, 12, "max", (107.5 + TWINS).toFixed(2), b1],
    ],
  )
})

// Regression (review of #19): the A15's bridge 136455101 kept 5.5 m over the track 491154920 under
// it at the crossing of their centrelines alone, and 5.23 m 5 m from it, under the deck's edge.
test("roadLevels: a way crossing another on two levels keeps the clearance across the other's carriageway, from its level there", () => {
  // Ground flat at 100 m. A 12 m motorway along y 0, fitted climbing 5% east, crossed at x 100 by
  // a residential road at 45°: the motorway a bridge over the road, or the road a bridge over it.
  const lane = (bridge: boolean) =>
    road(52, "residential", [v(70, -30), v(130, 30)], bridge ? { bridge: true } : {})
  const bounds = (deck: boolean) => {
    const motorway = road(
        50,
        "motorway",
        [v(0, 0), v(200, 0)],
        deck ? { bridge: true, w: 12 } : { w: 12 },
      ),
      other = lane(!deck)
    return roadLevels({
      roads: [motorway, other],
      ground: () => 100,
      fitted: (l: Linear) => l === motorway,
      zAt: (_, s) => 100 + 0.05 * s,
    }).bounds([{ item: other }])
  }
  // Wherever the road runs under or over the motorway's carriageway (6 m either side of its
  // centreline, 8.5 m along the road at 45°) and SPREAD (2 m) past that, it keeps 5.5 m from the
  // motorway's level abeam of it: under its deck, or over it on its own.
  const reach = (b: ReadonlyArray<Bound>) => Math.max(...b.map((p) => Math.hypot(p.x - 100, p.y)))
  for (const [deck, kind, clear] of [
    [true, "max", -5.5],
    [false, "min", 5.5],
  ] as const) {
    const b = bounds(deck)
    assert.ok(reach(b) >= 6 * Math.SQRT2 + 2, `reaches ${reach(b).toFixed(1)} m`)
    for (const p of b) {
      assert.equal(p.kind, kind)
      assert.ok(Math.abs(p.z - (100 + 0.05 * p.x + clear)) < 1e-9, `${p.z} at ${p.x}`)
    }
  }
})

// Regression (review of #19): a path's tunnel over a road's took no clearance from it, nor one bore
// over another of its own pass fitted before it: only a bridge rose over a fitted way below.
test("roadLevels: a tunnel over a fitted way's tunnel rises its clearance over it", () => {
  // Ground flat at 100 m: a bore along y 0 at layer −2, fitted at 90 m, crossed at x 50 by one at
  // layer −1.
  const bores = (upper: RoadF["cls"], lower: RoadF["cls"]) => {
    const low = road(40, lower, [v(0, 0), v(100, 0)], { tunnel: true, layer: -2 })
    const high = road(41, upper, [v(50, -50), v(50, 50)], { tunnel: true, layer: -1 })
    const levels = roadLevels({
      roads: [low, high],
      ground: () => 100,
      fitted: (l: Linear) => l === low,
      zAt: () => 90,
    })
    return zs(levels.bounds([{ item: high }]))
  }
  // A road's bore under it keeps a vehicle's 4 m, a path's a person's 2.5 m, and the deck.
  assert.deepEqual(bores("path", "residential"), ["min 95.5"])
  assert.deepEqual(bores("path", "path"), ["min 94.0"])
  assert.deepEqual(bores("residential", "residential"), ["min 95.5"])
})
