import assert from "node:assert/strict"
import { test } from "node:test"

import type { Area } from "../../sim/map/index.ts"
import type { RoadF } from "../features.ts"
import { fromLocal, type P, signedArea, type V } from "../geometry.ts"
import type { Osm, Tags } from "../osm.ts"
import {
  BREAKWATER_TOP,
  extractShore,
  holedSea,
  offBeaches,
  PIER_DECK,
  pierDeck,
  type Shore,
  splitPiers,
} from "../shore.ts"
import type { Beach } from "../ucs.ts"

/**
 * An empty OSM extract, `way`, which adds a way through `pts` (closed when its last point repeats
 * its first; a point another way passes through is that way's node) with `tags` and returns its id,
 * and `relation`, which adds a multipolygon of ways.
 */
const shoreOsm = () => {
  const osm: Osm = { nodes: new Map(), ways: new Map(), relations: new Map() }
  const way = (pts: ReadonlyArray<P>, tags: Tags = {}): string => {
    const id = `${osm.ways.size + 1}`
    const nds = pts.map(([x, y]) => {
      const node = `${x},${y}`
      if (!osm.nodes.has(node)) {
        const [lat, lon] = fromLocal(x, y)
        osm.nodes.set(node, { id: node, lat, lon, tags: {} })
      }
      return node
    })
    osm.ways.set(id, { id, nds, tags })
    return id
  }
  const relation = (members: ReadonlyArray<readonly [string, string]>, tags: Tags) => {
    const id = `${osm.relations.size + 1}`
    osm.relations.set(id, {
      id,
      members: members.map(([ref, role]) => ({ type: "way", ref, role })),
      tags: { type: "multipolygon", ...tags },
    })
  }
  return { osm, way, relation }
}

/** A closed square of `side` m from (x, y), counter-clockwise, its first point repeated. */
const square = (x: number, y: number, side: number): Array<P> => [
  [x, y],
  [x + side, y],
  [x + side, y + side],
  [x, y + side],
  [x, y],
]
/** A Spiagge polygon of `code` over the square of `side` m from (x, y). */
const beach = (id: number, code: string, x: number, y: number, side: number): Beach => ({
  id,
  code,
  rings: [square(x, y, side).slice(0, -1)],
})
/** No clip: each line whole. */
const whole = (pts: ReadonlyArray<V>) => [{ pts: [...pts], from: 0 }]
/** Each area's kind and its rings' areas (m², outer positive, holes negative). */
const kindsOf = (areas: ReadonlyArray<Area>) =>
  areas.map((a) => [
    a.kind,
    ...a.rings.map((ring) =>
      Math.round(signedArea(ring.flatMap((v, i) => (i % 2 === 0 ? [[v, ring[i + 1]!] as P] : [])))),
    ),
  ])
const shoreOf = (osm: Osm, beaches: ReadonlyArray<Beach> = []): Shore =>
  extractShore(osm, beaches, whole)

test("a beach's material is Spiagge's where its polygons of one material (102 sand, 103 pebbles, 104 rocky shore) hold half the beach or more, else OSM's surface, else sand", () => {
  const { osm, way } = shoreOsm()
  way(square(0, 0, 20), { natural: "beach" })
  way(square(40, 0, 20), { natural: "beach", surface: "gravel" })
  way(square(80, 0, 20), { natural: "beach", surface: "rocky" })
  way(square(120, 0, 20), { natural: "sand" })
  way(square(160, 0, 20), { natural: "dune", surface: "shingle" })
  way(square(0, 100, 20), { natural: "beach", surface: "sand" }) // in a 103: pebbles
  way(square(40, 100, 20), { natural: "beach" }) // in a 104: rocky shore
  way(square(80, 100, 20), { natural: "beach", surface: "pebbles" }) // in a 102: sand
  way(square(120, 100, 20), { natural: "beach", surface: "rock" }) // in a 106, a fill: OSM's surface
  way(square(200, 0, 20), { natural: "wetland" }) // not a beach
  // A cove bent round a headland (an L), its centre (213.6, 113.6) on the headland, all of it in a 103.
  const cove: Array<P> = [
    [200, 100],
    [240, 100],
    [240, 110],
    [210, 110],
    [210, 140],
    [200, 140],
  ]
  way([...cove, cove[0]!], { natural: "beach" })
  // 30 % of it in a 104 and 40 % in a 102: neither holds half, so OSM's surface.
  way(square(300, 100, 20), { natural: "beach", surface: "gravel" })
  /** A Spiagge polygon of `code` over the box from (x0, y0) to (x1, y1). */
  const box = (
    id: number,
    code: string,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): Beach => ({
    id,
    code,
    rings: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
    ],
  })
  const shore = shoreOf(osm, [
    beach(1, "103", -5, 95, 30),
    beach(2, "104", 35, 95, 30),
    beach(3, "102", 75, 95, 30),
    beach(4, "106", 115, 95, 30),
    { id: 5, code: "103", rings: [cove] },
    box(6, "104", 295, 95, 307, 125),
    box(7, "102", 313, 95, 325, 125),
  ])
  assert.deepEqual(
    kindsOf(shore.areas.slice(0, 11)).map(([kind]) => kind),
    [
      "sand",
      "pebble",
      "rock",
      "sand",
      "pebble",
      "pebble",
      "rock",
      "sand",
      "rock",
      "pebble",
      "pebble",
    ],
  )
})

