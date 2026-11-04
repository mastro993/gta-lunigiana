import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { test } from "node:test"

import { clusters, edgeLabel, excursions, nearestEdge, partEdges } from "../footprint.ts"
import type { P } from "../geometry.ts"
import { type Rect, checkMask } from "../region.ts"
import { BESIDE, EAST, SLANT, WEST, part } from "./footprint-osm.ts"

const near = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01
/** A fetched box far beyond every line: nothing runs to its edge. */
const WIDE: Rect = [-1e4, -1e4, 1e4, 1e4]
/** The play area of one part of `rs`. */
const rects = (...rs: ReadonlyArray<Rect>) => [part("p", rs)]
const SQUARE = rects([0, 0, 100, 100])

test("partEdges of an L drops the shared edge and merges pieces on one line", () => {
  // A 200 m bar along the bottom and a 100 m column on its left: x 0..100 at y 100 is interior.
  const edges = partEdges(
    part("l", [
      [0, 0, 200, 100],
      [0, 100, 100, 200],
    ]),
  )
  assert.deepEqual(edges.map(edgeLabel), [
    "W x=0 y 0..200",
    "E x=100 y 100..200",
    "E x=200 y 0..100",
    "S y=0 x 0..200",
    "N y=100 x 100..200",
    "N y=200 x 0..100",
  ])
})

test("partEdges drops the edges of a rectangle inside another", () => {
  const edges = partEdges(
    part("p", [
      [0, 0, 100, 100],
      [20, 20, 60, 60],
    ]),
  )
  assert.deepEqual(edges.map(edgeLabel), [
    "W x=0 y 0..100",
    "E x=100 y 0..100",
    "S y=0 x 0..100",
    "N y=100 x 0..100",
  ])
})

test("partEdges labels the stretch along another part as a seam", () => {
  const edges = partEdges(part("p", [[0, 0, 100, 100]]), [part("east", [[100, 0, 200, 50]])])
  assert.deepEqual(edges.map(edgeLabel), [
    "W x=0 y 0..100",
    "E x=100 y 0..50 (seam with east)",
    "E x=100 y 50..100",
    "S y=0 x 0..100",
    "N y=100 x 0..100",
  ])
})

test("partEdges judges a mask: a slanted edge faces out by its compass bearing, its ends west to east", () => {
  checkMask(SLANT)
  const edges = partEdges(SLANT)
  assert.deepEqual(edges.map(edgeLabel), [
    "W x=0 y 0..2000",
    "E x=2000 y 0..400",
    "S y=0 x 0..2000",
    "N y=2000 x 0..800",
    "NE 53° 800,2000..2000,400",
  ])
  assert.deepEqual(edges[4], { side: "NE", bearing: 53, x0: 800, y0: 2000, x1: 2000, y1: 400 })
  // A diamond, each edge facing a diagonal point: vertical edges come first, then horizontal ones,
  // then slanted ones by their west end.
  const diamond = part("d", [[0, 0, 1000, 1000]], [500, 0, 1000, 500, 500, 1000, 0, 500])
  checkMask(diamond)
  assert.deepEqual(partEdges(diamond).map(edgeLabel), [
    "SW 225° 0,500..500,0",
    "NW 315° 0,500..500,1000",
    "SE 135° 500,0..1000,500",
    "NE 45° 500,1000..1000,500",
  ])
})

test("partEdges: a mask edge along another part's rectangle is a seam, as is one along its mask", () => {
  assert.deepEqual(partEdges(SLANT, [BESIDE]).map(edgeLabel), [
    "W x=0 y 0..2000",
    "E x=2000 y 0..400 (seam with beside)",
    "S y=0 x 0..2000",
    "N y=2000 x 0..800",
    "NE 53° 800,2000..2000,400",
  ])
  // A part masked to the corner SLANT's mask leaves out: the slanted edge is all seam.
  const corner = part("corner", [[0, 0, 2000, 2000]], [2000, 400, 2000, 2000, 800, 2000])
  checkMask(corner)
  assert.deepEqual(partEdges(SLANT, [corner]).map(edgeLabel).slice(3), [
    "N y=2000 x 0..800",
    "NE 53° 800,2000..2000,400 (seam with corner)",
  ])
})

test("partEdges cuts an edge where a masked neighbour's play area stops beside it", () => {
  // The neighbour's rectangle runs the whole of WEST's east edge, its mask only the south 400 m.
  const east = part("east", [[1000, 0, 2000, 1000]], [1000, 0, 2000, 0, 2000, 1000, 1000, 400])
  checkMask(east)
  assert.deepEqual(partEdges(WEST, [east]).map(edgeLabel), [
    "W x=0 y 0..1000",
    "E x=1000 y 0..400 (seam with east)",
    "E x=1000 y 400..1000",
    "S y=0 x 0..1000",
    "N y=1000 x 0..1000",
  ])
})

