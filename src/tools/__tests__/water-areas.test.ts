// The water areas carved into a synthetic valley on the grid's lattice (water-areas.ts): a lake's
// level (its median, its spill, OSM's ele) and the shelf under it, two river polygons sharing a seam
// across a river and its tributary with a gravel bar, a river polygon with no river, the nodes the
// water keeps from the roads, and windows that carve every node as the whole grid does.
import assert from "node:assert/strict"
import { test } from "node:test"

import type { Area } from "../../sim/map/index.ts"
import type { Dem } from "../dtm.ts"
import type { WaterF } from "../features.ts"
import { pointInRing, segDist2 } from "../geometry.ts"
import { gridLattice, makeGrid, type Grid, type Span } from "../terrain.ts"
import { carveAreas, waterAreas, waterNodes, type CarvedArea } from "../water-areas.ts"
import { waterProfiles } from "../water.ts"

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
/** The nearest point on the profiles of `waters`, searched whole: its surface, and that water's depth. */
const nearest = (waters: ReadonlyArray<number>, x: number, y: number) => {
  let best = Infinity,
    out = { surface: NaN, depth: NaN }
  for (const w of waters) {
    const p = wp[w]!
    for (let k = 0; k + 1 < p.x.length; k++) {
      const { d2, t } = segDist2(x, y, p.x[k]!, p.y[k]!, p.x[k + 1]!, p.y[k + 1]!)
      if (d2 < best) {
        best = d2
        out = { surface: p.z[k]! + (p.z[k + 1]! - p.z[k]!) * t, depth: WATER[w]!.depth }
      }
    }
  }
  return out
}
/** The waterways of the first river polygon whose cells touch the node at (x, y), if any. */
const watersAt = (x: number, y: number) =>
  carved.find((a) => a.waters !== undefined && touches(a.rings[0]!, x, y))?.waters
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
      waters = watersAt(x, y)
    if (waters === undefined) assert.equal(z, z0, `(${x}, ${y}) outside`)
    else if (onEdge(x, y)) {
      assert.equal(z, z0, `(${x}, ${y}) on the outer edge`)
      count.edge++
    } else {
      const { surface, depth } = nearest(waters, x, y)
      if (z0 > surface + depth / 2 + 1) {
        assert.equal(z, z0, `bank (${x}, ${y})`)
        count.bank++
      } else {
        close(z, Math.min(z0, surface - depth / 2 - 0.05), `floor (${x}, ${y})`)
        count.floor++
        if (depth === STREAM.depth) count.stream++
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
    const { surface } = nearest(watersAt(x, y)!, x, y)
    close(at(raised, x, y), Math.max(z0, surface + 0.3), `bar (${x}, ${y}) raised`)
    if (at(raised, x, y) > z0) lifted++
  }
  assert.ok(lifted > 10, `${lifted} nodes of the bar raised`)
})

test("water areas: the seam between two river polygons across the river is carved as their inside, not left as an edge", () => {
  let seam = 0
  for (let y = 44; y <= 156; y += 4) {
    if (touches(BAR, 120, y)) continue
    assert.ok(touches(WEST, 120, y) && touches(EAST, 120, y) && !onEdge(120, y))
    const { surface, depth } = nearest([0], 120, y)
    close(at(raised, 120, y), surface - depth / 2 - 0.05, `seam (120, ${y})`)
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
