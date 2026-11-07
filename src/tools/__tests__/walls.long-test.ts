import assert from "node:assert/strict"
import { test } from "node:test"

import type { Area } from "../../sim/map/index.ts"
import type { BuildingF, RoadF } from "../features.ts"
import { ringBox, segDist2 } from "../geometry.ts"
import { gridLattice } from "../terrain.ts"
import { buildWalls } from "../walls.ts"
import { inRings } from "../water-areas.ts"
import { segments } from "./wall-segments.ts"

/** No bridge, so no parapet and no wall under a deck. */
const NO_PARAPETS = { walls: [], levels: [] },
  NOTHING_UNDER = { walk: NO_PARAPETS, drive: NO_PARAPETS }

/** Points every metre or less along each of the walls' segments. */
const samples = (flat: ReadonlyArray<number>) =>
  segments(flat).flatMap(([ax, ay, bx, by]) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx! - ax!, by! - ay!)))
    return Array.from(
      { length: n + 1 },
      (_, k) => [ax! + ((bx! - ax!) * k) / n, ay! + ((by! - ay!) * k) / n] as const,
    )
  })

/** Distance from (x, y) to the nearest edge of an area's outer ring, m. */
const toOutline = (area: Area, x: number, y: number) => {
  const ring = area.rings[0]!
  let best = Infinity
  for (let k = 0, n = ring.length; k < n; k += 2)
    best = Math.min(
      best,
      segDist2(x, y, ring[k]!, ring[k + 1]!, ring[(k + 2) % n]!, ring[(k + 3) % n]!).d2,
    )
  return Math.sqrt(best)
}

/** The grid's cell, m, and how far simplifying moves a traced wall (walls.ts's SLACK), m. */
const CELL = 4,
  SLACK = 1.5
/** How deep the river polygon below is carved under the flat ground round it, m: a step needs about 8.4 m to read steeper than 35° over the slope's 12 m baseline. */
const CARVE = 10

// On the region's whole grid, flat at 0 m: a pond on it, and a river bend carved CARVE under it,
// node by node inside its outline, 3 km apart and far from the play area's outline.
const LAKE: Area = {
  kind: "lake",
  level: 0,
  rings: [[1000, -2000, 1060, -1990, 1080, -1940, 1040, -1900, 990, -1930]],
}
const RIVER: Area = {
  kind: "river",
  waters: [0],
  rings: [
    [
      2000, 1000, 2100, 1010, 2190, 1060, 2230, 1140, 2195, 1155, 2160, 1090, 2090, 1048, 1995,
      1040,
    ],
  ],
}
/** A river polygon whose river the map does not hold: still water at its level, its bed only shelving. */
const STILL: Area = { kind: "river", level: -CARVE, rings: [] }
const walled = () => {
  const g = gridLattice(),
    z = new Float64Array(g.cols * g.rows),
    [x0, y0, x1, y1] = ringBox(RIVER.rings[0]!)
  assert.equal(g.cell, CELL)
  for (let j = Math.floor((y0 - g.y0) / CELL); j <= Math.ceil((y1 - g.y0) / CELL); j++)
    for (let i = Math.floor((x0 - g.x0) / CELL); i <= Math.ceil((x1 - g.x0) / CELL); i++)
      if (inRings(RIVER.rings, g.x0 + i * CELL, g.y0 + j * CELL)) z[j * g.cols + i] = -CARVE
  return {
    /** With both areas. */
    both: buildWalls({ ...g, z }, [], [], [], [], [LAKE, RIVER], NO_PARAPETS, NOTHING_UNDER),
    /** The same ground with no river polygon over its carve. */
    lakeOnly: buildWalls({ ...g, z }, [], [], [], [], [LAKE], NO_PARAPETS, NOTHING_UNDER),
    /** The same polygon holding still water, its river not in the map: carved as a lake is. */
    still: buildWalls(
      { ...g, z },
      [],
      [],
      [],
      [],
      [LAKE, { ...STILL, rings: RIVER.rings }],
      NO_PARAPETS,
      NOTHING_UNDER,
    ),
  }
}
let built: ReturnType<typeof walled> | undefined
/** The walls of the pond and the river bend, built once (about a second). */
const pondAndBend = () => (built ??= walled())

