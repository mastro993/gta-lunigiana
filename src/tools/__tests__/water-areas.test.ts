// The water areas carved into a synthetic valley on the grid's lattice (water-areas.ts): a lake's
// level (its median, its spill, OSM's ele, a pool's spill as a stream carves it) and the shelf
// under it, two river polygons sharing a seam across a river and its tributary with a gravel bar, a
// river polygon with no river, the nodes the water keeps from the roads, and windows that carve
// every node as the whole grid does; and on a beach of its own, the sea carved to its floor and a
// breakwater raised over it.
import assert from "node:assert/strict"
import { test } from "node:test"

import { insideSpans } from "../../sim/collide.ts"
import type { Area } from "../../sim/map/index.ts"
import { IN_POLYGON } from "../../sim/map/kinds.ts"
import { firstCarving } from "../build-grid.ts"
import { coastIndex } from "../coast.ts"
import type { Dem } from "../dtm.ts"
import type { WaterF } from "../features.ts"
import { pointInRing, ringBox, segDist2 } from "../geometry.ts"
import { seaFloor } from "../sea-floor.ts"
import { gridLattice, makeGrid, type Grid, type Span } from "../terrain.ts"
import {
  carveAreas,
  holdsCell,
  raiseAreas,
  seaNodes,
  waterAreas,
  waterLevel,
  waterNodes,
  type CarvedArea,
} from "../water-areas.ts"
import { carveAll, waterProfiles } from "../water.ts"

/** The scene: the lattice's 101 × 51 nodes (4 m apart) from its node at x = 0, y = 0. */
const lattice = gridLattice(),
  COLS = 101,
  ROWS = 51,
  WHOLE: Span = {
    i0: -lattice.x0 / lattice.cell,
    j0: -lattice.y0 / lattice.cell,
    cols: COLS,
    rows: ROWS,
  }

/** A ring of `n` vertices round (cx, cy), radius r, counter-clockwise. */
const circle = (cx: number, cy: number, r: number, n = 24) =>
  Array.from({ length: n }, (_, k) => [
    cx + r * Math.cos((2 * Math.PI * k) / n),
    cy + r * Math.sin((2 * Math.PI * k) / n),
  ]).flat()

// Two river polygons meeting across the river at x = 120, a gravel bar on their seam, a bank 3 m
// over the river inside the west one; a lake with an island; a pool on a terrace no river reaches.
// No edge of the rectangles or the bar runs through a cell's centre, so a cell is in or out alike
// by the fill and by `pointInRing`.
const WEST = [20, 40, 120, 40, 120, 160, 20, 160]
const EAST = [120, 40, 220, 40, 220, 160, 120, 160]
const BAR = [100, 120, 120, 110, 140, 120, 120, 130]
const HUMP = { x: 60, y: 140, r: 10 } as const
const LAKE = circle(300, 100, 40)
const ISLAND = { x: 290, y: 90, r: 10 } as const
const POOL = [364, 160, 388, 160, 388, 184, 364, 184]

/**
 * The LiDAR: a valley falling 1 % east, the bank 3 m over it and the bar read a metre low; east of
 * x = 250 the lake's surface read flat at 95 m, its island at 99 m, its shore a 3 m step up to
 * 98 m, the terrace at 104 m and, with `outlet`, a channel at 94 m leaving the lake east.
 */
const ground =
  (outlet: boolean) =>
  (x: number, y: number): number => {
    if (x < 250) {
      const z = 100 - 0.01 * x
      if (pointInRing(x, y, BAR)) return z - 1
      return Math.hypot(x - HUMP.x, y - HUMP.y) < HUMP.r ? z + 3 : z
    }
    if (outlet && x > 337 && Math.abs(y - 100) < 8) return 94
    if (Math.hypot(x - ISLAND.x, y - ISLAND.y) < ISLAND.r) return 99
    if (pointInRing(x, y, LAKE)) return 95
    return x > 352 && y > 144 ? 104 : 98
  }
