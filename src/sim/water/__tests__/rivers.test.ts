import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import type { Area, Water } from "../../map/index.ts"
import { STAGE } from "../channel.ts"
import { waterIndex } from "../rivers.ts"

/** A water piece along `pts` (flat), its surface `z`, floor `floor` and catchment `area` per vertex. */
const piece = (
  id: number,
  pts: ReadonlyArray<number>,
  z: ReadonlyArray<number>,
  floor: ReadonlyArray<number>,
): Water => ({
  id,
  kind: "river",
  w: 8,
  bed: 6,
  depth: 1.5,
  pts,
  z,
  area: z.map(() => 10),
  floor,
})

// A river east along y = 100 through a polygon (x 50…150, y 60…140) with an island round (120, 125);
// a lake at 95 m (x 300…340, y 80…120) a stream runs through.
const RIVER = piece(1, [0, 100, 100, 100, 200, 100], [99, 98, 97], [98, 97, 96])
const STREAM = piece(2, [290, 100, 350, 100], [94, 93.5], [92, 91.5])
const ISLAND = [115, 125, 120, 120, 125, 125, 120, 130]
const AREAS: ReadonlyArray<Area> = [
  { kind: "river", rings: [[50, 60, 150, 60, 150, 140, 50, 140], ISLAND], waters: [0] },
  { kind: "forest", rings: [[0, 0, 400, 0, 400, 200, 0, 200]] },
  { kind: "lake", rings: [[300, 80, 340, 80, 340, 120, 300, 120]], level: 95 },
]
const index = waterIndex([RIVER, STREAM], AREAS)
const Q = 0.5

/** Asserts the way to the bank of `here` is (x, y), to rounding (a zero may come out as -0). */
const assertBank = (
  here: { readonly bankX: number; readonly bankY: number },
  x: number,
  y: number,
  message: string,
) =>
  assert.ok(
    Math.abs(here.bankX - x) < 1e-9 && Math.abs(here.bankY - y) < 1e-9,
    `${message}: (${here.bankX}, ${here.bankY})`,
  )

test("rivers: a river polygon holds its river's water to its outline, with its current, its island dry", () => {
  const mid = index.at(100, 100, 96.5, Q)!,
    off = index.at(100, 136, 96.5, Q)!
  assert.ok(mid !== undefined && off !== undefined, "on the line and 36 m off it, in the polygon")
  assert.equal(off.level, mid.level, "the line's level across the polygon")
  assert.ok(off.vx > 0 && off.vy === 0, "running downstream")
  assertBank(off, 0, 1, "the bank: square to the reach, on the point's side")
  assert.equal(index.at(100, 150, 96.5, Q), undefined, "past the polygon, beyond the river's bed")
  assert.equal(index.at(120, 125, 96.5, Q), undefined, "on the island")
  assert.ok(index.at(20, 103, 97.5, Q) !== undefined, "outside the polygon, the river's own bed")
})

test("rivers: two river polygons of one river meeting across it send a body to the same bank either side of their seam", () => {
  // The river's polygon cut in two at x = 100: the seam is no bank, though it is each one's nearest edge.
  const halves = waterIndex(
    [RIVER],
    [
      { kind: "river", rings: [[50, 60, 100, 60, 100, 140, 50, 140]], waters: [0] },
      { kind: "river", rings: [[100, 60, 150, 60, 150, 140, 100, 140]], waters: [0] },
    ],
  )
  for (const [x, y, bankY] of [
    [97, 120, 1],
    [103, 120, 1],
    [97, 80, -1],
    [103, 80, -1],
  ] as const) {
    const here = halves.at(x, y, 96.5, Q)
    assert.ok(here !== undefined, `in the water at (${x}, ${y})`)
    assertBank(here, 0, bankY, `at (${x}, ${y}), the bank across the river`)
  }
})

test("rivers: a lake stands still at its level, the bank toward its nearest shore, over a stream through it", () => {
  const lake = index.at(335, 100, 93, Q)!
  assert.deepEqual(lake, { depth: 2, level: 95, vx: 0, vy: 0, bankX: 1, bankY: 0 })
  assert.equal(index.at(320, 100, 95.2, Q), undefined, "a floor over the level is dry")
  assert.ok(index.at(345, 100, 91, Q)!.level < 94, "past its shore, the stream's own water")
  assert.deepEqual(index.at(335, 100, 93, Q), lake, "the same answer again")
})

test("rivers: a water area's surface whatever the flow, as the render draws it", () => {
  const [lake, river] = index.pools
  assert.equal(lake!.level, 95, "lakes first")
  assert.deepEqual(index.surface(lake!, 320, 100), { bed: 95, stage: 0, ux: 1, uy: 0, speed: 0 })
  const s = index.surface(river!, 140, 130)
  assert.ok(Math.abs(s.bed - 96.6) < 1e-9, "the bed of the nearest reach, 40 m along it")
  assert.ok(s.stage > 0 && s.speed > 0 && s.ux === 1)
  const level = index.at(140, 130, 96, Q)!.level
  assert.ok(Math.abs(level - (s.bed + s.stage * Ops.pow(Q, STAGE))) < 1e-9, "the level it rises to")
})