test("buildWalls rings a lake with shore walls along its outline, and no walk or drive wall in it", () => {
  const { both } = pondAndBend()
  // What lies within 100 m of its outline: the whole lake, about 90 m across, and round it.
  const byLake = (flat: ReadonlyArray<number>) =>
    samples(flat).filter(([x, y]) => toOutline(LAKE, x, y) < 100)
  // Its shore: the walls traced round the cells whose centre it holds, simplified by SLACK.
  const near = CELL + SLACK
  const shore = byLake(both.shore)
  assert.ok(shore.length > 0, "the lake has a shore")
  for (const [x, y] of shore)
    assert.ok(toOutline(LAKE, x, y) <= near, `shore at (${x}, ${y}) strays from the outline`)
  const ring = LAKE.rings[0]!
  for (let k = 0, n = ring.length; k < n; k += 2)
    for (let t = 0; t < 1; t += 0.05) {
      const x = ring[k]! + (ring[(k + 2) % n]! - ring[k]!) * t,
        y = ring[k + 1]! + (ring[(k + 3) % n]! - ring[k + 1]!) * t
      assert.ok(
        shore.some(([sx, sy]) => Math.hypot(sx - x, sy - y) <= near),
        `no shore wall by the outline at (${x}, ${y})`,
      )
    }
  // No road crosses it: what keeps the traffic and the spawns off the water is the same ring.
  assert.deepEqual(byLake(both.driveShore), shore)
  // People swim and cars float into it: the water stops no one.
  assert.deepEqual(byLake(both.walk), [])
  assert.deepEqual(byLake(both.drive), [])
})

test("buildWalls keeps a river polygon's carved banks open: no walk or drive wall within 2 cells of its outline, where the same carve unmarked is walled", () => {
  const { both, lakeOnly } = pondAndBend()
  const nearBend = (flat: ReadonlyArray<number>) =>
    samples(flat).filter(([x, y]) => toOutline(RIVER, x, y) < 2 * CELL)
  assert.ok(nearBend(lakeOnly.walk).length > 0, "a 10 m step unmarked is too steep to walk")
  assert.ok(nearBend(lakeOnly.drive).length > 0, "and to drive")
  assert.deepEqual(nearBend(both.walk), [])
  assert.deepEqual(nearBend(both.drive), [])
  assert.ok(nearBend(both.shore).length > 0, "its outline is the water's edge")
})

// Regression: the exemption went by kind, so a river polygon holding still water, whose bed only
// shelves as a lake's does, lost the walls of the steep slopes round it.
test("buildWalls walls the steep banks round a river polygon whose river the map does not hold, as round a lake", () => {
  const { still, lakeOnly } = pondAndBend()
  const nearBend = (flat: ReadonlyArray<number>) =>
    samples(flat).filter(([x, y]) => toOutline(RIVER, x, y) < 2 * CELL)
  assert.deepEqual(nearBend(still.walk), nearBend(lakeOnly.walk))
  assert.deepEqual(nearBend(still.drive), nearBend(lakeOnly.drive))
})