test("a beach mapped as a multipolygon keeps its holes, and its material is read as a way's", () => {
  const { osm, way, relation } = shoreOsm()
  const outer = way(
    [
      [0, 0],
      [60, 0],
      [60, 60],
    ],
    {},
  )
  const back = way(
    [
      [60, 60],
      [0, 60],
      [0, 0],
    ],
    {},
  )
  const hole = way(square(20, 20, 10), {})
  relation(
    [
      [outer, "outer"],
      [back, "outer"],
      [hole, "inner"],
    ],
    { natural: "beach", surface: "unpaved" },
  )
  assert.deepEqual(kindsOf(shoreOf(osm).areas), [["sand", 3600, -100]])
})

test("Liguria's beaches (Spiagge) are areas of their own: sand, pebbles and rocky shore; fills and river courses are none", () => {
  const shore = shoreOf(shoreOsm().osm, [
    beach(1, "102", 0, 0, 10),
    beach(2, "103", 20, 0, 10),
    beach(3, "104", 40, 0, 10),
    beach(4, "106", 60, 0, 10),
    beach(5, "301", 80, 0, 10),
    beach(6, "302", 100, 0, 10),
  ])
  assert.deepEqual(kindsOf(shore.areas), [
    ["sand", 100],
    ["pebble", 100],
    ["rock", 100],
  ])
  assert.deepEqual([shore.raised, shore.piers, shore.barriers], [[], [], []])
})

test("the land cover's gravel on a Spiagge polygon is dropped, as Spiagge says the beach's material; inland it stays, and so does every other cover", () => {
  const areas: ReadonlyArray<Area> = [
    { kind: "pebble", rings: [[5, 5, 30, 5, 30, 8, 5, 8]] }, // half on the beach
    { kind: "pebble", rings: [[-20, -20, 20, -20, 20, 20, -20, 20]] }, // round it
    { kind: "pebble", rings: [[100, 0, 110, 0, 110, 10, 100, 10]] }, // inland
    { kind: "scrub", rings: [[0, 0, 10, 0, 10, 10, 0, 10]] },
  ]
  assert.deepEqual(
    offBeaches(areas, [beach(1, "102", 0, 0, 10)]).map((a) => a.rings[0]![0]),
    [100, 0],
  )
})

test("an open pier is a path on a bridge, as wide as its width tag says or a path's 1.5 m; a closed one a paved area raised to the deck's height", () => {
  const { osm, way } = shoreOsm()
  way(
    [
      [0, 0],
      [0, -30],
      [5, -40],
    ],
    { man_made: "pier", name: "Pontile", width: "3 m" },
  )
  way(
    [
      [20, 0],
      [20, -15],
    ],
    { man_made: "pier" },
  )
  way(square(40, -20, 10), { man_made: "pier", area: "yes" })
  way(
    [
      [60, 0],
      [60, -15],
    ],
    { man_made: "pier", highway: "footway" }, // a road already: extractRoads reads it
  )
  const shore = shoreOf(osm)
  assert.deepEqual(
    shore.piers.map((r) => [r.id, r.cls, r.name, r.w, r.surface, r.bridge, r.pier, r.pts.length]),
    [
      [1, "path", "Pontile", 3, "wood", true, true, 3],
      [2, "path", undefined, 1.5, "wood", true, true, 2],
    ],
  )
  assert.deepEqual(kindsOf(shore.areas), [["paved", 100]])
  assert.deepEqual(
    shore.raised.map((r) => [r.top, r.rings.length]),
    [[PIER_DECK, 1]],
  )
  assert.deepEqual(shore.barriers, [])
})

test("a breakwater or a groyne is rock raised to 1.5 m, as drawn or, mapped as a line, 3.5 m wide along it, with a drive wall along its outline", () => {
  const { osm, way, relation } = shoreOsm()
  way(square(0, 0, 10), { man_made: "breakwater", area: "yes" })
  way(
    [
      [100, 0],
      [100, 40],
      [140, 40],
    ],
    { man_made: "groyne" },
  )
  const outer = way(square(200, 0, 20), {})
  const inner = way(square(205, 5, 4), {})
  relation(
    [
      [outer, "outer"],
      [inner, "inner"],
    ],
    { man_made: "breakwater" },
  )
  const shore = shoreOf(osm)
  // The closed ways, the multipolygons, then the lines: 80 m of line 3.5 m wide, a corner's
  // 1.75² m² less inside its bend and its mitre's more outside it.
  assert.deepEqual(kindsOf(shore.areas), [
    ["rock", 100],
    ["rock", 400, -16],
    ["rock", 280],
  ])
  assert.deepEqual(
    shore.raised.map((r) => r.top),
    [BREAKWATER_TOP, BREAKWATER_TOP, BREAKWATER_TOP],
  )
  // Every ring's outline closed, as a breakwater: the square's 5 points, the multipolygon's outer
  // and inner 5 each, the groyne's 7.
  assert.deepEqual(
    shore.barriers.map((b) => [b.kind, b.pts.length / 2, b.pts[0] === b.pts.at(-2)]),
    [
      ["breakwater", 5, true],
      ["breakwater", 5, true],
      ["breakwater", 5, true],
      ["breakwater", 7, true],
    ],
  )
})