const demOf = (at: (x: number, y: number) => number): Dem => ({
  at,
  grid: (span) => makeGrid(at, span),
})
const basin = demOf(ground(false)),
  dem = demOf(ground(true))

const RIVER: WaterF = {
  id: 1,
  kind: "river",
  w: 8,
  bed: 6,
  depth: 1.5,
  pts: [
    { x: 0, y: 100, id: "a" },
    { x: 120, y: 96 },
    { x: 180, y: 98, id: "c" },
    { x: 240, y: 100, id: "b" },
  ],
  from: 0,
}
/** A tributary joining the river inside the east polygon. */
const STREAM: WaterF = {
  id: 2,
  kind: "stream",
  w: 2,
  bed: 2,
  depth: 0.5,
  pts: [
    { x: 180, y: 200 },
    { x: 180, y: 98, id: "c" },
  ],
  from: 0,
}
const WATER = [RIVER, STREAM]
const AREAS: ReadonlyArray<Area> = [
  { kind: "river", rings: [WEST] },
  { kind: "river", rings: [EAST] },
  { kind: "pebble", rings: [BAR] },
  { kind: "lake", rings: [LAKE] },
  { kind: "river", rings: [POOL] },
]
const wp = waterProfiles(WATER, dem.at)
const { areas, carved } = waterAreas(AREAS, WATER, wp, dem)
/** The lake again with OSM's `ele` over its spill. */
const ele = waterAreas([{ kind: "lake", rings: [LAKE], level: 95.5 }], [], [], dem)

const bare = dem.grid(WHOLE)
const carve = (these: ReadonlyArray<CarvedArea>, raiseBars: boolean, span = WHOLE): Grid => {
  const g = dem.grid(span)
  carveAreas(g, these, WATER, wp, raiseBars)
  return g
}
const raised = carve(carved, true),
  kept = carve(carved, false),
  raisedEle = carve(ele.carved, true)
const at = (g: Grid, x: number, y: number) => g.z[(y / 4) * COLS + x / 4]!
/** Every node of the scene: its x, its y. */
const NODES = Array.from(
  { length: COLS * ROWS },
  (_, k) => [4 * (k % COLS), 4 * Math.floor(k / COLS)] as const,
)

/** The centres of the four cells round the node at (x, y). */
const cellsRound = (x: number, y: number) =>
  [
    [x - 2, y - 2],
    [x + 2, y - 2],
    [x - 2, y + 2],
    [x + 2, y + 2],
  ] as const
/** Whether a cell of `ring` (its centre inside) touches the node at (x, y). */
const touches = (ring: ReadonlyArray<number>, x: number, y: number) =>
  cellsRound(x, y).some(([cx, cy]) => pointInRing(cx, cy, ring))
/** Whether a cell round the node at (x, y) lies in none of the scene's water areas. */
const onEdge = (x: number, y: number) =>
  cellsRound(x, y).some(([cx, cy]) => ![WEST, EAST, LAKE, POOL].some((r) => pointInRing(cx, cy, r)))
/** Distance from (x, y) to the nearest edge of `ring`, m. */
const shore = (ring: ReadonlyArray<number>, x: number, y: number) => {
  let best = Infinity
  for (let k = 0, n = ring.length; k < n; k += 2)
    best = Math.min(
      best,
      segDist2(x, y, ring[k]!, ring[k + 1]!, ring[(k + 2) % n]!, ring[(k + 3) % n]!).d2,
    )
  return Math.sqrt(best)
}
/**
 * The nearest point on the profiles of `waters` where they run in `ring` (each 2 m segment cut
 * where it crosses its edges), searched whole: its surface, and that water's depth.
 */
