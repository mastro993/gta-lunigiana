import assert from "node:assert/strict"
import { test } from "node:test"

import { footprintReport, reportLines } from "../footprint-report.ts"
import { partOf } from "../region.ts"
import {
  BESIDE,
  EAST,
  LUCIDO_OSM,
  PAIR_OSM,
  SLANT,
  SLANT_OSM,
  WEST,
  place,
  queried,
  road,
} from "./footprint-osm.ts"

const SLANTED = "NE 53° 800,2000..2000,400"

test("lucido's report, unmasked and alone, is the one footprint-check printed before it judged masks", () => {
  const lucido = partOf("lucido")
  const report = footprintReport(lucido, [], LUCIDO_OSM)
  assert.deepEqual(reportLines(lucido, report), [
    "lucido (Valle del Lucido): 1 rectangle(s), 4 edges (0 seams); OSM over local -3900,-7100,5900,4900: 5 places, 20 buildings, 8 highway ways",
    "  edge W x=-2900 y -6100..3900",
    "  edge E x=4900 y -6100..3900",
    "  edge S y=-6100 x -2900..4900",
    "  edge N y=3900 x -2900..4900",
    "places within 300 m of an edge: 4",
    "  Vinca (village, node 101) at -2800,0: 100 m inside W x=-2900 y -6100..3900",
    "  Casola (hamlet, node 102) at 1000,4050: 150 m outside N y=3900 x -2900..4900",
    "  (no name) (locality, node 104) at 5000,4000: 141 m outside E x=4900 y -6100..3900",
    "  Equi (village, node 105) at 4700,-5900: 200 m inside E x=4900 y -6100..3900",
    "clusters of 5+ buildings (50 m links) within 300 m of an edge: 2",
    "  6 buildings (3 inside) round 4900,1000: one 5 m from E x=4900 y -6100..3900;  (locality) 3002 m away",
    "  5 buildings (0 inside) round -3100,2020: one 200 m from W x=-2900 y -6100..3900; Vinca (village) 2042 m away",
    "roads that leave the play area and come back: 2",
    "  600 m outside, up to 200 m out at 5100,-1800 (E x=4900 y -6100..3900), leaves at 4900,-2000, back at 4900,-1800: way 303 track",
    '  400 m outside, up to 100 m out at 700,4000 (N y=3900 x -2900..4900), leaves at 500,3900, back at 700,3900: way 301 residential, way 302 residential "Via Uno"',
    "notes: paths, footways, steps that leave and come back: 1",
    "  300 m outside, up to 100 m out at 100,-6200 (S y=-6100 x -2900..4900), leaves at 0,-6100, back at 100,-6100: way 304 footway",
    "unresolved: roads that leave and reach the OSM box's edge, not back: 1",
    '  leaves at -2900,-3000 (W x=-2900 y -6100..3900), 960 m outside to -3860,-3000: way 305 secondary "SP10 Via Ovest"',
    "unresolved: paths that leave and reach the OSM box's edge, not back: 1",
    "  leaves at 4000,3900 (N y=3900 x -2900..4900), 950 m outside to 4000,4850: way 306 path",
  ])
  assert.deepEqual(Object.keys(report), [
    "part",
    "rects",
    "osmBox",
    "counts",
    "edges",
    "findings",
    "notes",
    "unresolved",
    "seams",
  ])
  assert.deepEqual(report.edges[0], {
    side: "W",
    x0: -2900,
    y0: -6100,
    x1: -2900,
    y1: 3900,
    label: "W x=-2900 y -6100..3900",
  })
  assert.deepEqual(report.seams, { edges: [] })
})

