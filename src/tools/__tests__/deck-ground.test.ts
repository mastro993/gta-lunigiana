import assert from "node:assert/strict"
import { test } from "node:test"

import {
  clearRun,
  deckGround,
  deckReport,
  END_RUN,
  jointsOf,
  meshZ,
  railSlab,
  roadSlab,
  sections,
  type Slab,
  slabNodes,
} from "../deck-ground.ts"
import type { Grid } from "../terrain.ts"
import { deckShortfalls, meshOf } from "./decks.ts"

/** A 4 m grid of 41 × 21 nodes from (0, 0), its node (i, j) at `z(x, y)`. */
const grid = (z: (x: number, y: number) => number): Grid => {
  const cols = 41,
    rows = 21
  return {
    cell: 4,
    cols,
    rows,
    x0: 0,
    y0: 0,
    ax: 0,
    ay: 0,
    z: Float64Array.from({ length: cols * rows }, (_, n) =>
      z((n % cols) * 4, Math.floor(n / cols) * 4),
    ),
  }
}
const node = (g: Grid, i: number, j: number) => j * g.cols + i
/** Where the ground reaches into `slabs`, one bridge's pieces, on `g`'s mesh (decks.ts). */
const short = (g: Grid, ...slabs: ReadonlyArray<Slab>) =>
  deckShortfalls(
    slabs.map((slab, k) => [`piece ${k}`, slab] as const),
    meshOf({ heightmap: { ...g, data: Array.from(g.z, (z) => Math.round(z * 10)) } }),
  )
/** The stretch between `slab`'s end runs on `g`'s mesh, both its ends outer ones. */
const runOf = (g: Grid, slab: Slab) =>
  clearRun(
    sections(slab, (x, y) => meshZ(g, x, y)),
    [true, true],
  )
/** A tertiary road's deck 6.5 m wide along y 40 from x 22 to x 138 (mid-cell, clear of the nodes), its profile `za` to `zb`. */
const tertiary = (za: number, zb: number) =>
  roadSlab(
    { cls: "tertiary", w: 6.5 },
    { pts: [22, 40, 80, 40, 138, 40], z: [za, (za + zb) / 2, zb] },
  )

test("meshZ reads a cell as the game draws it: two triangles split along its south-west to north-east diagonal", () => {
  const g = grid(() => 0)
  // Cell (1, 1): its south-west node 0, south-east 1, north-west 2, north-east 4.
  ;[g.z[node(g, 2, 1)], g.z[node(g, 1, 2)], g.z[node(g, 2, 2)]] = [1, 2, 4]
  assert.equal(meshZ(g, 7, 5), 1.5, "south-east of the diagonal: 0.75 of the way east, 0.25 north")
  assert.equal(meshZ(g, 5, 7), 2, "north-west of it")
  assert.equal(meshZ(g, 8, 8), 4)
})

test("deckGround lowers a hump between a deck's end runs to the slab's underside, and no other node", () => {
  // A valley 10 m under a level deck, its approaches at the deck's level behind its ends (x 20 and
  // x 140), and a hump 0.36 m under the deck's top at x 80, across the slab and a cell either side.
  const g = grid((x, y) => (x <= 20 || x >= 140 ? 10 : x === 80 && y >= 32 && y <= 48 ? 9.8 : 0))
  const deck = tertiary(10, 10)
  assert.equal(short(g, deck).length, 1)
  // The approaches behind the ends are the roads' cores: they keep their level.
  const approach = (n: number) => n % g.cols <= 5 || n % g.cols >= 35
  const moved = deckGround(g, [deck], approach)
  // Under the slab (y 36.35–43.65) the top is 10.16 m: 0.9 m under it, floored to 0.1 m.
  assert.deepEqual(
    [8, 9, 10, 11, 12].map((j) => g.z[node(g, 20, j)]),
    [9.8, 9.2, 9.2, 9.2, 9.8],
  )
  assert.deepEqual(
    [5, 35].map((i) => g.z[node(g, i, 10)]),
    [10, 10],
  )
  const { nodes, deepest } = deckReport(moved)
  assert.equal(nodes, 3)
  assert.ok(Math.abs(deepest - 0.6) < 1e-9, `${deepest}`)
  assert.deepEqual(short(g, deck), [])
  // The deck stands clear of the valley from its ends, where it leaves its approaches in the air.
  assert.deepEqual(runOf(g, deck), [0, 116])
})

test("deckGround leaves a bank its slab's edge grazes, lowering the ground under the slab instead", () => {
  // A deck 7.6 m wide along y 40 over a valley at 0 m, its slab reaching y 44.2, 0.2 m into the
  // cells of a bank 20 m high from y 48: under the slab the valley's nodes weigh most, so the bank
  // stays (capping every corner of the cells the slab reaches over cut it to the slab, 10.8 m).
  const g = grid((_, y) => (y >= 48 ? 20 : 0))
  const deck = roadSlab({ cls: "tertiary", w: 7.6 }, { pts: [22, 40, 138, 40], z: [10, 10] })
  assert.deepEqual(
    deckGround(g, [deck], () => false),
    [],
  )
  assert.deepEqual(short(g, deck), [])
  // A knoll at the bank's foot, under the slab's edge at x 80, 0.94 m over its underside: it comes
  // down past the underside, for the bank's weight under the edge, and the bank stays.
  const h = grid((x, y) => (y >= 48 ? 20 : y === 44 && x === 80 ? 10.2 : 0))
  assert.deepEqual(runOf(h, deck), [0, 116])
  deckGround(h, [deck], () => false)
  assert.deepEqual(short(h, deck), [])
  assert.equal(h.z[node(h, 20, 12)], 20)
  assert.ok(h.z[node(h, 20, 11)]! < 9.26, `${h.z[node(h, 20, 11)]}`)
})

