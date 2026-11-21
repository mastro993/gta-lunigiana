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

// Regression: a ditch on the terrace beside the Magra's polygon on the plain
// (1070845492), whose course outside the polygon came nearest, held its water 7.3 m over the Magra.
test("rivers: a river polygon holds its waterways' water where they run in it, not a ditch's beside it outside", () => {
  // A ditch on a terrace along the polygon's north side (y 150), turning into it at x 140.
  const ditch = piece(3, [40, 150, 140, 150, 140, 120], [103, 102.9, 97.4], [102.5, 102.4, 96.9])
  const ditched = waterIndex(
    [RIVER, ditch],
    [{ kind: "river", rings: [[50, 60, 150, 60, 150, 140, 50, 140]], waters: [0, 1] }],
  )
  // 14 m from the ditch's course outside, 36 m from the river.
  assert.equal(
    ditched.at(60, 136, 96.5, Q)!.level,
    index.at(60, 136, 96.5, Q)!.level,
    "the river's level",
  )
  // On the ditch's own course inside the polygon, the ditch's water, 1.2 m over the river's floor.
  const own = ditched.at(140, 130, 96.5, Q)!
  assert.ok(own.level > index.at(140, 130, 96.5, Q)!.level + 1, `the ditch's level ${own.level}`)
  assert.ok(own.vx === 0 && own.vy < 0, "running down its own course")
  // Ending on the polygon's outline, 0.05 m in as rounding leaves it (`IN_POLYGON`), it runs in none
  // of it: 10 m from its end, the river's level.
  const ending = piece(
    4,
    [40, 150, 140, 150, 140, 139.95],
    [103, 102.9, 102.3],
    [102.5, 102.4, 101.8],
  )
  const ends = waterIndex(
    [RIVER, ending],
    [{ kind: "river", rings: [[50, 60, 150, 60, 150, 140, 50, 140]], waters: [0, 1] }],
  )
  assert.equal(
    ends.at(130, 138, 96.5, Q)!.level,
    index.at(130, 138, 96.5, Q)!.level,
    "the river's level by a ditch ending on the outline",
  )
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
// Lunigiana's south bound (y −8500 since Sarzana's part), north of which the tile line y = CUT
// (−8000) runs: pieces A and C over the tiles x 0 … 2000 and 2000 … 4000 north of it, B a strip of
// the tile south of it, all sea, cut to the bound. A has an islet, a hole in it. Every edge but the
// coast's and the islet's is a cut.
const SOUTH = MAP.bounds.minY
const CUT = TILE * Math.ceil(SOUTH / TILE)
const COAST = CUT + 1600
const ISLET = [990, CUT + 210, 1010, CUT + 210, 1010, CUT + 190, 990, CUT + 190]
const sea = (rings: ReadonlyArray<ReadonlyArray<number>>): Area => ({
  kind: "sea",
  level: 0,
  rings,
})
const SEA_A = sea([[0, CUT, TILE, CUT, TILE, COAST, 0, COAST], ISLET])
const SEA_B = sea([[0, SOUTH, TILE, SOUTH, TILE, CUT, 0, CUT]])
const SEA_C = sea([[TILE, CUT, 2 * TILE, CUT, 2 * TILE, COAST, TILE, COAST]])

test("rivers: the sea's way to the bank is toward its coast, never toward where the build cut it at a tile's side or the map's bounds", () => {
  assert.ok(SOUTH > CUT - TILE && SOUTH % TILE !== 0, "a bound off the tile lines")
  const index = waterIndex([], [SEA_A, SEA_B, SEA_C])
  for (const [x, y, bankX, bankY, why] of [
    [TILE - 5, COAST - 600, 0, 1, "5 m from the tile line x 2000, 600 m from the coast"],
    [TILE + 5, COAST - 600, 0, 1, "across the tile line, in the next tile's piece"],
    [1000, SOUTH + 5, 0, 1, "5 m from the bound, in a piece with no coast of its own"],
    [970, CUT + 200, 1, 0, "beside the islet: its shore is a shore"],
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

// Regression: the coastline's segments closing the Magra across its mouth were the sea's coast, so
// a swimmer off the mouth headed across them into the river, where its bank sent it back out to
// sea, and it slid along the mouth between the two instead of swimming for the beach.
test("rivers: a sea piece's edge closing a river across its mouth is no coast: a swimmer off the mouth heads for the beach beside it", () => {
  // SEA_C's coast with a river's mouth 100 m wide in it, the river polygon over the mouth sharing
  // the closure, its waterway running down into the sea.
  const mouth = sea([
    [TILE, CUT, 2 * TILE, CUT, 2 * TILE, COAST, 3050, COAST, 2950, COAST, TILE, COAST],
  ])
  const river: Area = {
    kind: "river",
    rings: [[2950, COAST, 3050, COAST, 3050, COAST + 300, 2950, COAST + 300]],
    waters: [0],
  }
  const index = waterIndex(
    [piece(4, [3000, COAST + 300, 3000, COAST], [1, 0.2], [0, -0.5])],
    [mouth, river],
  )
  for (const [x, y, bankX, bankY, why] of [
    [3010, COAST - 20, 2 / Math.sqrt(5), 1 / Math.sqrt(5), "off the mouth: the beach's corner"],
    [2500, COAST - 20, 0, 1, "off the beach: the beach"],
  ] as const) {
    const here = index.at(x, y, -8, Q)
    assert.ok(here?.level === 0, `the sea at (${x}, ${y})`)
    assertBank(here, bankX, bankY, `at (${x}, ${y}), ${why}`)
  }
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
