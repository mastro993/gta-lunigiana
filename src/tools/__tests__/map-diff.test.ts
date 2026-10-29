import assert from "node:assert/strict"
import { test } from "node:test"

import type { MonzoneMap } from "../../sim/map/index.ts"
import { MAP_VERSION } from "../../sim/map/packed.ts"
import { diffMaps, formatDiff } from "../map-diff.ts"

const MAP: MonzoneMap = {
  version: MAP_VERSION,
  origin: { lat: 44.2, lon: 10.1 },
  mPerDeg: { lat: 111_000, lon: 80_000 },
  bounds: { minX: -50, minY: -20, maxX: 50, maxY: 20 },
  heightmap: { cell: 4, cols: 3, rows: 2, x0: -52, y0: -24, data: [100, 110, 120, 130, 140, 150] },
  roads: [
    // two pieces cut from one OSM way share its id
    { id: 7, cls: "tertiary", w: 6, surface: "asphalt", pts: [0, 0, 10, 0], z: [100, 101] },
    { id: 7, cls: "tertiary", w: 6, surface: "asphalt", pts: [10, 0, 20, 5], z: [101, 102] },
    {
      id: 8,
      cls: "path",
      name: "Via Roma",
      w: 1.5,
      surface: "dirt",
      pts: [0, 0, 0, 10],
      z: [100, 103],
    },
  ],
  buildings: [
    {
      id: -1,
      kind: "house",
      h: 6,
      z0: 100,
      style: "plaster",
      tint: 0,
      outer: [1, 1, 5, 1, 5, 5, 1, 5],
    },
  ],
  water: [
    {
      id: 3,
      kind: "stream",
      w: 2,
      bed: 2,
      depth: 0.5,
      pts: [-10, -10, -10, 10],
      z: [99, 98],
      area: [1, 1.1],
    },
  ],
  rail: [{ id: 9, pts: [-40, 0, 40, 0], z: [100, 100] }],
  railway: {
    lines: [{ pieces: [{ rail: 0, rev: false }], maxspeed: [[0, 80, 60]] }],
    stations: [{ name: "Monzone", line: 0, s0: 10, s1: 30, side: 1 }],
    crossings: [{ road: 2, nodes: [0], x: 0, y: 0, line: 0, s: 40 }],
    platforms: [{ area: 1, axis: [-30, 0, -20, 0], top: [100.4, 100.4] }],
  },
  areas: [
    { kind: "forest", rings: [[-40, -15, -30, -15, -30, -5]] },
    { kind: "platform", rings: [[-30, 1, -20, 1, -20, 3, -30, 3]] },
  ],
  barriers: [{ kind: "wall", pts: [0, 5, 5, 5] }],
  pois: [{ id: 11, kind: "amenity=bar", name: "Bar", x: 2, y: 2 }],
  districts: [{ name: "Monzone", x: 0, y: 0, r: 30 }],
  graph: {
    xy: [0, 0, 10, 0, 20, 5, 0, 10],
    edges: [0, 1, 0, 1, 2, 1, 0, 3, 2],
    traffic: [0, 1],
    walk: [0, 1, 2],
  },
  walls: { walk: [1, 1, 5, 1, 5, 1, 5, 5], shore: [-11, -10, -11, 10], drive: [1, 1, 5, 1] },
  trees: [10, 10, 1, 12, 10, 0.8],
  spawns: { player: { x: 1, y: 2, angle: 0 }, parked: [{ x: 3, y: 4, angle: 1 }] },
}

/** The map with item `k` of `list` replaced by `item`. */
const swap = <T>(list: ReadonlyArray<T>, k: number, item: T): ReadonlyArray<T> =>
  list.map((x, i) => (i === k ? item : x))

