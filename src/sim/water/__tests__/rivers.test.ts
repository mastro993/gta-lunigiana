import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { type Area, MAP, TILE, type Water } from "../../map/index.ts"
import { channelOf, SPEED, STAGE } from "../channel.ts"
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
  assert.deepEqual(lake!.surface(320, 100), { bed: 95, stage: 0, ux: 1, uy: 0, speed: 0 })
  const s = river!.surface(140, 130)
  assert.ok(Math.abs(s.bed - 96.6) < 1e-9, "the bed of the nearest reach, 40 m along it")
  assert.ok(s.stage > 0 && s.speed > 0 && s.ux === 1)
  const level = index.at(140, 130, 96, Q)!.level
  assert.ok(Math.abs(level - (s.bed + s.stage * Ops.pow(Q, STAGE))) < 1e-9, "the level it rises to")
})

// The sea as the map build cuts it: a piece per tile, each a tile's square cut to the map's bounds.
// Here a coast runs east along y = COAST across two tiles (x 0 … 4000), the sea south of it down to
// Lunigiana's south bound (y −6100), which the tile line y = −6000 crosses: pieces A and C over the
// tiles x 0 … 2000 and 2000 … 4000 north of y −6000, B a strip of the tile south of it, all sea,
// cut to the bound. A has an islet, a hole in it. Every edge but the coast's and the islet's is a cut.
const COAST = -4400
const SOUTH = MAP.bounds.minY
const ISLET = [990, -5790, 1010, -5790, 1010, -5810, 990, -5810]
const sea = (rings: ReadonlyArray<ReadonlyArray<number>>): Area => ({
  kind: "sea",
  level: 0,
  rings,
})
const SEA_A = sea([[0, -3 * TILE, TILE, -3 * TILE, TILE, COAST, 0, COAST], ISLET])
const SEA_B = sea([[0, SOUTH, TILE, SOUTH, TILE, -3 * TILE, 0, -3 * TILE]])
const SEA_C = sea([[TILE, -3 * TILE, 2 * TILE, -3 * TILE, 2 * TILE, COAST, TILE, COAST]])

test("rivers: the sea's way to the bank is toward its coast, never toward where the build cut it at a tile's side or the map's bounds", () => {
  assert.ok(SOUTH > -3 * TILE - TILE && SOUTH % TILE !== 0, "a bound off the tile lines")
  const index = waterIndex([], [SEA_A, SEA_B, SEA_C])
  for (const [x, y, bankX, bankY, why] of [
    [TILE - 5, -5000, 0, 1, "5 m from the tile line x 2000, 600 m from the coast"],
    [TILE + 5, -5000, 0, 1, "across the tile line, in the next tile's piece"],
    [1000, SOUTH + 5, 0, 1, "5 m from the bound, in a piece with no coast of its own"],
    [970, -5800, 1, 0, "beside the islet: its shore is a shore"],
  ] as const) {
    const here = index.at(x, y, -8, Q)
    assert.ok(here?.level === 0, `the sea at (${x}, ${y}), at 0 m`)
    assert.deepEqual([here.vx, here.vy], [0, 0], "still")
    assertBank(here, bankX, bankY, `at (${x}, ${y}), ${why}`)
  }
  // With no coast in any piece the lookup holds, the way to the bank is toward the nearest edge, cut or not.
  const alone = waterIndex([], [SEA_B]).at(1000, SOUTH + 5, -8, Q)!
  assertBank(alone, 0, -1, "a piece alone, all cuts: its nearest edge")
})

test("rivers: no river stands under the sea: where its bed lies below 0 m it stands at the sea's level, the same flow running slower through the deeper water, and a spate lifts it over", () => {
  // A stream into the sea, its bed 1.5 m under sea level and falling.
  const MOUTH = piece(3, [2000, -4000, 2000, -4300], [0.3, 0], [-1.5, -2])
  const index = waterIndex([MOUTH], [])
  const ch = channelOf(MOUTH),
    [x, y] = [2000, -4150]
  const bed = (ch.bed[0]! + ch.bed[1]!) / 2,
    stage = (ch.stage[0]! + ch.stage[1]!) / 2,
    speed = (ch.speed[0]! + ch.speed[1]!) / 2
  const low = 0.01,
    mean = stage * Ops.pow(low, STAGE)
  assert.ok(bed + mean < 0, `the stream alone would stand at ${(bed + mean).toFixed(2)} m`)
  const held = index.at(x, y, bed, low)!
  assert.equal(held.level, 0, "at the sea's level")
  assert.ok(Math.abs(held.depth + bed) < 1e-9, `${held.depth.toFixed(2)} m over its bed`)
  const v = Ops.hypot(held.vx, held.vy),
    free = speed * Ops.pow(low, SPEED)
  assert.ok(
    Math.abs(v - (free * mean) / -bed) < 1e-9,
    `${v.toFixed(3)} m/s, ${free.toFixed(3)} free`,
  )
  assert.equal(index.at(x, y, 0.1, low), undefined, "dry over the sea's level")
  // A spate that lifts it over the sea's level runs as any river does.
  let spate = 1
  while (bed + stage * Ops.pow(spate, STAGE) <= 0.2) spate *= 2
  const over = index.at(x, y, bed, spate)!
  assert.ok(Math.abs(over.level - (bed + stage * Ops.pow(spate, STAGE))) < 1e-9, "over the sea")
  assert.ok(Math.abs(Ops.hypot(over.vx, over.vy) - speed * Ops.pow(spate, SPEED)) < 1e-9)
})
