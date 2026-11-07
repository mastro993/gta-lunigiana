import assert from "node:assert/strict"
import { test } from "node:test"

import type { SurveyBuilding } from "../ctr.ts"
import {
  extractAreas,
  extractBuildings,
  extractPois,
  extractRoads,
  extractWater,
} from "../features.ts"
import { fromLocal, hash01, type V } from "../geometry.ts"
import type { Osm, Tags } from "../osm.ts"
import { localOf, sheet2k, surveyId } from "../survey-ids.ts"

/** An OSM extract with one two-node way per tag set, along y = 10 · its index. */
const osmOf = (ways: ReadonlyArray<Tags>): Osm => {
  const nodes: Osm["nodes"] = new Map(),
    out: Osm["ways"] = new Map()
  ways.forEach((tags, k) => {
    for (const end of [0, 1]) {
      const [lat, lon] = fromLocal(end * 50, k * 10)
      nodes.set(`${k}:${end}`, { id: `${k}:${end}`, lat, lon, tags: {} })
    }
    out.set(`${k + 1}`, { id: `${k + 1}`, nds: [`${k}:0`, `${k}:1`], tags })
  })
  return { nodes, ways: out, relations: new Map() }
}
/**
 * An empty OSM extract and `square`, which adds a closed way round the `side` m square from
 * (x, y), counter-clockwise, with `tags`, and returns its id.
 */
const areaOsm = () => {
  const osm: Osm = { nodes: new Map(), ways: new Map(), relations: new Map() }
  const square = (x: number, y: number, side: number, tags: Tags = {}): string => {
    const id = `${osm.ways.size + 1}`
    const corners: ReadonlyArray<readonly [number, number]> = [
      [x, y],
      [x + side, y],
      [x + side, y + side],
      [x, y + side],
    ]
    const nds = corners.map(([cx, cy], k) => {
      const [lat, lon] = fromLocal(cx, cy)
      osm.nodes.set(`${id}:${k}`, { id: `${id}:${k}`, lat, lon, tags: {} })
      return `${id}:${k}`
    })
    osm.ways.set(id, { id, nds: [...nds, nds[0]!], tags })
    return id
  }
  return { osm, square }
}
/** No clip: each way whole. */
const whole = (pts: ReadonlyArray<V>) => [{ pts: [...pts], from: 0 }]

test("extractRoads: each link folds into the class below and keeps its oneway; a main road's lanes give its width", () => {
  const roads = extractRoads(
    osmOf([
      { highway: "motorway", oneway: "yes" },
      { highway: "motorway", oneway: "yes", lanes: "3" },
      { highway: "motorway_link", oneway: "yes" },
      { highway: "trunk_link", oneway: "yes", lanes: "1" },
      { highway: "primary", lanes: "2" },
      { highway: "primary_link", oneway: "yes" },
      { highway: "secondary_link" },
      { highway: "tertiary", lanes: "2" },
    ]),
    whole,
  )
  assert.deepEqual(
    roads.map((r) => [r.cls, r.w, r.oneway === true]),
    [
      ["motorway", 11, true],
      ["motorway", 13.5, true], // 3 lanes × 3.5 m and the 3 m shoulder
      ["primary", 7, true],
      ["primary", 3.5, true],
      ["primary", 7, false], // the SR445: 2 lanes × 3.5 m
      ["secondary", 6.5, true],
      ["tertiary", 6.5, false],
      ["tertiary", 6.5, false], // a tertiary road keeps its class width
    ],
  )
})

test("extractRoads: a motorway, its links and a roundabout are oneway unless tagged otherwise; a motorway's or trunk road's link is a ramp", () => {
  const roads = extractRoads(
    osmOf([
      { highway: "motorway" },
      { highway: "motorway", oneway: "no" },
      { highway: "motorway_link" },
      { highway: "secondary", junction: "roundabout", lanes: "1" },
      { highway: "trunk_link" },
      { highway: "primary_link" },
    ]),
    whole,
  )
  assert.deepEqual(
    roads.map((r) => [r.cls, r.w, r.oneway === true, r.ramp === true]),
    [
      ["motorway", 11, true, false],
      ["motorway", 11, false, false],
      ["primary", 7, true, true],
      ["secondary", 3.5, true, false], // a one-lane roundabout, driven one way round
      ["primary", 7, false, true],
      ["secondary", 6.5, false, false],
    ],
  )
})