const nearest = (
  waters: ReadonlyArray<number>,
  ring: ReadonlyArray<number>,
  x: number,
  y: number,
) => {
  const spans = insideSpans([ring], IN_POLYGON)
  let best = Infinity,
    out = { surface: NaN, depth: NaN }
  for (const w of waters) {
    const p = wp[w]!
    for (let k = 0; k + 1 < p.x.length; k++)
      for (const [t0, t1] of spans(p.x[k]!, p.y[k]!, p.x[k + 1]!, p.y[k + 1]!)) {
        const dx = p.x[k + 1]! - p.x[k]!,
          dy = p.y[k + 1]! - p.y[k]!
        const { d2, t } = segDist2(
          x,
          y,
          p.x[k]! + dx * t0,
          p.y[k]! + dy * t0,
          p.x[k]! + dx * t1,
          p.y[k]! + dy * t1,
        )
        if (d2 < best) {
          const along = t0 + (t1 - t0) * t
          best = d2
          out = { surface: p.z[k]! + (p.z[k + 1]! - p.z[k]!) * along, depth: WATER[w]!.depth }
        }
      }
  }
  return out
}
/** The nearest point on its waterways (`nearest`) of each river polygon whose cells touch the node at (x, y), in their order. */
const riversAt = (x: number, y: number) =>
  carved
    .filter((a) => a.waters !== undefined && touches(a.rings[0]!, x, y))
    .map((a) => nearest(a.waters!, a.rings[0]!, x, y))
