import assert from "node:assert/strict"
import { test } from "node:test"

import { extractAreas, extractPois, extractRoads } from "../features.ts"
import { fromLocal, type V } from "../geometry.ts"
import type { Osm, Tags } from "../osm.ts"

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