// Regression: OSM draws Pieve San Lorenzo's platform as two `highway=footway` lines along its
// edge (ways 1442184593 and 1442184594), tagged railway=platform: the platform, not a path beside
// the track.
test("extractRoads: a highway drawn as a line and tagged railway=platform is the platform, no road", () => {
  const roads = extractRoads(
    osmOf([{ highway: "footway", railway: "platform" }, { highway: "footway" }]),
    whole,
  )
  assert.deepEqual(
    roads.map((r) => [r.id, r.cls]),
    [[2, "path"]],
  )
})

// Regression: an edit glued four streams' junctions 0.008–0.073 m from their next node (the Torrente
// Mommio's 788514676 at (6132.2, 9771.2)), so the shipped line, rounded to 0.1 m, repeated a vertex.
test("extractWater, extractRoads: two nodes in a row on one 0.1 m point are one vertex, the one another way shares", () => {
  const osm: Osm = { nodes: new Map(), ways: new Map(), relations: new Map() }
  for (const [id, x, y] of [
    ["j", 10.02, 5.01], // a junction of the two streams
    ["a", 10.04, 5.03], // 0.03 m on, the same 0.1 m point
    ["b", 30, 5],
    ["c", 10, 40],
    ["d", 10.01, 5.04], // 0.03 m short of the junction
    ["r0", 0, 20],
    ["r1", 40.01, 20.02],
    ["r2", 40.03, 20.04], // neither shared: the first stays
  ] as const) {
    const [lat, lon] = fromLocal(x, y)
    osm.nodes.set(id, { id, lat, lon, tags: {} })
  }
  const way = (id: string, nds: ReadonlyArray<string>, tags: Tags) =>
    osm.ways.set(id, { id, nds, tags })
  way("1", ["j", "a", "b"], { waterway: "stream" })
  way("2", ["c", "d", "j"], { waterway: "stream" })
  way("3", ["r0", "r1", "r2"], { highway: "track" })
  const ids = (lines: ReadonlyArray<{ readonly pts: ReadonlyArray<V> }>) =>
    lines.map((l) => l.pts.map((v) => v.id))
  assert.deepEqual(ids(extractWater(osm, () => 0, whole)), [
    ["j", "b"],
    ["c", "j"],
  ])
  assert.deepEqual(ids(extractRoads(osm, whole)), [["r0", "r1"]])
})

// Regression: OSM maps the Canale di Campiglia's pass under the line by Gassano as a culvert (way
// 865496237), where the CTR surveys a 6.7 m rail bridge and the orthophotos show its channel open
// under the span; dropped, the stream's two ends dug the bank beside the bridge, under the track.
test("extractWater: a culvert is dropped but where `open` says it runs in the open, under a bridge", () => {
  const osm = osmOf([
    { waterway: "stream", tunnel: "culvert" },
    { waterway: "stream", tunnel: "culvert", name: "Canale di Campiglia" },
    { waterway: "stream" },
  ])
  const water = extractWater(
    osm,
    () => 0,
    whole,
    (pts) => pts[0]!.y > 5,
  )
  assert.deepEqual(
    water.map((w) => [w.id, w.w]),
    [
      [2, 4],
      [3, 2],
    ],
  )
})

test("extractAreas: a river's banks are a river, still water a lake, other water nothing; ruins win over water, shingle is a river's pebble", () => {
  const { osm, square } = areaOsm()
  const tagged: ReadonlyArray<Tags> = [
    { natural: "water", water: "river" },
    { waterway: "riverbank" },
    { natural: "water", water: "lake" },
    { natural: "water", water: "reservoir" },
    { natural: "water", water: "pond" },
    { natural: "water", water: "basin" },
    { natural: "water" },
    { natural: "water", water: "wastewater" },
    { historic: "ruins", natural: "water", water: "reservoir" },
    { natural: "shingle" },
    { natural: "scree" },
  ]
  // The k-th tag set on the 20 m square from x = 40 · k.
  tagged.forEach((tags, k) => square(40 * k, 0, 20, tags))
  const areas = extractAreas(osm)
  assert.deepEqual(
    areas.map((a) => [
      Math.round(Math.min(...a.rings[0]!.filter((_, i) => i % 2 === 0)) / 40),
      a.kind,
    ]),
    [
      [0, "river"],
      [1, "river"],
      [2, "lake"],
      [3, "lake"],
      [4, "lake"],
      [5, "lake"],
      [6, "lake"], // natural=water with no water tag
      // 7, wastewater: no area
      [8, "ruins"],
      [9, "pebble"],
      [10, "scree"],
    ],
  )
  assert.ok(areas.every((a) => a.level === undefined))
})