const close = (a: number, b: number, what: string) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a}, want ${b}`)

/**
 * Checks each node of the still water `ring` at `level` in `g`: its edge raised to the level, the
 * ground no more than a metre over it carved to the level less 0.1 m a metre from the shore (3 m at
 * most), higher ground left. Counts the nodes of each kind.
 */
const checkStill = (g: Grid, ring: ReadonlyArray<number>, level: number) => {
  const count = { raised: 0, shelf: 0, deepest: 0, bank: 0 }
  for (const [x, y] of NODES) {
    if (!touches(ring, x, y)) continue
    const z = at(g, x, y),
      z0 = at(bare, x, y)
    if (onEdge(x, y)) {
      assert.equal(z, Math.max(z0, level), `edge (${x}, ${y}) holds the water`)
      if (z > z0) count.raised++
    } else if (z0 > level + 1) {
      assert.equal(z, z0, `bank (${x}, ${y}) left`)
      count.bank++
    } else {
      const d = pointInRing(x, y, ring) ? shore(ring, x, y) : 0
      close(z, Math.min(z0, level - Math.min(3, 0.1 * d)), `bed (${x}, ${y})`)
      if (0.1 * d >= 3) count.deepest++
      else count.shelf++
    }
  }
  return count
}

test("water areas: a lake takes the median of the LiDAR inside it, no higher than its spill, OSM's ele over both; a river polygon its waterways, tributaries too, or with none still water", () => {
  const lake = (on: Dem) => waterAreas([{ kind: "lake", rings: [LAKE] }], [], [], on)
  assert.equal(lake(basin).areas[0]!.level, 95, "the basin's median, under its shore")
  assert.equal(lake(dem).areas[0]!.level, 94, "spilling at its outlet")
  assert.equal(ele.areas[0]!.level, 95.5, "OSM's ele")
  assert.deepEqual(
    areas.map((a) => [a.kind, a.level, a.waters]),
    [
      ["river", undefined, [0]],
      ["river", undefined, [0, 1]],
      ["pebble", undefined, undefined],
      ["lake", 94, undefined],
      ["river", 104, undefined],
    ],
  )
})

test("water areas: a lake is carved to its level less 0.1 m a metre from its shore, 3 m at most, an island over it left and its edge raised to hold it", () => {
  const spill = checkStill(raised, LAKE, 94)
  assert.ok(spill.shelf > 200 && spill.deepest > 10 && spill.bank > 20, JSON.stringify(spill))
  assert.equal(at(raised, 300, 100), 91, "3 m deep at its middle")
  assert.equal(at(raised, 288, 88), 99, "the island")
  assert.ok(onEdge(340, 100))
  assert.equal(
    at(raised, 340, 100),
    94,
    "the outlet's node on the shore, at the level it spills at",
  )
  assert.equal(at(raised, 344, 100), 94, "the outlet beyond the shore, the ground's")
  // With OSM's ele over the outlet, the shore is raised to hold the water.
  const held = checkStill(raisedEle, LAKE, 95.5)
  assert.ok(held.raised > 0 && held.shelf > 20 && held.bank > 4, JSON.stringify(held))
  assert.equal(at(raisedEle, 340, 100), 95.5, "the outlet's node raised to the level")
  // The pool no river reaches is carved as a lake.
  const pool = checkStill(raised, POOL, 104)
  assert.ok(pool.shelf > 10 && pool.bank === 0, JSON.stringify(pool))
})

test("water areas: a river polygon is carved to its waterways' floor at the nearest point, a bank over the river and its outer edge left, the ground outside untouched", () => {
  const count = { floor: 0, stream: 0, bank: 0, edge: 0 }
  for (const [x, y] of NODES) {
    if (x >= 250 || touches(BAR, x, y)) continue // the lake's and the bar's own tests
    const z = at(raised, x, y),
      z0 = at(bare, x, y),
      rivers = riversAt(x, y)
    if (rivers.length === 0) assert.equal(z, z0, `(${x}, ${y}) outside`)
    else if (onEdge(x, y)) {
      assert.equal(z, z0, `(${x}, ${y}) on the outer edge`)
      count.edge++
    } else {
      // Each polygon in turn, on the ground the one before left: on its seam, the lower floor.
      let want = z0,
        reached = false,
        stream = false
      for (const { surface, depth } of rivers) {
        if (want > surface + depth / 2 + 1) continue
        reached = true
        if (surface - depth / 2 - 0.05 < want)
          [want, stream] = [surface - depth / 2 - 0.05, depth === STREAM.depth]
      }
      if (reached) {
        close(z, want, `floor (${x}, ${y})`)
        count.floor++
        if (stream) count.stream++
      } else {
        assert.equal(z, z0, `bank (${x}, ${y})`)
        count.bank++
      }
    }
  }
  assert.ok(
    count.floor > 1000 && count.stream > 20 && count.bank > 10 && count.edge > 100,
    JSON.stringify(count),
  )
  assert.equal(at(raised, 60, 140), at(bare, 60, 140), "the bank")
  for (const [x, y] of [
    [20, 100],
    [220, 100],
    [100, 40],
    [180, 160],
  ] as const)
    assert.equal(at(raised, x, y), at(bare, x, y), `(${x}, ${y}) on the outline`)
})

test("water areas: a gravel bar in a river polygon is raised 0.3 m over the surface in the pass that raises bars and left in the other", () => {
  let lifted = 0
  for (const [x, y] of NODES) {
    const z0 = at(bare, x, y)
    if (!touches(BAR, x, y)) {
      assert.ok(Object.is(at(kept, x, y), at(raised, x, y)), `(${x}, ${y}) off the bar`)
      continue
    }
    assert.equal(at(kept, x, y), z0, `bar (${x}, ${y}) left`)
    const top = Math.max(...riversAt(x, y).map(({ surface }) => surface + 0.3))
    close(at(raised, x, y), Math.max(z0, top), `bar (${x}, ${y}) raised`)
    if (at(raised, x, y) > z0) lifted++
  }
  assert.ok(lifted > 10, `${lifted} nodes of the bar raised`)
})

// Regression: OSM maps the Tassonaro 6 m off the LiDAR's channel above its mouth, and the ground at
// its river polygon's outline lay under its floor: the water drawn to the outline stood over it.
test("water areas: a river polygon's outer edge under its waterways' floor is raised to it in the pass before the claims, and left by the pass after them", () => {
  // A ditch 5 m deep along the west polygon's south outline, x 40…80.
  const lowered = demOf((x, y) => ground(true)(x, y) - (y < 43 && x > 37 && x < 83 ? 5 : 0))
  const before = lowered.grid(WHOLE),
    after = lowered.grid(WHOLE)
  carveAreas(before, carved, WATER, wp, false)
  carveAreas(after, carved, WATER, wp, true)
  let edge = 0
  for (let x = 40; x <= 80; x += 4) {
    assert.ok(onEdge(x, 40) && touches(WEST, x, 40))
    const z0 = at(lowered.grid(WHOLE), x, 40),
      { surface, depth } = nearest([0], WEST, x, 40)
    assert.ok(z0 < surface - depth / 2, `(${x}, 40) under the floor`)
    close(at(before, x, 40), surface - depth / 2 + 0.05, `(${x}, 40) raised`)
    assert.equal(at(after, x, 40), z0, `(${x}, 40) left`)
    edge++
  }
  assert.equal(edge, 11)
})

// Regression: a ditch on the terrace beside the Magra's polygon on the plain
// (1070845492), whose course outside the polygon came nearest, held its water 7.3 m over the Magra.
test("water areas: a river polygon reads its waterways where they run in it, not a ditch's course on the terrace beside it", () => {
  // A plain at 10 m under a terrace at 14 m north of y 124; a polygon x 20…220, y 40…120, its river
  // along y 60; a ditch along the terrace (y 130), turning down into the polygon at x 200.
  const plain = demOf((_, y) => (y > 124 ? 14 : 10))
  const river: WaterF = {
    id: 1,
    kind: "river",
    w: 8,
    bed: 6,
    depth: 1.5,
    pts: [
      { x: 0, y: 60 },
      { x: 240, y: 60 },
    ],
    from: 0,
  }
  const ditch: WaterF = {
    id: 2,
    kind: "stream",
    w: 2,
    bed: 3,
    depth: 1,
    pts: [
      { x: 20, y: 130 },
      { x: 200, y: 130 },
      { x: 200, y: 108 },
    ],
    from: 0,
  }
  const both = [river, ditch],
    profiles = waterProfiles(both, plain.at)
  const terrace = waterAreas(
    [{ kind: "river", rings: [[20, 40, 220, 40, 220, 120, 20, 120]] }],
    both,
    profiles,
    plain,
  )
  assert.deepEqual(terrace.areas[0]!.waters, [0, 1], "the ditch is one of its waterways")
  const g = plain.grid(WHOLE)
  carveAreas(g, terrace.carved, both, profiles, false)
  // 14 m from the ditch's course outside, 56 m from the river: the river's water, on its floor.
  const level = waterLevel(terrace.carved, both, profiles)
  close(level(60, 116)!, 10 - 0.75, "the river's surface at (60, 116)")
  close(at(g, 60, 116), 10 - 1.5 - 0.05, "carved to the river's floor")
  // On the ditch's own course inside the polygon, the ditch's water.
  close(level(200, 112)!, 10 - 0.5, "the ditch's surface at (200, 112)")
})

test("water areas: the seam between two river polygons across the river is carved as their inside, not left as an edge", () => {
  let seam = 0
  for (let y = 44; y <= 156; y += 4) {
    if (touches(BAR, 120, y)) continue
    assert.ok(touches(WEST, 120, y) && touches(EAST, 120, y) && !onEdge(120, y))
    // Each polygon reads the river where it runs in it: the seam, the lower of their floors.
    const floor = Math.min(
      ...riversAt(120, y).map(({ surface, depth }) => surface - depth / 2 - 0.05),
    )
    close(at(raised, 120, y), floor, `seam (120, ${y})`)
    seam++
  }
  assert.ok(seam > 20)
})

test("water areas: windows meeting at a column through the lake and its outlet, or at a row across the river polygons and the bar, carve every node as the whole grid does", () => {
  // The lake at its spill and at OSM's ele, which raises its shore at the outlet.
  for (const [whole, these] of [
    [raised, carved],
    [raisedEle, ele.carved],
  ] as const)
    for (const [axis, n] of [
      ["column", 75],
      ["column", 85],
      ["row", 30],
    ] as const)
      for (const [from, size] of [
        [0, n + 1],
        [n, (axis === "column" ? COLS : ROWS) - n],
      ] as const) {
        const span: Span =
          axis === "column"
            ? { ...WHOLE, i0: WHOLE.i0 + from, cols: size }
            : { ...WHOLE, j0: WHOLE.j0 + from, rows: size }
        const part = carve(these, true, span)
        part.z.forEach((z, k) => {
          const i = (axis === "column" ? from : 0) + (k % span.cols),
            j = (axis === "row" ? from : 0) + Math.floor(k / span.cols)
          assert.ok(
            Object.is(z, whole.z[j * COLS + i]),
            `node (${4 * i}, ${4 * j}) of the window from ${axis} ${from}${these === carved ? "" : ", with ele"}`,
          )
        })
      }
})

test("water areas: the water's level is a still water's, a river polygon's waterways' surface at the nearest point, and none on dry ground", () => {
  const level = waterLevel(carved, WATER, wp)
  assert.equal(level(300, 120), areas[3]!.level, "in the lake")
  assert.equal(level(375, 170), areas[4]!.level, "in the pool no river reaches")
  // In the west river polygon 20 m off the river, its surface at x 60.
  const river = wp[0]!
  const at = river.x.findIndex((x) => x >= 60)
  assert.ok(Math.abs(level(60, 77)! - river.z[at]!) < 0.05, `${level(60, 77)} by the river at x 60`)
  assert.equal(level(240, 20), undefined, "on dry ground")
})

test("water areas: the water keeps from the roads a lake's nodes to its edge and a river polygon's but its outer edge", () => {
  const wet = waterNodes(dem.grid(WHOLE), carved)
  NODES.forEach(([x, y], k) => {
    const still = touches(LAKE, x, y) || touches(POOL, x, y),
      river = touches(WEST, x, y) || touches(EAST, x, y)
    assert.equal(wet[k], still || (river && !onEdge(x, y)) ? 1 : 0, `(${x}, ${y})`)
  })
  for (const [x, y, want] of [
    [20, 100, 0],
    [60, 100, 1],
    [120, 100, 1],
    [340, 100, 1],
    [300, 100, 1],
    [8, 100, 0],
  ] as const)
    assert.equal(wet[(y / 4) * COLS + x / 4], want, `(${x}, ${y})`)
})

// Regression: two pools on the Torrente Arcinasso by the Fosso di Paretola's mouth (OSM 1473224065
// and 1473224067), every node of theirs on their edge, kept the LiDAR's 258.0 and 265.2 m when
// Aulla's part carved the stream through them: their water stood over every node of theirs.
test("water areas: a lake no node of whose cells lies inside its edge stands at its spill as the streams through it carve it", () => {
  const flat = demOf(() => 100)
  // One cell, round (398, 98): its four nodes all on its edge, 2 m off the brook's centreline.
  const pond: Area = { kind: "lake", rings: [[397, 97, 399, 97, 399, 99, 397, 99]] }
  const brook: WaterF = {
    id: 3,
    kind: "stream",
    w: 4,
    bed: 3,
    depth: 1,
    pts: [
      { x: 380, y: 98 },
      { x: 420, y: 98 },
    ],
    from: 0,
  }
  const level = (water: ReadonlyArray<WaterF>) =>
    waterAreas([pond], water, waterProfiles(water, flat.at), flat).areas[0]!.level
  // The brook's surface 99.5 m, its floor 99.0 m out to w/2, where the cell's nodes lie.
  assert.equal(level([brook]), 99)
  assert.equal(level([]), 100, "no stream through it: the LiDAR's ground")
})

// Regression: the Cascata del Corso's pool (−14157, 1256), every node of it on its edge, took its
// spill 244.5 m from the lines carved once, where the tile pass carves them twice, and its lowest
// edge node, on the bank of the stream falling past it, stood at 243.9 m as built: its water
// floated over it.
test("water areas: a lake no node of whose cells lies inside its edge stands at its spill as the tile pass leaves its edge, the lines carved before the claims and again after them", () => {
  // A brook falling 0.25 m a metre east along y = 91 past a pond on flat ground at 100 m: one cell,
  // round (398, 98), its south nodes 5 m off the brook's centreline, on its bank (from 3 m out,
  // `bed`, to a cell further), where each 2 m segment of the brook in reach lowers them toward its
  // own gravel; its north nodes 9 m off it, past it.
  const falls = demOf((x, y) => (y < 94 ? 100 - (x - 380) / 4 : 100))
  const pond: Area = { kind: "lake", rings: [[397, 97, 399, 97, 399, 99, 397, 99]] }
  const brook: WaterF = {
    id: 3,
    kind: "stream",
    w: 2,
    bed: 3,
    depth: 1,
    pts: [
      { x: 380, y: 91 },
      { x: 420, y: 91 },
    ],
    from: 0,
  }
  const wp = waterProfiles([brook], falls.at),
    {
      areas: [lake],
      carved: here,
    } = waterAreas([pond], [brook], wp, falls)
  /** The pond's four nodes on a window round it (x 376…408, y 80…112) once `carve` has run, rounded as built. */
  const pondNodes = (carve: (win: Grid) => void) => {
    const win = falls.grid({ i0: WHOLE.i0 + 94, j0: WHOLE.j0 + 20, cols: 9, rows: 9 })
    carve(win)
    return [396, 400].flatMap((x) =>
      [96, 100].map((y) => Math.round(win.z[(y / 4 - 20) * 9 + x / 4 - 94]! * 10) / 10),
    )
  }
  // The tile pass: its first carving, no claims, then the second.
  const built = pondNodes((win) => {
    firstCarving(win, here, [], [brook], wp)
    carveAreas(win, here, [brook], wp, true)
    carveAll(win, [brook], wp)
  })
  const once = pondNodes((win) => carveAll(win, [brook], wp))
  assert.ok(Math.min(...built) < Math.min(...once), `${built} as built, ${once} carved once`)
  assert.equal(lake!.level, Math.min(...built), "its spill as built")
})

// Regression: a 6.0 m² pool under a path's bridge at the Mulini Bozzo Luero (OSM 1032984030, round
// (−15432, 1585)) held no cell's centre: nothing drew or carved its water, and the game read still
// water 0.8 m deep over the ground under it.
test("water areas: a ring holds a cell where a cell's centre lies inside it, as the land cover fills it", () => {
  // The lattice's cells are centred 2 m off its nodes, which lie on multiples of 4 m here.
  assert.ok(holdsCell([[397, 97, 399, 97, 399, 99, 397, 99]]), "round the centre (398, 98)")
  assert.ok(!holdsCell([[399, 99, 401, 99, 401, 101, 399, 101]]), "round the node (400, 100)")
  assert.ok(!holdsCell([[396.5, 96.5, 397.5, 96.5, 397.5, 97.5]]), "a sliver short of it")
  assert.ok(holdsCell([LAKE]))
})

// The sea: a coastline running east along y = 31, the land north of it (OSM's rule), the sea south
// of it to past the scene's edges, its survey's 2 m line along y = 12, and a breakwater out in it,
// on a beach rising 5 % north from 0.2 m under the sea's level at the shore (a hollow behind it),
// over the sea's flat 0 m (the terrain chain's sea step).
const SEA = [-8, -8, 408, -8, 408, 31, -8, 31]
const BREAKWATER = [151, 7, 169, 7, 169, 13, 151, 13]
const FLOOR = seaFloor(
  coastIndex([
    {
      pts: [
        [-100, 31],
        [500, 31],
      ],
      closed: false,
    },
  ]),
  [
    {
      id: 1,
      depth: 2,
      pts: [
        [-100, 12],
        [500, 12],
      ],
    },
  ],
)
const beach = demOf((_x, y) => (y < 31 ? 0 : -0.2 + 0.05 * (y - 31)))
const sea = waterAreas([{ kind: "sea", level: 0, rings: [SEA] }], [], [], beach, FLOOR)
const seaGrid = (raiseBars: boolean, span = WHOLE): Grid => {
  const g = beach.grid(span)
  carveAreas(g, sea.carved, [], [], raiseBars)
  return g
}
const seaFirst = seaGrid(false),
  beachBare = beach.grid(WHOLE)

test("water areas: the sea keeps its level and takes its floor, and a sea with no floor given is refused", () => {
  assert.deepEqual(
    sea.areas.map((a) => [a.kind, a.level]),
    [["sea", 0]],
  )
  assert.equal(sea.carved[0]!.floor, FLOOR)
  assert.throws(
    () => waterAreas([{ kind: "sea", level: 0, rings: [SEA] }], [], [], beach),
    /no floor/,
  )
})

test("water areas: the sea is carved node by node to its floor in the pass before the claims, the shore's nodes left at the beach's height, and left by the pass after them", () => {
  let wet = 0
  for (const [x, y] of NODES) {
    const z = at(seaFirst, x, y)
    if (y < 31) {
      assert.equal(z, FLOOR(x, y), `(${x}, ${y}) at the floor`)
      wet++
    } else assert.equal(z, at(beachBare, x, y), `(${x}, ${y}) on the beach`)
  }
  assert.equal(wet, 8 * COLS)
  assert.equal(at(seaFirst, 100, 12), -2, "on the survey's 2 m line")
  assert.ok(at(seaFirst, 100, 28) > at(seaFirst, 100, 20), "the floor falls from the shore")
  assert.ok(at(seaFirst, 100, 32) < 0, "the shore's first node, under the level, not raised to it")
  assert.deepEqual(seaGrid(true).z, beachBare.z, "the pass after the claims leaves the sea")
})

test("water areas: the sea's nodes, the catchments' outlets, are those carved to its floor, and no lake's", () => {
  const nodes = seaNodes(beach.grid(WHOLE), [...sea.carved, ...carved])
  NODES.forEach(([x, y], k) => assert.equal(nodes[k], y < 31 ? 1 : 0, `(${x}, ${y})`))
})

test("water areas: windows meeting at a column or a row through the sea carve every node as the whole grid does", () => {
  for (const [axis, n] of [
    ["column", 40],
    ["row", 4],
  ] as const)
    for (const [from, size] of [
      [0, n + 1],
      [n, (axis === "column" ? COLS : ROWS) - n],
    ] as const) {
      const span: Span =
        axis === "column"
          ? { ...WHOLE, i0: WHOLE.i0 + from, cols: size }
          : { ...WHOLE, j0: WHOLE.j0 + from, rows: size }
      seaGrid(false, span).z.forEach((z, k) => {
        const i = (axis === "column" ? from : 0) + (k % span.cols),
          j = (axis === "row" ? from : 0) + Math.floor(k / span.cols)
        assert.ok(
          Object.is(z, seaFirst.z[j * COLS + i]),
          `node (${4 * i}, ${4 * j}) from ${axis} ${from}`,
        )
      })
    }
})

test("water areas: a breakwater raised in the sea stands at its top over the floor on every node its cells touch, and the sea round it is left", () => {
  const g = seaGrid(false)
  raiseAreas(g, [{ rings: [BREAKWATER], box: ringBox(BREAKWATER), top: 1.5 }])
  let raised = 0
  for (const [x, y] of NODES) {
    if (touches(BREAKWATER, x, y)) {
      assert.equal(at(g, x, y), 1.5, `(${x}, ${y}) on the breakwater`)
      raised++
    } else assert.equal(at(g, x, y), at(seaFirst, x, y), `(${x}, ${y}) in the sea`)
  }
  // Its cells, centred at x 154…166 and y 10, touch 5 × 2 nodes.
  assert.equal(raised, 5 * 2)
})