test("identical maps, and maps that differ only in order, have no differences", () => {
  assert.deepEqual(diffMaps(MAP, MAP), [])
  assert.equal(formatDiff(diffMaps(MAP, MAP)), "no differences")
  const road = MAP.roads[2]!
  const reordered: MonzoneMap = {
    ...MAP,
    roads: [...MAP.roads].reverse(),
    // the same fields built in another order
    pois: [{ y: 2, x: 2, name: "Bar", kind: "amenity=bar", id: 11 }],
    trees: [12, 10, 0.8, 10, 10, 1],
    walls: { ...MAP.walls, walk: [5, 1, 5, 5, 1, 1, 5, 1] },
    // nodes 0 and 3 swapped, the edges reversed in order and pointing at the reversed roads
    graph: {
      xy: [0, 10, 10, 0, 20, 5, 0, 0],
      edges: [3, 0, 0, 1, 2, 1, 3, 1, 2],
      traffic: [2, 1],
      walk: [2, 1, 0],
    },
    railway: { ...MAP.railway, crossings: [{ ...MAP.railway.crossings[0]!, road: 0, nodes: [3] }] },
  }
  assert.equal(reordered.roads[0], road)
  assert.deepEqual(diffMaps(MAP, reordered), [])
})

const CASES: ReadonlyArray<readonly [string, Partial<MonzoneMap>, RegExp]> = [
  ["top level", { bounds: { ...MAP.bounds, maxX: 60 } }, /^bounds: maxX 50 -> 60$/],
  [
    "heightmap",
    { heightmap: { ...MAP.heightmap, data: [100, 110, 120, 130, 145, 150] } },
    /^nodes: 1 of 6 shared nodes differ, max 0\.5 m, RMS 0\.5 m over them, in x -48\.\.-48, y -20\.\.-20$/,
  ],
  [
    "heightmap",
    { heightmap: { ...MAP.heightmap, cell: 2 } },
    /^nodes: the grids do not line up, so no node is compared$/,
  ],
  [
    "walls",
    { walls: { ...MAP.walls, walk: [1, 1, 5, 1] } },
    /^walk: 1 removed, in x 5\.\.5, y 1\.\.5$/,
  ],
  [
    "walls",
    { walls: { ...MAP.walls, drive: [1, 1, 5, 1, 0, 0, 2, 2] } },
    /^drive: 1 added, in x 0\.\.2, y 0\.\.2$/,
  ],
  ["walls", { walls: { ...MAP.walls, shore: [] } }, /^shore: 1 removed/],
  ["trees", { trees: [12, 10, 0.8] }, /^1 removed, in x 10\.\.10, y 10\.\.10$/],
  ["trees", { trees: [10, 10, 1.1, 12, 10, 0.8] }, /^1 added, 1 removed, in x 10\.\.10/],
  [
    "roads",
    { roads: swap(MAP.roads, 1, { ...MAP.roads[1]!, cls: "secondary" }) },
    /^ {2}changed road 7: cls "tertiary" -> "secondary"$/,
  ],
  [
    "roads",
    { roads: swap(MAP.roads, 2, { ...MAP.roads[2]!, z: [100, 103.5] }) },
    /^ {2}changed road 8 "Via Roma": z max diff 0\.5 \(1 of 2 values\)$/,
  ],
  [
    "roads",
    {
      roads: swap(MAP.roads, 0, { ...MAP.roads[0]!, pts: [0, 0, 5, 1, 10, 0], z: [100, 100, 101] }),
    },
    /^ {2}changed road 7: pts 4 -> 6 values, z 2 -> 3 values$/,
  ],
  [
    "buildings",
    { buildings: [{ ...MAP.buildings[0]!, outer: [1, 1, 6.5, 1, 5, 5, 1, 5] }] },
    /^ {2}changed building -1: outer max diff 1\.5 \(1 of 8 values\)$/,
  ],
  [
    "buildings",
    { buildings: [{ ...MAP.buildings[0]!, h: 7, holes: [[2, 2, 2, 3, 3, 3]] }] },
    /^ {2}changed building -1: h 6 -> 7, holes changed$/,
  ],
  [
    "buildings",
    {
      buildings: [
        ...MAP.buildings,
        { ...MAP.buildings[0]!, id: 5, outer: [20, 20, 25, 20, 25, 25] },
      ],
    },
    /^ {2}added building 5$/,
  ],
  ["water", { water: [{ ...MAP.water[0]!, w: 3 }] }, /^ {2}changed water 3: w 2 -> 3$/],
  [
    "rail",
    { rail: [{ ...MAP.rail[0]!, kind: "siding" }] },
    /^ {2}changed rail 9: kind \(none\) -> "siding"$/,
  ],
  [
    "railway",
    { railway: { ...MAP.railway, stations: [{ ...MAP.railway.stations[0]!, s1: 35 }] } },
    /^stations: 1 added, 1 removed$/,
  ],
  [
    "railway",
    { railway: { ...MAP.railway, crossings: [{ ...MAP.railway.crossings[0]!, nodes: [1] }] } },
    /^crossings: 1 added, 1 removed, in x 0\.\.0, y 0\.\.0$/,
  ],
  [
    "areas",
    { areas: [...MAP.areas, { kind: "water", rings: [[0, 0, 1, 0, 1, 1]] }] },
    /^1 added, in x 0\.\.1, y 0\.\.1 \(water \+1\)$/,
  ],
  [
    "barriers",
    { barriers: [{ kind: "guard_rail", pts: [0, 5, 5, 5] }] },
    /^1 added, 1 removed, in x 0\.\.5, y 5\.\.5 \(guard_rail \+1, wall -1\)$/,
  ],
  [
    "pois",
    { pois: [{ ...MAP.pois[0]!, name: "Caffè" }] },
    /^ {2}changed poi 11 "Bar": name "Bar" -> "Caffè"$/,
  ],
  [
    "districts",
    { districts: [{ ...MAP.districts[0]!, r: 40 }] },
    /^ {2}changed district "Monzone": r 30 -> 40$/,
  ],
  [
    "spawns",
    { spawns: { ...MAP.spawns, player: { x: 1, y: 2, angle: 0.5 } } },
    /^player: angle 0 -> 0\.5$/,
  ],
  [
    "spawns",
    { spawns: { ...MAP.spawns, parked: [...MAP.spawns.parked, { x: 9, y: 9, angle: 0 }] } },
    /^parked: 1 added, in x 9\.\.9, y 9\.\.9$/,
  ],
  [
    "graph",
    { graph: { ...MAP.graph, traffic: [0] } },
    /^traffic: 1 removed, in x 10\.\.20, y 0\.\.5$/,
  ],
  [
    "graph",
    { graph: { ...MAP.graph, walk: [0, 1, 2, 2] } },
    /^walk: 1 added, in x 0\.\.0, y 0\.\.10$/,
  ],
]