// Regression: the parapets and the walls under the decks were spread into `push`, one argument per
// number, which overflows the call stack past about 120,000 of them (30,000 walls): a map with a few
// times today's bridges (Lunigiana's walk walls under its decks already hold 33,452 numbers).
test("buildWalls appends 50,000 parapets and as many walls under the decks, each with its level", () => {
  const g = gridLattice()
  const many = {
    walls: Array.from({ length: 200_000 }, (_, k) => k % 97),
    levels: Array.from({ length: 50_000 }, (_, k) => k % 89),
  }
  const walls = buildWalls(
    { ...g, z: new Float64Array(g.cols * g.rows) },
    [],
    [],
    [],
    [],
    [],
    many,
    { walk: many, drive: many },
  )
  assert.deepEqual(walls.walk.slice(-many.walls.length), many.walls)
  assert.deepEqual(walls.drive.slice(-many.walls.length), many.walls)
  assert.deepEqual(walls.levels.walk.slice(-many.levels.length), many.levels)
  assert.equal(walls.levels.drive.length * 4, walls.drive.length)
  assert.equal(walls.levels.drive.filter((l) => !Number.isNaN(l)).length, 2 * many.levels.length)
})

// Regressions, each a survey house by an OSM footway (w 1.5, corridor 0.75 m). Giucano's
// (1326730180) cuts four 0.2 m cells into the house, and the trace, simplified by 0.15 m, took the
// notch back: its wall stood 0.54 m from the footway's centreline. Fivizzano's (1065669242) passes
// 0.56 m from the house's corner, and no cell centre falls inside the corridor, so the house was
// not carved at all and its corner stayed inside the footway.
const FOOTWAYS = [
  {
    pts: [
      [-10483.21, -1974.99],
      [-10487.15, -1971.73],
      [-10490.15, -1976.35],
      [-10494.86, -1973.73],
    ],
    outer: [
      -10493, -1972.6, -10491.1, -1973.7, -10490.6, -1974.1, -10487.1, -1971, -10483.2, -1967.5,
      -10490.7, -1963.5,
    ],
  },
  {
    pts: [
      [1334.13, 6831.05],
      [1337.98, 6853.54],
    ],
    outer: [
      1336.7, 6837.1, 1338.7, 6835.9, 1339.5, 6835.4, 1341.3, 6833.9, 1341, 6834.8, 1339.7, 6838.2,
      1335.8, 6837.5,
    ],
  },
] as const

test("buildWalls keeps a house's walls out of the middle w/2 of a path that reaches into it", () => {
  const footways = FOOTWAYS.map(({ pts }, k): RoadF => ({
    id: k + 1,
    cls: "path",
    w: 1.5,
    surface: "unpaved",
    private: false,
    pts: pts.map(([x, y]) => ({ x, y })),
  }))
  const houses = FOOTWAYS.map(({ outer }, k): BuildingF => ({
    id: 100 + k,
    kind: "house",
    h: 10,
    style: "plaster",
    tint: 0,
    outer: [...outer],
  }))
  const g = gridLattice()
  const { walk, drive } = buildWalls(
    { ...g, z: new Float64Array(g.cols * g.rows) },
    footways,
    [],
    houses,
    [],
    [],
    NO_PARAPETS,
    NOTHING_UNDER,
  )
  FOOTWAYS.forEach(({ pts }, f) => {
    // The house's walls: nothing else stands within 30 m on the flat grid, far from the outline.
    const [cx, cy] = pts[1]
    const near = (flat: ReadonlyArray<number>) =>
      segments(flat).filter(([ax, ay]) => Math.hypot(ax! - cx, ay! - cy) < 30)
    assert.ok(near(walk).length > 0, `house ${f} is walled`)
    assert.deepEqual(near(drive), near(walk))
    for (const [ax, ay, bx, by] of near(walk)) {
      const n = Math.max(1, Math.ceil(Math.hypot(bx! - ax!, by! - ay!) / 0.05))
      for (let k = 0; k <= n; k++) {
        const x = ax! + ((bx! - ax!) * k) / n,
          y = ay! + ((by! - ay!) * k) / n
        const d = Math.min(
          ...pts.slice(1).map(([qx, qy], q) => segDist2(x, y, pts[q]![0], pts[q]![1], qx, qy).d2),
        )
        assert.ok(d >= 0.75 ** 2, `a wall at (${x.toFixed(2)}, ${y.toFixed(2)}) in footway ${f}`)
      }
    }
  })
})