test("extractAreas: an orchard of olive trees is an olive grove, and one with no trees tag too below 600 m of the ground given (Lunigiana's), none without it", () => {
  const { osm, square } = areaOsm()
  square(0, 0, 20, { landuse: "orchard", trees: "olive_trees" })
  square(40, 0, 20, { landuse: "orchard" })
  square(80, 0, 20, { landuse: "orchard", trees: "apple_trees" })
  square(1000, 0, 20, { landuse: "orchard" }) // up the hill
  square(1000, 40, 20, { landuse: "orchard", trees: "olive_trees" })
  // An orchard across the 600 m line: its outer ring's mean ground decides.
  square(470, 80, 60, { landuse: "orchard" })
  // The ground climbs to 700 m at x = 500: the orchard at x 470–530 means 600 m, not below it.
  const ground = (x: number) => (x < 500 ? 500 : 700)
  const kinds = (areas: ReturnType<typeof extractAreas>) =>
    areas.map((a) => [Math.round(Math.min(...a.rings[0]!.filter((_, i) => i % 2 === 0))), a.kind])
  assert.deepEqual(kinds(extractAreas(osm, ground)), [
    [0, "olive"],
    [40, "olive"],
    // 80: an apple orchard, no area
    // 1000: an orchard with no trees tag 700 m up, likelier chestnuts: no area
    [1000, "olive"],
  ])
  // Cesena's orchards with no trees tag are Romagna's fruit: no ground, no olive grove.
  assert.deepEqual(kinds(extractAreas(osm)), [
    [0, "olive"],
    [1000, "olive"],
  ])
  square(470, 200, 60, { landuse: "orchard" })
  const lower = (x: number) => (x < 500 ? 500 : 699)
  assert.deepEqual(kinds(extractAreas(osm, lower)).at(-1), [470, "olive"])
})

test("extractAreas: a lake's ele is its level to the decimetre, a river's ele none", () => {
  const { osm, square } = areaOsm()
  square(0, 0, 20, { natural: "water", water: "lake", ele: "1150" })
  square(40, 0, 20, { natural: "water", water: "reservoir", ele: "455.26" })
  square(80, 0, 20, { natural: "water", water: "pond", ele: "high" })
  square(120, 0, 20, { natural: "water", water: "river", ele: "1150" })
  square(160, 0, 20, { waterway: "riverbank", ele: "1150" })
  assert.deepEqual(
    extractAreas(osm).map((a) => [a.kind, a.level]),
    [
      ["lake", 1150],
      ["lake", 455.3],
      ["lake", undefined],
      ["river", undefined],
      ["river", undefined],
    ],
  )
})

test("extractAreas: a multipolygon lake's inner ring is a hole, wound clockwise, and its ele its level", () => {
  const { osm, square } = areaOsm()
  const outer = square(200, 100, 40),
    inner = square(210, 110, 20)
  osm.relations.set("1", {
    id: "1",
    tags: { type: "multipolygon", natural: "water", water: "lake", ele: "212.46" },
    members: [
      { type: "way", ref: outer, role: "outer" },
      { type: "way", ref: inner, role: "inner" },
    ],
  })
  assert.deepEqual(extractAreas(osm), [
    {
      kind: "lake",
      rings: [
        [200, 100, 240, 100, 240, 140, 200, 140],
        [210, 130, 230, 130, 230, 110, 210, 110],
      ],
      level: 212.5,
    },
  ])
})

test("extractPois: a named pond is an area:lake, a named river polygon an area:river", () => {
  const { osm, square } = areaOsm()
  square(100, 100, 20, { natural: "water", water: "pond", name: "Lago Verde" })
  square(200, 100, 20, { waterway: "riverbank", name: "Magra" })
  assert.deepEqual(
    extractPois(osm).map((p) => [p.kind, p.name, p.x, p.y]),
    [
      ["area:lake", "Lago Verde", 110, 110],
      ["area:river", "Magra", 210, 110],
    ],
  )
})

