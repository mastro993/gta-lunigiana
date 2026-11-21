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

// Regression: where Aulla's double track joins the single track north of it (P.P. Chiesaccia), the
// second track runs straight on past its switch into a safety stub; the walk took the stub, ended in
// it and left that track no line, though it runs on to the map's edge across the switch.
test("findLines turns off a stub that leads only to dead ends in the map, onto the track leading on", () => {
  // Two tracks 4 m apart from the west edge; the north one's switch at x 560 turns 5.7° onto the
  // south one at x 600, its stub running straight on to a buffer at x 650; one track on to the east edge.
  const rail = [
    piece([0, 0, 600, 0]),
    piece([600, 0, 1000, 0]),
    piece([0, 4, 560, 4]),
    piece([560, 4, 650, 4]),
    piece([560, 4, 600, 0]),
  ]
  const lines = findLines(rail, edge)
  // The lines in the order of their first piece.
  assert.deepEqual(railsOf(lines), [
    [0, 1],
    [2, 4, 1],
  ])
  assert.deepEqual(kindsOf(rail, lines), [undefined, undefined, undefined, "siding", undefined])
})

test("findLines ends a walk at a terminus reached along the piece its trains come in on, running the line toward it; from the other side the walk goes through", () => {
  // A through track with a terminus at x 400, which trains reach from the west (piece 0, drawn east to west); a passing loop
  // beside it from x 700.
  const rail = [
    piece([400, 0, 0, 0]),
    piece([400, 0, 700, 0]),
    piece([700, 0, 1000, 0]),
    piece([400, 0, 500, 5, 600, 5, 700, 0]),
  ]
  const termini = new Map([["400,0", { pieces: new Set([0]), station: "T" }]])
  const lines = findLines(rail, edge, termini)
  assert.deepEqual(
    lines.map((l) => [l.pieces, l.terminus]),
    [
      [
        [
          { rail: 0, rev: true },
          { rail: 1, rev: false },
          { rail: 2, rev: false },
        ],
        false,
      ],
      [[{ rail: 0, rev: true }], true],
    ],
  )
  assert.deepEqual(kindsOf(rail, lines), [undefined, undefined, undefined, "loop"])
  // Reached from the east only, the terminus ends no walk from the west.
  const east = findLines(rail, edge, new Map([["400,0", { pieces: new Set([1]), station: "T" }]]))
  assert.deepEqual(
    east.map((l) => [railsOf([l])[0], l.terminus]),
    [
      [[0, 1, 2], false],
      [[2, 1], true],
    ],
  )
})

// Regression: where two lines meet (Sarzana's part: the Pontremolese's double track, the Genova–Pisa's and the link between
// them at Santo Stefano di Magra), the straightest walk kept one line per terminal and none on the track it did not take:
// the Pontremolese's second track, through Aulla Lunigiana's platforms, and the link the Milano–Livorno trains run.
test("findLines runs each of OSM's train routes from terminal to terminal, crossovers and branches as the route takes them; the straightest way where none runs", () => {
  // Two tracks between x 0 and x 1000, 4 m apart: A (ways 10, 11) and B (20, 21), a crossover from A at x 400 onto B at
  // x 500 (way 30) and a branch off A at x 400 to the east edge at y −200 (way 40).
  const way = (pts: ReadonlyArray<number>, id: number) => ({ ...piece(pts), way: id })
  const rail = [
    way([0, 0, 400, 0], 10),
    way([400, 0, 1000, 0], 11),
    way([0, 4, 500, 4], 20),
    way([500, 4, 1000, 4], 21),
    way([400, 0, 500, 4], 30),
    way([400, 0, 500, -10, 1000, -200], 40),
  ]
  // The straightest walks keep A and B whole and the branch, and leave the crossover a loop.
  assert.deepEqual(railsOf(findLines(rail, edge)), [
    [0, 5],
    [0, 1],
    [2, 3],
  ])
  // A route from A's west end over the crossover onto B's east end, one onto the branch, and one on B whose run leaves the
  // map (its next way, 99, runs nowhere in it): the first two make lines; B's west end gets the straightest walk.
  const routes = [
    [10, 30, 21],
    [40, 10],
    [20, 99],
  ]
  const lines = findLines(rail, edge, new Map(), routes)
  assert.deepEqual(railsOf(lines), [
    [0, 5],
    [0, 4, 3],
    [0, 1],
    [2, 3],
  ])
  assert.deepEqual(kindsOf(rail, lines), [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ])
})

// Regression: Lucca–Aulla's two routes end at Aulla Lunigiana's two termini (the Aulla => Pisa route starts at track 4, the
// Pisa => Aulla Lunigiana one ends at track 5), and each made a line of its own the whole way from Pieve San Lorenzo.
test("findLines ends one line from a terminal at a station's termini, the one turning less, whichever routes reach them", () => {
  // From the west edge to a switch at x 400: track 4 runs straight on to its terminus at x 600, track 5 leaves at 5.7° to its
  // own at (600, 5); one route leaves track 4's, the other comes in to track 5's.
  const way = (pts: ReadonlyArray<number>, id: number) => ({ ...piece(pts), way: id })
  const rail = [way([0, 0, 400, 0], 1), way([400, 0, 600, 0], 2), way([400, 0, 450, 5, 600, 5], 3)]
  const termini = new Map([
    ["600,0", { pieces: new Set([1]), station: "Aulla" }],
    ["600,5", { pieces: new Set([2]), station: "Aulla" }],
  ])
  const routes = [
    [2, 1],
    [1, 3],
  ]
  assert.deepEqual(railsOf(findLines(rail, edge, termini, routes)), [[0, 1]])
  // Two stations' termini end a line each.
  const two = new Map([...termini].map(([k, t], i) => [k, { ...t, station: `S${i}` }]))
  assert.deepEqual(railsOf(findLines(rail, edge, two, routes)), [
    [0, 2],
    [0, 1],
  ])
})
