import assert from "node:assert/strict"
import { test } from "node:test"

import { extractRoads } from "../features.ts"
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
