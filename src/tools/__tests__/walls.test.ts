import assert from "node:assert/strict"
import { test } from "node:test"

import type { Area } from "../../sim/map/index.ts"
import { ringBox, segDist2 } from "../geometry.ts"
import { outlineOf } from "../play-area.ts"
import { gridLattice } from "../terrain.ts"
import { buildWalls, pushOutline } from "../walls.ts"
import { inRings } from "../water-areas.ts"

/** The walls' segments as [ax, ay, bx, by] tuples. */
const segments = (flat: ReadonlyArray<number>) =>
  Array.from({ length: flat.length / 4 }, (_, k) => flat.slice(4 * k, 4 * k + 4))

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
  rings: [
    [
      2000, 1000, 2100, 1010, 2190, 1060, 2230, 1140, 2195, 1155, 2160, 1090, 2090, 1048, 1995,
      1040,
    ],
  ],
}
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
  }
}
let built: ReturnType<typeof walled> | undefined
/** The walls of the pond and the river bend, built once (about a second). */
const pondAndBend = () => (built ??= walled())

test("the outline walls of an L close it: every piece ends where the next starts, 64 m at most", () => {
  const rings = outlineOf([
    { key: "foot", title: "Foot", rects: [[0, 0, 200, 100]] },
    { key: "leg", title: "Leg", rects: [[0, 100, 100, 300]] },
  ])
  const walk: Array<number> = [],
    drive: Array<number> = []
  pushOutline([walk, drive], rings)
  assert.deepEqual(walk, drive)
  const segs = segments(walk)
  segs.forEach(([ax, ay, bx, by], k) => {
    assert.ok(Math.hypot(bx! - ax!, by! - ay!) <= 64, `piece ${k}`)
    const [nx, ny] = segs[(k + 1) % segs.length]!
    assert.deepEqual([bx, by], [nx, ny], `piece ${k} runs on into piece ${k + 1}`)
  })
  assert.deepEqual(segs[0]!.slice(0, 2), [0, 0])
  // round the L's 1000 m outline, with no wall across its seam (y 100, x 0..100)
  assert.equal(
    segs.reduce((s, [ax, ay, bx, by]) => s + Math.hypot(bx! - ax!, by! - ay!), 0),
    1000,
  )
  assert.ok(
    segs.every(([ax, ay, bx, by]) => !(ay === 100 && by === 100 && Math.max(ax!, bx!) <= 100)),
  )
})

test("one rectangle's outline walls are the bounds walls: S, E, N, W in 64 m pieces", () => {
  const out: Array<number> = []
  pushOutline([out], outlineOf([{ key: "box", title: "Box", rects: [[-100, -50, 100, 50]] }]))
  const sides = segments(out).map(([ax, ay, bx, by]) =>
    ay === -50 && by === -50
      ? "S"
      : ax === 100 && bx === 100
        ? "E"
        : ay === 50 && by === 50
          ? "N"
          : "W",
  )
  // 200 m sides in 4 pieces of 50 m, 100 m sides in 2
  assert.equal(sides.join(""), "SSSSEENNNNWW")
  assert.deepEqual(segments(out)[0], [-100, -50, -50, -50])
})

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