test("deckGround keeps a deck's end runs, where it meets the ground, under the road, END_RUN m at most, and the ground out of its slab past them", () => {
  // The SP59's bridge by Vinca (310573976): falling 5% from its end on a hillside 0.34 m over the
  // road, the deck stands clear of the valley only 19 m along. Its end run stops END_RUN in.
  const g = grid((x) => (x <= 40 ? 12.5 : 0))
  const deck = tertiary(12, 6)
  assert.deepEqual(runOf(g, deck), [END_RUN, 116])
  assert.equal(short(g, deck).length, 1)
  deckGround(g, [deck], () => false)
  assert.deepEqual(short(g, deck), [])
  // The hillside comes down along the end run, under the road: at x 24 the profile is 11.90 m.
  assert.ok(g.z[node(g, 6, 10)]! <= 11.9, `${g.z[node(g, 6, 10)]}`)
  // Past it, out of the slab: at x 32 (10 m along) the top is 11.64 m, its underside 10.74 m.
  assert.ok(g.z[node(g, 8, 10)]! <= 10.74, `${g.z[node(g, 8, 10)]}`)
  // Behind the end, and a cell either side of the cells the slab reaches over, it stays.
  for (const [i, j] of [
    [4, 10],
    [6, 8],
    [10, 12],
  ] as const)
    assert.equal(g.z[node(g, i, j)], 12.5)
})

test("deckGround lowers the ground under a deck lying on it past its end runs, and a rail deck's off its ballast", () => {
  // A deck on the ground the whole way (an OSM bridge drawn over a bank: 143 m of a Cesena one), a
  // bump 0.3 m over its profile at x 80. Past END_RUN its slab's underside is 9.26 m.
  const g = grid((x, y) => (x === 80 && y === 40 ? 10.3 : 10))
  const deck = tertiary(10, 10)
  assert.deepEqual(runOf(g, deck), [END_RUN, 112])
  deckGround(g, [deck], () => false)
  assert.deepEqual(
    [9, 10, 11].map((j) => g.z[node(g, 20, j)]),
    [9.1, 9.2, 9.2],
  )
  // Behind its ends and two rows off its line, the bank stays.
  for (const [i, j] of [
    [5, 10],
    [35, 10],
    [20, 8],
    [20, 12],
  ] as const)
    assert.equal(g.z[node(g, i, j)], 10)
  assert.deepEqual(short(g, deck), [])
  // A rail deck over the same bump: the ballast's top is 0.04 m over the bed.
  const h = grid((x, y) => (x === 80 && y === 40 ? 10.3 : 0))
  const rail = railSlab({ pts: [22, 40, 138, 40], z: [10, 10] })
  assert.equal(rail.half, 2)
  deckGround(h, [rail], () => false)
  assert.equal(h.z[node(h, 20, 10)], 9.1)
  assert.deepEqual(short(h, rail), [])
})

test("deckGround lowers the ground at a joint between two pieces of a deck as under the deck whole", () => {
  // The first test's hump under x 80, where OSM splits the deck into two ways: the joint is
  // mid-bridge, no end run, though each piece's slab first lies in the ground there.
  const ground = (x: number, y: number) =>
    x <= 20 || x >= 140 ? 10 : x === 80 && y >= 32 && y <= 48 ? 9.8 : 0
  const whole = grid(ground),
    split = grid(ground)
  const pieces = [
    roadSlab({ cls: "tertiary", w: 6.5 }, { pts: [22, 40, 80, 40], z: [10, 10] }),
    roadSlab({ cls: "tertiary", w: 6.5 }, { pts: [80, 40, 138, 40], z: [10, 10] }),
  ]
  assert.deepEqual(jointsOf(pieces), [
    [[], [1]],
    [[0], []],
  ])
  assert.equal(short(split, ...pieces).length, 2)
  const approach = (n: number) => n % whole.cols <= 5 || n % whole.cols >= 35
  deckGround(whole, [tertiary(10, 10)], approach)
  deckGround(split, pieces, approach)
  assert.deepEqual(split.z, whole.z)
  assert.deepEqual(short(split, ...pieces), [])
  // A deck meeting the joint 0.5 m or more off its level is no piece of it.
  assert.deepEqual(jointsOf([pieces[0]!, { ...pieces[1]!, lift: pieces[1]!.lift + 0.5 }]), [
    [[], []],
    [[], []],
  ])
})

test("slabNodes lists the corners of the cells a slab reaches over, flagging those abeam of its deck", () => {
  const g = grid(() => 0)
  const nodes = new Map(slabNodes(g, [tertiary(10, 10)]))
  // Rows 9–11 (y 36–44) round a slab reaching y 36.35–43.65; columns 5–35 (x 20–140).
  assert.equal(nodes.size, 3 * 31)
  assert.equal(nodes.get(node(g, 20, 10)), true)
  assert.equal(nodes.get(node(g, 20, 9)), true, "y 36: beside the slab, between the deck's ends")
  assert.equal(nodes.get(node(g, 5, 10)), false, "x 20: behind the deck's end")
  assert.equal(nodes.get(node(g, 35, 9)), false, "x 140: past its far end")
  assert.equal(nodes.get(node(g, 20, 8)), undefined)
})