test("two unmasked parts side by side: the findings before, and no list of roads out through the seam", () => {
  const report = footprintReport(WEST, [EAST], PAIR_OSM)
  assert.deepEqual(reportLines(WEST, report), [
    "west (west): 1 rectangle(s), 5 edges (1 seams); OSM over local -1000,-1000,2000,2000: 3 places, 5 buildings, 4 highway ways",
    "  edge W x=0 y 0..1000",
    "  edge E x=1000 y 0..500 (seam with east)",
    "  edge E x=1000 y 500..1000",
    "  edge S y=0 x 0..1000",
    "  edge N y=1000 x 0..1000",
    "places within 300 m of an edge: 2",
    "  Alfa (hamlet, node 401) at 50,500: 50 m inside W x=0 y 0..1000",
    "  Beta (village, node 402) at 1100,800: 100 m outside E x=1000 y 500..1000",
    "clusters of 5+ buildings (50 m links) within 300 m of an edge: 1",
    "  5 buildings (0 inside) round 1030,900: one 10 m from E x=1000 y 500..1000; Beta (village) 122 m away",
    "roads that leave the play area and come back: 1",
    "  300 m outside, up to 100 m out at 400,1100 (N y=1000 x 0..1000), leaves at 300,1000, back at 400,1000: way 602 unclassified",
    "notes: paths, footways, steps that leave and come back: 0",
    "unresolved: roads that leave and reach the OSM box's edge, not back: 1",
    "  leaves at 0,600 (W x=0 y 0..1000), 950 m outside to -950,600: way 604 tertiary",
    "unresolved: paths that leave and reach the OSM box's edge, not back: 0",
    "seams: E x=1000 y 0..500 (seam with east)",
  ])
  assert.deepEqual(report.seams, { edges: ["E x=1000 y 0..500 (seam with east)"] })
})

test("a road out of the part and back through its neighbour is a finding; one out of the neighbour alone is not", () => {
  const report = footprintReport(WEST, [EAST], {
    box: queried([0, 0, 1000, 1000]),
    elements: [
      // In EAST, 112 m from the open half of WEST's east edge: inside the play area.
      place(1, [1100, 450], "hamlet", "Epsilon"),
      // Out of that half and back across EAST's north edge.
      road(2, "residential", [
        [900, 700],
        [1200, 700],
        [1200, 400],
        [900, 400],
      ]),
      // Out of EAST's north edge and back, and out of its east edge to the queried box's edge.
      road(3, "residential", [
        [1500, 400],
        [1500, 600],
        [1700, 600],
        [1700, 400],
      ]),
      road(4, "residential", [
        [1500, 300],
        [2100, 300],
      ]),
    ],
  })
  assert.deepEqual(report.findings.places, [
    {
      node: 1,
      name: "Epsilon",
      place: "hamlet",
      at: [1100, 450],
      inside: true,
      distance: 112,
      edge: "E x=1000 y 500..1000",
    },
  ])
  assert.deepEqual(report.findings.roads, [
    {
      length: 400,
      depth: 200,
      far: [1200, 700],
      edge: "E x=1000 y 500..1000",
      exit: [1000, 700],
      entry: [1200, 500],
      ways: [{ way: 2, highway: "residential", name: "" }],
    },
  ])
  assert.deepEqual(report.unresolved, { roads: [], paths: [] })
})

test("a masked part is judged on its mask: its slanted edge cuts a cluster and a road, its edge along a rectangle is a seam", () => {
  const report = footprintReport(SLANT, [BESIDE], SLANT_OSM)
  const lines = reportLines(SLANT, report)
  assert.equal(
    lines[0],
    "slant (slant): 1 rectangle(s), a mask of 5 vertices, 5 edges (1 seams); OSM over local -1000,-1000,3000,3000: 1 places, 6 buildings, 1 highway ways",
  )
  assert.equal(lines.at(-1), "seams: E x=2000 y 0..400 (seam with beside)")
  assert.deepEqual(report.mask, SLANT.mask)
  assert.deepEqual(report.edges[4], {
    side: "NE",
    bearing: 53,
    x0: 800,
    y0: 2000,
    x1: 2000,
    y1: 400,
    label: SLANTED,
  })
  // Inside the rectangle, but beyond the mask.
  assert.deepEqual(report.findings.places, [
    {
      node: 701,
      name: "Delta",
      place: "hamlet",
      at: [1600, 1400],
      inside: false,
      distance: 280,
      edge: SLANTED,
    },
  ])
  assert.deepEqual(report.findings.clusters, [
    {
      size: 6,
      inside: 3,
      centroid: [1400, 1200],
      distance: 5,
      edge: SLANTED,
      place: { name: "Delta", place: "hamlet", distance: 283 },
    },
  ])
  assert.deepEqual(report.findings.roads, [
    {
      length: 847,
      depth: 300,
      far: [1700, 1300],
      edge: SLANTED,
      exit: [1460, 1120],
      entry: [1264, 1382],
      ways: [{ way: 901, highway: "residential", name: "" }],
    },
  ])
  assert.deepEqual(report.seams, { edges: ["E x=2000 y 0..400 (seam with beside)"] })
})
