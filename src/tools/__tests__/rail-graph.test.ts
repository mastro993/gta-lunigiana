import assert from "node:assert/strict"
import { test } from "node:test"

import type { RailF } from "../features.ts"
import type { V } from "../geometry.ts"
import { findLines, kindsOf, splitAtJunctions } from "../rail-graph.ts"

const piece = (pts: ReadonlyArray<number>) => ({
  pts,
  z: Array.from({ length: pts.length / 2 }, () => 100),
})
/** The map's edge in these tests: x = 0 or x = 1000. */
const edge = (x: number) => x === 0 || x === 1000
const railsOf = (lines: ReturnType<typeof findLines>) =>
  lines.map((l) => l.pieces.map((p) => p.rail))

// Regression: a branch joining at a vertex inside a running piece made a
// terminal there, so a train run out past it would cross the main line.
test("splitAtJunctions cuts a piece at an inner vertex another track shares, keeping its id", () => {
  const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })
  const main: RailF = { id: 7, pts: [v(0, 0, "a"), v(400, 0, "sw"), v(1000, 0, "b")] }
  const siding: RailF = { id: -1, pts: [v(400, 0, "sw"), v(600, 30)] }
  const out = splitAtJunctions([main], [main, siding])
  assert.deepEqual(
    out.map((p) => [p.id, p.pts.map((u) => u.id)]),
    [
      [7, ["a", "sw"]],
      [7, ["sw", "b"]],
    ],
  )
  // Unsplit, the line finder refuses a piece running through a junction.
  assert.throws(
    () => findLines([piece([0, 0, 400, 0, 1000, 0]), piece([400, 0, 600, 30])], edge),
    /runs through a junction at \(400,0\)/,
  )
})

// Regression: OSM's passing loops and sidings carry no kind, and were lines.
test("findLines runs edge to edge straight through turnouts; kindsOf makes the rest loops and sidings", () => {
  // The line in three pieces; a passing loop beside its middle (diverging 3°) and a yard: a siding
  // off the line with a second siding off it, both ending in the open.
  const rail = [
    piece([0, 0, 300, 0]),
    piece([300, 0, 700, 0]),
    piece([700, 0, 1000, 0]),
    piece([300, 0, 400, 5, 600, 5, 700, 0]),
    piece([700, 0, 800, -8]),
    piece([800, -8, 900, -8]),
    piece([800, -8, 900, -14]),
  ]
  const lines = findLines(rail, edge)
  assert.deepEqual(railsOf(lines), [[0, 1, 2]])
  assert.deepEqual(kindsOf(rail, lines), [
    undefined,
    undefined,
    undefined,
    "loop",
    "siding",
    "siding",
    "siding",
  ])
  // A dead end inside the map is no terminal: a spur leaves no line of its own.
  assert.deepEqual(railsOf(findLines([...rail, piece([300, 0, 350, 40])], edge)), [[0, 1, 2]])
})

test("findLines takes junction headings over 5 m, not off one short end segment", () => {
  // The through piece's end segments, 0.3 m long, turn 12° (the 0.1 m grid); a passing loop leaves
  // at 6°. Off single segments both walks would take the loop, turning 12° in all.
  const rail = [
    piece([0, 0, 300, 0]),
    piece([300, 0, 300.3, 0.064, 699.7, 0.064, 700, 0]),
    piece([700, 0, 1000, 0]),
    piece([300, 0, 400, 10.5, 600, 10.5, 700, 0]),
  ]
  const lines = findLines(rail, edge)
  assert.deepEqual(railsOf(lines), [[0, 1, 2]])
  assert.deepEqual(kindsOf(rail, lines), [undefined, undefined, undefined, "loop"])
})

test("findLines finds no line on a ring with no way off the map, and kindsOf makes it a loop", () => {
  const rail = [
    piece([100, 100, 200, 100]),
    piece([200, 100, 200, 200]),
    piece([200, 200, 100, 200]),
    piece([100, 200, 100, 100]),
  ]
  const lines = findLines(rail, edge)
  assert.deepEqual(lines, [])
  assert.deepEqual(kindsOf(rail, lines), ["loop", "loop", "loop", "loop"])
})
