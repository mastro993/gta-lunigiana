import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { test } from "node:test"

import { clusters, edgeLabel, excursions, nearestEdge, outline } from "../footprint.ts"
import type { P } from "../geometry.ts"
import type { Rect } from "../region.ts"

const near = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01
/** A fetched box far beyond every line: nothing runs to its edge. */
const WIDE: Rect = [-1e4, -1e4, 1e4, 1e4]

test("outline of an L drops the shared edge and merges pieces on one line", () => {
  // A 200 m bar along the bottom and a 100 m column on its left: x 0..100 at y 100 is interior.
  const edges = outline([
    [0, 0, 200, 100],
    [0, 100, 100, 200],
  ])
  assert.deepEqual(edges.map(edgeLabel), [
    "W x=0 y 0..200",
    "E x=100 y 100..200",
    "E x=200 y 0..100",
    "S y=0 x 0..200",
    "N y=100 x 100..200",
    "N y=200 x 0..100",
  ])
})

test("outline drops the edges of a rectangle inside another", () => {
  const edges = outline([
    [0, 0, 100, 100],
    [20, 20, 60, 60],
  ])
  assert.deepEqual(edges.map(edgeLabel), [
    "W x=0 y 0..100",
    "E x=100 y 0..100",
    "S y=0 x 0..100",
    "N y=100 x 0..100",
  ])
})

test("outline labels the stretch along another part as a seam", () => {
  const edges = outline(
    [[0, 0, 100, 100]],
    [{ key: "east", title: "East", rects: [[100, 0, 200, 50]] }],
  )
  assert.deepEqual(edges.map(edgeLabel), [
    "W x=0 y 0..100",
    "E x=100 y 0..50 (seam with east)",
    "E x=100 y 50..100",
    "S y=0 x 0..100",
    "N y=100 x 0..100",
  ])
})

test("nearestEdge measures to the closest edge, inside or out", () => {
  const edges = outline([[0, 0, 100, 100]])
  const outside = nearestEdge(edges, 50, 120)!
  assert.equal(outside.edge.side, "N")
  assert.equal(outside.distance, 20)
  assert.equal(nearestEdge(edges, 95, 40)!.edge.side, "E")
  assert.equal(nearestEdge([], 0, 0), undefined)
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
    [[0, 0, 100, 100]],
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
    [[0, 0, 100, 100]],
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
    [[0, 0, 100, 100]],
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
  assert.deepEqual(excursions(dead, [[0, 0, 100, 100]], WIDE), { reentries: [], unresolved: [] })
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
    [[0, 0, 100, 100]],
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
    [[0, 0, 100, 100]],
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
    [
      [0, 0, 100, 50],
      [0, 0, 50, 100],
    ],
    WIDE,
  ).reentries
  assert.equal(rest.length, 0)
  assert.ok(near(r!.exit, [80, 50]))
  assert.ok(near(r!.entry, [50, 80]))
  assert.ok(Math.abs(r!.length - Math.hypot(30, 30)) < 0.01)
  assert.ok(Math.abs(r!.depth - 15) < 0.01)
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
