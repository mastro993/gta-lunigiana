import assert from "node:assert/strict"
import { test } from "node:test"

import type { Area } from "../../sim/map/index.ts"
import { ringBox, segDist2 } from "../geometry.ts"
import { gridLattice } from "../terrain.ts"
import { buildWalls } from "../walls.ts"
import { inRings } from "../water-areas.ts"
import { segments } from "./wall-segments.ts"

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
    both: buildWalls({ ...g, z }, [], [], [], [], [LAKE, RIVER]),
    /** The same ground with no river polygon over its carve. */
    lakeOnly: buildWalls({ ...g, z }, [], [], [], [], [LAKE]),
    /** The same polygon holding still water, its river not in the map: carved as a lake is. */
    still: buildWalls({ ...g, z }, [], [], [], [], [LAKE, { ...STILL, rings: RIVER.rings }]),
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