test("each category's change is reported in its block alone", () => {
  for (const [category, change, line] of CASES) {
    const blocks = diffMaps(MAP, { ...MAP, ...change })
    assert.deepEqual(
      blocks.map((b) => b.category),
      [category],
      `${category}: ${JSON.stringify(change)}`,
    )
    assert.ok(
      blocks[0]!.lines.some((l) => line.test(l)),
      `${category}: ${blocks[0]!.lines.join(" | ")}`,
    )
  }
})

test("a key diffMaps does not compare, at the top level or inside a part it reads key by key, is reported, never no differences", () => {
  // keys a later map might add: the cast lets the map carry them
  const added = {
    ...MAP,
    lights: [1, 2],
    heightmap: { ...MAP.heightmap, scale: 10 },
    graph: { ...MAP.graph, signals: [0] },
    walls: { ...MAP.walls, fence: [0, 0, 1, 1] },
  } as MonzoneMap
  assert.deepEqual(diffMaps(MAP, added), [
    {
      category: "unhandled keys",
      lines: [
        "lights: differs",
        "heightmap.scale: differs",
        "graph.signals: differs",
        "walls.fence: differs",
      ],
    },
  ])
  const same = diffMaps(added, added)
  assert.deepEqual(
    same.map((b) => b.category),
    ["unhandled keys"],
  )
  assert.equal(same[0]!.lines[0], "lights: the same in both")
  assert.notEqual(formatDiff(same), "no differences")
})