test("nearestEdge measures to the closest edge, inside or out", () => {
  const edges = partEdges(part("p", [[0, 0, 100, 100]]))
  const outside = nearestEdge(edges, 50, 120)!
  assert.equal(outside.edge.side, "N")
  assert.equal(outside.distance, 20)
  assert.equal(nearestEdge(edges, 95, 40)!.edge.side, "E")
  assert.equal(nearestEdge([], 0, 0), undefined)
  // To a slanted edge along its normal: (1600, 1400) lies 280 m beyond SLANT's.
  const slanted = nearestEdge(partEdges(SLANT), 1600, 1400)!
  assert.equal(slanted.edge.side, "NE")
  assert.ok(Math.abs(slanted.distance - 280) < 1e-6)
})

test("clusters chain points at most `link` apart", () => {
  const pts: Array<P> = [
    [0, 0],
    [200, 0],
    [40, 0],
    [80, 0],
    [130, 0], // exactly 50 m from 80: still linked
    [300, 0],
    [-10, -10],
  ]
  assert.deepEqual(clusters(pts, 50), [[0, 2, 3, 4, 6], [1], [5]])
})

test("excursions finds a way that leaves the play area and comes back", () => {
  const [r, ...rest] = excursions(
    [
      {
        id: 1,
        pts: [
          [50, 50],
          [150, 50],
          [150, 80],
          [50, 80],
        ],
      },
    ],
    SQUARE,
    WIDE,
  ).reentries
  assert.equal(rest.length, 0)
  assert.ok(near(r!.exit, [100, 50]))
  assert.ok(near(r!.entry, [100, 80]))
  assert.ok(Math.abs(r!.length - 130) < 0.01)
  assert.ok(Math.abs(r!.depth - 50) < 0.01)
  assert.equal(r!.far[0], 150)
  assert.deepEqual(r!.lines, [1])
})

test("excursions follows a road split into several ways", () => {
  const [r, ...rest] = excursions(
    [
      {
        id: 1,
        pts: [
          [50, 50],
          [150, 50],
        ],
      },
      {
        id: 2,
        pts: [
          [150, 50],
          [150, 80],
        ],
      },
      {
        id: 3,
        pts: [
          [150, 80],
          [50, 80],
        ],
      },
    ],
    SQUARE,
    WIDE,
  ).reentries
  assert.equal(rest.length, 0)
  assert.ok(Math.abs(r!.length - 130) < 0.01)
  assert.deepEqual(r!.lines, [1, 2, 3])
})

test("excursions joins two roads that meet outside, not the one that runs on", () => {
  const found = excursions(
    [
      {
        id: 1,
        pts: [
          [50, 20],
          [130, 50],
        ],
      },
      {
        id: 2,
        pts: [
          [50, 80],
          [130, 50],
        ],
      },
      {
        id: 3,
        pts: [
          [130, 50],
          [300, 50],
        ],
      },
    ],
    SQUARE,
    WIDE,
  ).reentries
  assert.equal(found.length, 1)
  assert.deepEqual(found[0]!.lines, [1, 2])
  assert.ok(Math.abs(found[0]!.length - 2 * Math.hypot(30, 11.25)) < 0.01)
})

test("excursions skips a way that only leaves and ends before the fetched box's edge", () => {
  const dead = [
    {
      id: 1,
      pts: [
        [50, 50],
        [150, 50],
      ] as Array<P>,
    },
  ]
  assert.deepEqual(excursions(dead, SQUARE, WIDE), { reentries: [], unresolved: [] })
})

test("excursions reports a road that runs within 50 m of the fetched box's edge, or past it, without coming back as unresolved", () => {
  const { reentries, unresolved } = excursions(
    [
      // East past the box's edge at x 600.
      {
        id: 1,
        pts: [
          [50, 50],
          [700, 50],
        ],
      },
      // South to 20 m inside its edge at y −500.
      {
        id: 2,
        pts: [
          [30, 30],
          [30, -480],
        ],
      },
      // South to 60 m inside it: a dead end the box holds.
      {
        id: 3,
        pts: [
          [70, 30],
          [70, -440],
        ],
      },
    ],
    SQUARE,
    [-500, -500, 600, 600],
  )
  assert.deepEqual(reentries, [])
  assert.equal(unresolved.length, 2)
  const [east, south] = unresolved
  // Probed every 10 m outside: the first probe within 50 m of the edge.
  assert.ok(near(east!.exit, [100, 50]))
  assert.ok(near(east!.end, [560, 50]))
  assert.ok(Math.abs(east!.length - 460) < 0.01)
  assert.deepEqual(east!.lines, [1])
  assert.ok(near(south!.exit, [30, 0]))
  assert.ok(near(south!.end, [30, -460]))
  assert.deepEqual(south!.lines, [2])
})