test("a pier's deck stands 1 m over the water's level whatever the DTM reads there, over dry ground at 1 m or on higher ground at its height, and an end on dry ground at that ground, so a walker steps onto it from the beach", () => {
  const pts: ReadonlyArray<V> = [
    { x: 0, y: 0 }, // on the beach, dry, 0.4 m
    { x: 0, y: -10 }, // over the shallows, the DTM 0.1 m under the sea's level
    { x: 0, y: -20 }, // over the DTM's edge: no ground
    { x: 0, y: -30 }, // over the water, the DTM 2.2 m up (as Liguria's reads an estuary's)
    { x: 0, y: -40 }, // its end in the sea, -0.5 m
  ]
  const ground = (v: V) => [0.4, -0.1, Number.NaN, 2.2, -0.5][-v.y / 10]!
  const sea = (_x: number, y: number) => (y < -5 ? 0 : undefined)
  assert.deepEqual(pierDeck(pts, ground, sea), [0.4, PIER_DECK, PIER_DECK, PIER_DECK, PIER_DECK])
  // Over a river at 0.3 m, 1.3 m.
  assert.deepEqual(
    pierDeck(pts.slice(1, 3), ground, () => 0.3),
    [0.3 + PIER_DECK, 0.3 + PIER_DECK],
  )
  // On dry ground all along: at 1 m over lower ground, on higher ground at its height; an end at its ground.
  assert.deepEqual(
    pierDeck(pts.slice(1), ground, () => undefined),
    [-0.1, PIER_DECK, 2.2, -0.5],
  )
  // An end the water's edge cuts (at y -5) is the shore's: dry past it, at its ground.
  assert.deepEqual(
    pierDeck(
      [
        { x: 0, y: -5 },
        { x: 0, y: -10 },
      ],
      (v) => (v.y === -5 ? 0.2 : -0.1),
      sea,
    ),
    [0.2, PIER_DECK],
  )
})

test("a pier is cut at the water's edge: its stretch over the water a deck, on dry ground a path at grade, in order along it; a pier on dry ground all along a path", () => {
  const sea: Area = { kind: "sea", level: 0, rings: [[-100, -100, 100, -100, 100, 0, -100, 0]] }
  const pier: RoadF = {
    id: 7,
    cls: "path",
    w: 2,
    surface: "wood",
    bridge: true,
    pier: true,
    private: false,
    pts: [
      { x: 0, y: 20, id: "a" },
      { x: 0, y: 5, id: "b" },
      { x: 0, y: -30, id: "c" },
    ],
  }
  const cut = splitPiers([pier, { ...pier, id: 8, pts: pier.pts.slice(0, 2) }], [sea])
  assert.deepEqual(
    cut.map((r) => [r.id, r.bridge, r.pier, r.pts.map((v) => [v.x, v.y, v.id])]),
    [
      [
        7,
        undefined,
        undefined,
        [
          [0, 20, "a"],
          [0, 5, "b"],
          [0, 0, undefined],
        ],
      ],
      [
        7,
        true,
        true,
        [
          [0, 0, undefined],
          [0, -30, "c"],
        ],
      ],
      [
        8,
        undefined,
        undefined,
        [
          [0, 20, "a"],
          [0, 5, "b"],
        ],
      ],
    ],
  )
})

test("a breakwater wholly in the sea is cut out of it, dry land; one the coastline runs across, or one on land, is not", () => {
  const sea: Area = { kind: "sea", level: 0, rings: [[0, 0, 100, 0, 100, 100, 0, 100]] }
  const rock = (x0: number, y0: number, x1: number, y1: number) => ({
    rings: [[x0, y0, x1, y0, x1, y1, x0, y1]],
    top: BREAKWATER_TOP,
  })
  const [holed, apart] = holedSea(
    [sea, { ...sea, rings: [[200, 0, 300, 0, 300, 100, 200, 100]] }],
    [rock(40, 40, 60, 50), rock(90, 10, 110, 20), rock(-50, -50, -40, -40)],
  )
  assert.deepEqual(holed!.rings, [sea.rings[0], [40, 50, 60, 50, 60, 40, 40, 40]])
  assert.deepEqual(apart!.rings, [[200, 0, 300, 0, 300, 100, 200, 100]])
})