test("a removed road piece leaves the piece sharing its id matched; the graph loses its edge", () => {
  const removed: MonzoneMap = {
    ...MAP,
    roads: MAP.roads.slice(1),
    // edge 0 (road 0) gone, the road indices after it one lower
    graph: { ...MAP.graph, edges: [1, 2, 0, 0, 3, 1], traffic: [0], walk: [0, 1] },
    railway: { ...MAP.railway, crossings: [{ ...MAP.railway.crossings[0]!, road: 1 }] },
  }
  assert.deepEqual(diffMaps(MAP, removed), [
    { category: "roads", lines: ["1 removed, in x 0..10, y 0..0", "  removed road 7"] },
    {
      category: "graph",
      lines: [
        "edges: 1 removed, in x 0..10, y 0..0",
        "traffic: 1 removed, in x 0..10, y 0..0",
        "walk: 1 removed, in x 0..10, y 0..0",
      ],
    },
  ])
  assert.throws(() => diffMaps(MAP, { ...MAP, roads: [] }), /an index points at road 0 of 0/)
})

test("a moved graph node changes its node and the edges, traffic and walk sets through it", () => {
  const [block] = diffMaps(MAP, {
    ...MAP,
    graph: { ...MAP.graph, xy: [0, 0, 10, 0, 20, 6, 0, 10] },
  })
  assert.deepEqual(block, {
    category: "graph",
    lines: [
      "nodes: 1 added, 1 removed, in x 20..20, y 5..6",
      "edges: 1 added, 1 removed, in x 10..20, y 0..6",
      "traffic: 1 added, 1 removed, in x 10..20, y 0..6",
      "walk: 1 added, 1 removed, in x 10..20, y 0..6",
    ],
  })
})

test("a road inserted in front changes only the roads: graph edges and crossings compare by road id, platforms by their area", () => {
  const added = { id: 1, cls: "track", w: 3, surface: "gravel", pts: [30, 0, 40, 0], z: [100, 100] }
  const area = { kind: "grass", rings: [[30, 10, 31, 10, 31, 11]] }
  const shifted: MonzoneMap = {
    ...MAP,
    roads: [added, ...MAP.roads],
    areas: [area, ...MAP.areas],
    graph: { ...MAP.graph, edges: MAP.graph.edges.map((v, k) => (k % 3 === 2 ? v + 1 : v)) },
    railway: {
      ...MAP.railway,
      crossings: [{ ...MAP.railway.crossings[0]!, road: 3 }],
      platforms: [{ ...MAP.railway.platforms[0]!, area: 2 }],
    },
  }
  assert.deepEqual(diffMaps(MAP, shifted), [
    { category: "roads", lines: ["1 added, in x 30..40, y 0..0", "  added road 1"] },
    { category: "areas", lines: ["1 added, in x 30..31, y 10..11 (grass +1)"] },
  ])
})

test("the heightmap's grid change is reported, and the nodes both grids share are compared", () => {
  // one column off the west edge, and the node at (-44, -20) raised 1 m
  const [block] = diffMaps(MAP, {
    ...MAP,
    heightmap: { ...MAP.heightmap, cols: 2, x0: -48, data: [110, 120, 140, 160] },
  })
  assert.deepEqual(block, {
    category: "heightmap",
    lines: [
      "grid: cols 3 -> 2, x0 -52 -> -48; extent x -52..-44, y -24..-20 -> x -48..-44, y -24..-20",
      "nodes: 1 of 4 shared nodes differ, max 1 m, RMS 1 m over them, in x -44..-44, y -20..-20",
    ],
  })
})

test("the report lists each block's lines, at most 10 per kind of change, then the categories that differ", () => {
  const pois = Array.from({ length: 12 }, (_, k) => ({
    id: 100 + k,
    kind: "shop=bakery",
    x: k,
    y: 0,
  }))
  const report = formatDiff(diffMaps(MAP, { ...MAP, pois: [...MAP.pois, ...pois], trees: [] }))
  assert.equal(
    report,
    [
      "trees:",
      "  2 removed, in x 10..12, y 10..10",
      "pois:",
      "  12 added, in x 0..11, y 0..0",
      ...pois.slice(0, 10).map((p) => `    added poi ${p.id}`),
      "    ... and 2 more",
      "2 categories differ: trees, pois",
    ].join("\n"),
  )
})
