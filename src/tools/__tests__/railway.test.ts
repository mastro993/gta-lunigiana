import assert from "node:assert/strict"
import { test } from "node:test"

import { findLines } from "../rail-graph.ts"
import { crossingBoxes, maxspeedOf, stationsOf } from "../railway.ts"

const piece = (pts: ReadonlyArray<number>, maxspeed?: number) => ({
  ...(maxspeed === undefined ? {} : { maxspeed }),
  pts,
  z: Array.from({ length: pts.length / 2 }, () => 100),
})

// A line from (0, 0) east to (300, 10) in five pieces (the last one drawn backwards), a branch
// leaving it at (100, 0) for (150, 60), and a loop beside it from (50, 0) to (150, 0).
const rail = [
  piece([0, 0, 50, 0], 80),
  piece([50, 0, 100, 0], 80),
  piece([100, 0, 150, 0], 80),
  piece([150, 0, 200, 0], 80),
  piece([300, 10, 200, 0], 100),
  piece([100, 0, 150, 60]),
  piece([50, 0, 50, 5, 150, 5, 150, 0]),
]
const lines = findLines(rail, () => true)

test("maxspeedOf merges the pieces of one limit, and a line with no tag has none", () => {
  const [main, branch] = lines
  assert.deepEqual(
    main!.pieces.map((p) => p.rail),
    [0, 1, 2, 3, 4],
  )
  assert.deepEqual(maxspeedOf(main!, rail), [
    [0, 200, 80],
    [200, 300.5, 100],
  ])
  assert.deepEqual(
    branch!.pieces.map((p) => p.rail),
    [0, 1, 5],
  )
  assert.deepEqual(maxspeedOf(branch!, rail), [[0, 100, 80]], "the untagged branch has no limit")
})

test("crossingBoxes groups a road's crossing nodes within 10 m, at the line's s of the one on it", () => {
  const boxes = crossingBoxes(
    [
      { road: 4, node: 11, x: 300, y: 10, piece: 4, vertex: 0 }, // the line's end: piece 4 is walked backwards
      { road: 7, node: 20, x: 150, y: 5, piece: 6, vertex: 2 }, // the loop's crossing, 5 m from the line's
      { road: 7, node: 21, x: 150, y: 0, piece: 3, vertex: 0 },
      { road: 7, node: 30, x: 50, y: 5, piece: 6, vertex: 1 }, // 100 m on, a vertex of the loop alone: a box on no line
    ],
    lines,
    rail,
  )
  assert.deepEqual(
    boxes.map(({ road, nodes, line, s }) => ({ road, nodes, line, s })),
    [
      { road: 4, nodes: [11], line: 0, s: 300.5 },
      { road: 7, nodes: [20, 21], line: 0, s: 150 },
      { road: 7, nodes: [30], line: -1, s: -1 },
    ],
  )
  assert.deepEqual([boxes[1]!.x, boxes[1]!.y], [150, 2.5])
})

test("stationsOf spans a station's platforms beside the line and its stop nodes, on the biggest platform's side", () => {
  const [main] = lines
  const platform = (x0: number, x1: number, y0: number, y1: number, name: string) => ({
    rings: [[x0, y0, x1, y0, x1, y1, x0, y1]],
    name,
    area: (x1 - x0) * (y1 - y0),
  })
  const stations = stationsOf(
    [main!],
    [
      platform(20, 80, -6, -1.6, "Sud"), // right of the line, which runs east
      platform(30, 60, 1.6, 3, "Sud"), // a smaller one on the left
      platform(120, 160, 1.6, 4, "Nord"),
      platform(20, 80, 10, 14, "Sud"), // 10 m off: not beside the line
    ],
    [
      { name: "Sud", x: 15, y: 0 }, // a stop position before the platforms
      { name: "Nord", x: 140, y: 30 }, // the station node on the building, 30 m off
    ],
  )
  assert.deepEqual(stations, [
    { name: "Sud", line: 0, s0: 15, s1: 80, side: 1 },
    { name: "Nord", line: 0, s0: 120, s1: 160, side: -1 },
  ])
})