// Regression: Fosdinovo's restaurant compound by Canepari (way 1496142522, amenity=restaurant,
// building=no) stood as a 2,060 m² block 6 m tall over its house, and a pool's pergola (697022823,
// building=roof) as a closed 6 m box. OSM's building=no is no building, and a roof is open at ground
// level, as the surveys' canopies are (ctr.ts).
test("extractBuildings, extractAreas: an outline tagged building=no or building=roof is no building, and its area kind counts", () => {
  const { osm, square } = areaOsm()
  square(0, 0, 20, { building: "no", amenity: "restaurant" })
  square(40, 0, 20, { building: "roof" })
  square(80, 0, 20, { building: "yes" })
  square(120, 0, 20, { building: "no", landuse: "residential" })
  square(160, 0, 20, { building: "yes", landuse: "residential" })
  const outer = square(200, 0, 20)
  osm.relations.set("1", {
    id: "1",
    tags: { type: "multipolygon", building: "no", landuse: "farmyard" },
    members: [{ type: "way", ref: outer, role: "outer" }],
  })
  const { held, beyond } = extractBuildings(osm, { buildings: [], roadAreas: [], mapped: [] })
  assert.deepEqual(
    [...held, ...beyond].map((b) => b.id),
    [3, 5],
  )
  assert.deepEqual(
    extractAreas(osm).map((a) => [a.rings[0]![0], a.kind]),
    [
      [120, "residential"],
      [200, "farmyard"],
    ],
  )
})

// Regression: 22 OSM buildings of Fosdinovo's part stood over a 2019 CTR unit outside the CTR's
// mapped area (OSM 599910941 over -284056254555558 at (-5305, 1394), overlap 1.00), and main's map
// held 42 such pairs: an OSM building was dropped only where its centroid lay in a mapped area.
test("extractBuildings: an OSM building sharing half the smaller one's area with a surveyed one is dropped, wherever the survey maps the ground", () => {
  const { osm, square } = areaOsm()
  square(0, 0, 10, { building: "house" }) // 80% on the first survey unit
  square(96, -4, 18, { building: "yes" }) // larger, all of the second under it
  square(206, 0, 10, { building: "shed" }) // 40% on the third: a building of its own
  square(300, 0, 10, { building: "house" }) // on none
  const unit = (id: number, x: number, w = 10): SurveyBuilding => ({
    id,
    kind: "house",
    h: 6,
    outer: [x, 0, x + w, 0, x + w, w, x, w],
  })
  const { held, beyond } = extractBuildings(osm, {
    buildings: [unit(-1, 2), unit(-2, 100, 8), unit(-3, 200)],
    roadAreas: [],
    mapped: [], // the survey maps none of this ground
  })
  assert.deepEqual(
    [...held, ...beyond].map((b) => b.id).sort((a, b) => a - b),
    [-3, -2, -1, 3, 4],
  )
})

test("extractBuildings: a surveyed building's tint is the one its 2019 CTR id always gave, in any section", () => {
  // The 2019 ids were -(sheet · 1e5 + layer base (AED 0, AGE 5e4) + index) - polygon · 1e7, and the
  // tint hashed -id % 1e9: each record below, in three sections, a 10 m square round Monzone.
  const records = [
    [11, 0, 0, 0],
    [20, 0, 234, 0],
    [54, 5e4, 574, 0],
    [19, 0, 7, 3],
  ] as const
  const buildings = records.flatMap(([sheet, base, index, k], i) =>
    ["23D", "22D", "24C"].map((section, j): SurveyBuilding => {
      const [x, y] = [20 * i, 20 * j]
      return {
        id: surveyId(
          "ctr2019",
          sheet2k(`${section}${sheet}`).section,
          localOf(sheet * 1e5 + base + index, k),
        ),
        kind: "house",
        h: 6,
        outer: [x, y, x + 10, y, x + 10, y + 10, x, y + 10],
      }
    }),
  )
  const osm: Osm = { nodes: new Map(), ways: new Map(), relations: new Map() }
  const { held, beyond } = extractBuildings(osm, { buildings, roadAreas: [], mapped: [] })
  const tints = new Map([...held, ...beyond].map((b) => [b.id, b.tint]))
  const old = records.flatMap(([sheet, base, index, k]) => {
    const id = -(sheet * 1e5 + base + index) - k * 1e7
    return [0, 1, 2].map(() => Math.floor(hash01(-id % 1e9, 7) * 4)) // the same in each section
  })
  assert.deepEqual(
    buildings.map((b) => tints.get(b.id)),
    old,
  )
})