test("excursions resolves a road that comes back, though a branch of it runs to the fetched box's edge first", () => {
  // The branch comes within 50 m of the edge at x 250 110 m out, before the loop is back at 130 m.
  const { reentries, unresolved } = excursions(
    [
      {
        id: 1,
        pts: [
          [50, 50],
          [150, 50],
          [150, 80],
          [50, 80],
        ],
      },
      {
        id: 2,
        pts: [
          [150, 50],
          [700, 50],
        ],
      },
    ],
    SQUARE,
    [-500, -500, 250, 600],
  )
  assert.equal(reentries.length, 1)
  assert.deepEqual(reentries[0]!.lines, [1])
  assert.deepEqual(unresolved, [])
})

test("excursions catches a segment cutting the inner corner of an L", () => {
  const [r, ...rest] = excursions(
    [
      {
        id: 7,
        pts: [
          [90, 40],
          [40, 90],
        ],
      },
    ],
    rects([0, 0, 100, 50], [0, 0, 50, 100]),
    WIDE,
  ).reentries
  assert.equal(rest.length, 0)
  assert.ok(near(r!.exit, [80, 50]))
  assert.ok(near(r!.entry, [50, 80]))
  assert.ok(Math.abs(r!.length - Math.hypot(30, 30)) < 0.01)
  assert.ok(Math.abs(r!.depth - 15) < 0.01)
})

test("excursions finds a road out across a mask's slanted edge and back, measured to the mask", () => {
  // All inside SLANT's rectangle, which alone would hold it.
  const lines = [
    {
      id: 9,
      pts: [
        [1300, 1000],
        [1700, 1300],
        [1500, 1500],
        [1100, 1300],
      ] as Array<P>,
    },
  ]
  assert.deepEqual(excursions(lines, rects([0, 0, 2000, 2000]), WIDE).reentries, [])
  const [r, ...rest] = excursions(lines, [SLANT], WIDE).reentries
  assert.equal(rest.length, 0)
  // The edge's line is 0.8 x + 0.6 y = 1840: the road crosses it 40% of the way to (1700, 1300),
  // 300 m beyond it, and 260/440 of the way from (1500, 1500), 260 m beyond it, back.
  const back = 260 / 440
  assert.ok(near(r!.exit, [1460, 1120]))
  assert.ok(near(r!.entry, [1500 - 400 * back, 1500 - 200 * back]))
  assert.deepEqual(r!.far, [1700, 1300])
  assert.ok(Math.abs(r!.depth - 300) < 1e-6)
  assert.ok(Math.abs(r!.length - (300 + Math.hypot(200, 200) + Math.hypot(400, 200) * back)) < 0.01)
  assert.deepEqual(r!.lines, [9])
})

test("excursions takes every part's play area as inside: out through a seam is not out", () => {
  // Out of WEST's east edge into EAST and back.
  const seam = [
    {
      id: 1,
      pts: [
        [900, 200],
        [1300, 200],
        [1300, 300],
        [900, 300],
      ] as Array<P>,
    },
  ]
  assert.equal(excursions(seam, [WEST], WIDE).reentries.length, 1)
  assert.deepEqual(excursions(seam, [WEST, EAST], WIDE).reentries, [])
  // Out of the open half of that edge and back in across EAST's north edge.
  const [r, ...rest] = excursions(
    [
      {
        id: 2,
        pts: [
          [900, 700],
          [1200, 700],
          [1200, 400],
          [900, 400],
        ],
      },
    ],
    [WEST, EAST],
    WIDE,
  ).reentries
  assert.equal(rest.length, 0)
  assert.ok(near(r!.exit, [1000, 700]))
  assert.ok(near(r!.entry, [1200, 500]))
  assert.ok(Math.abs(r!.length - 400) < 0.01)
  assert.equal(r!.depth, 200)
})

test("footprint-check throws on a mistyped flag before it reads or asks for anything", () => {
  const run = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "../footprint-check.ts"), "nope", "--refesh"],
    { encoding: "utf8" },
  )
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /Unknown option '--refesh'/)
})
