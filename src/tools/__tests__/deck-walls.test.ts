import assert from "node:assert/strict"
import { test } from "node:test"

import { segmentDistance } from "../../sim/collide.ts"
import { footReach, ON_DECK, ONE_LEVEL, ROAD_LIFT } from "../../sim/map/kinds.ts"
import { deckWalls } from "../deck-walls.ts"
import type { RoadF } from "../features.ts"
import { traceContours } from "../loops.ts"
import type { Grid } from "../terrain.ts"

/** A 4 m grid of 51 × 21 nodes from (−100, −40), its node at (x, y) at `z(x, y)`. */
const grid = (z: (x: number, y: number) => number): Grid => {
  const cols = 51,
    rows = 21
  return {
    cell: 4,
    cols,
    rows,
    x0: -100,
    y0: -40,
    ax: -100,
    ay: -40,
    z: Float64Array.from({ length: cols * rows }, (_, n) =>
      z(-100 + (n % cols) * 4, -40 + Math.floor(n / cols) * 4),
    ),
  }
}

/** A road of `cls` along the flat line `pts` at its profile `z`, and its line. */
const road = (
  id: number,
  cls: RoadF["cls"],
  w: number,
  pts: ReadonlyArray<number>,
  z: ReadonlyArray<number>,
  bridge = false,
): readonly [RoadF, { readonly pts: ReadonlyArray<number>; readonly z: ReadonlyArray<number> }] => [
  {
    id,
    cls,
    w,
    surface: "asphalt",
    private: false,
    ...(bridge ? { bridge: true as const } : {}),
    pts: Array.from({ length: pts.length / 2 }, (_, k) => ({ x: pts[2 * k]!, y: pts[2 * k + 1]! })),
  },
  { pts, z },
]

/** The valley under the deck: the ground at 10 m beyond |x| 25, falling evenly to 2 m at x 0. */
const VALLEY = (x: number) => 10 - 8 * Math.max(0, 1 - Math.abs(x) / 25)
/** The deck's top, m. */
const TOP = 10 + ROAD_LIFT.tertiary
/**
 * A tertiary road's deck 6.5 m wide along y 0 from x −30 to x 30, its top at TOP, over the VALLEY,
 * its road carrying on at grade both ways; with `paths`, a footpath across under it at x 17.5,
 * 2.5 m under its top, and another at x 21.5, 1.2 m under it.
 */
const scene = (paths = false) => {
  const g = grid((x) => VALLEY(x))
  const ways = [
    road(1, "tertiary", 6.5, [-30, 0, 0, 0, 30, 0], [10, 10, 10], true),
    road(2, "tertiary", 6.5, [-60, 0, -30, 0], [10, 10]),
    road(3, "tertiary", 6.5, [30, 0, 60, 0], [10, 10]),
    ...(paths
      ? [
          road(4, "path", 1.5, [17.5, -20, 17.5, 20], [VALLEY(17.5), VALLEY(17.5)]),
          road(5, "path", 1.5, [21.5, -20, 21.5, 20], [VALLEY(21.5), VALLEY(21.5)]),
        ]
      : []),
  ]
  return {
    ways,
    walls: deckWalls(
      g,
      ways.map(([r]) => r),
      ways.map(([, l]) => l),
    ),
  }
}

/** Each of the flat (ax, ay, bx, by) `walls` with its level. */
const each = (w: {
  readonly walls: ReadonlyArray<number>
  readonly levels: ReadonlyArray<number>
}) =>
  w.levels.map((level, k) => ({
    ax: w.walls[4 * k]!,
    ay: w.walls[4 * k + 1]!,
    bx: w.walls[4 * k + 2]!,
    by: w.walls[4 * k + 3]!,
    level,
  }))

/** Where the walls cross the line y = `y` between x `x0` and `x1`, ascending. */
const across = (
  walls: ReturnType<typeof each>,
  y: number,
  x0 = -Infinity,
  x1 = Infinity,
): Array<number> =>
  walls
    .flatMap(({ ax, ay, bx, by }) => {
      if ((ay - y) * (by - y) > 0 || ay === by) return []
      const x = ax + ((bx - ax) * (y - ay)) / (by - ay)
      return x >= x0 && x <= x1 ? [x] : []
    })
    .sort((a, b) => a - b)

test("traceContours rings the region under 0 anticlockwise, its points where the field crosses 0", () => {
  // A disc 2 m round the origin, on a 0.25 m lattice.
  const f = (i: number, j: number) => Math.hypot(i * 0.25, j * 0.25) - 2
  const under: Array<readonly [number, number]> = []
  for (let j = -12; j <= 12; j++)
    for (let i = -12; i <= 12; i++) if (f(i, j) < 0) under.push([i, j])
  const loops = [...traceContours(f, under, 0.25)]
  assert.equal(loops.length, 1)
  const loop = loops[0]!
  assert.deepEqual(loop[0], loop.at(-1), "closed")
  let area = 0
  for (let k = 0; k + 1 < loop.length; k++)
    area += loop[k]![0] * loop[k + 1]![1] - loop[k + 1]![0] * loop[k]![1]
  assert.ok(area > 0, "the disc on the left")
  assert.ok(
    loop.every(([x, y]) => Math.abs(Math.hypot(x, y) - 2) < 0.02),
    "on the circle, between the lattice's nodes",
  )
})

test("deckWalls: the walk walls cross a deck's line where the ground stands PERSON_HEIGHT under its underside and ON_DECK under its top, and run along it past its walkers' reach", () => {
  const walk = each(scene().walls.walk)
  // Under the deck: 2.7 m of room at |x| 17.06, the deck's level at |x| 23.94 (the valley's slope).
  const lines = across(walk, 0, -30, 30)
  assert.equal(lines.length, 4, `the walls cross the deck's line at ${lines.join(", ")}`)
  for (const [x, want] of lines.map((x, k) => [x, [-23.94, -17.06, 17.06, 23.94][k]!] as const))
    assert.ok(Math.abs(x - want) < 0.15, `a wall across the deck at x ${x}, not ${want}`)
  // Beside it, where the ground stands within 2.7 m of its top: at its walkers' reach.
  const reach = footReach("tertiary", 6.5)
  for (const x of [-20, 20]) {
    const sides = walk
      .filter(({ ax, bx }) => Math.min(ax, bx) <= x && Math.max(ax, bx) >= x)
      .map(({ ay, by }) => (ay + by) / 2)
    assert.ok(
      sides.some((y) => Math.abs(y - reach) < 0.15) &&
        sides.some((y) => Math.abs(y + reach) < 0.15),
      `walls beside the deck at x ${x}: ${sides.join(", ")}`,
    )
  }
})

test("deckWalls: no wall stops anyone on the deck or on its road at grade, and every one stops the ground under the deck by it", () => {
  const { walls, ways } = scene(true)
  for (const [kind, list] of [
    ["walk", each(walls.walk)],
    ["drive", each(walls.drive)],
  ] as const) {
    assert.ok(list.length > 0, `${kind} walls`)
    for (const wall of list) {
      // At least ONE_LEVEL + ON_DECK under the deck's top: its road comes onto it at its level.
      assert.ok(
        wall.level <= TOP - ONE_LEVEL - ON_DECK + 1e-9,
        `a ${kind} wall at ${wall.level} m, the top at ${TOP} m`,
      )
      // The ground just outside it, under the deck's level, within ONE_LEVEL of its level.
      const mx = (wall.ax + wall.bx) / 2,
        my = (wall.ay + wall.by) / 2
      const ground = VALLEY(mx)
      if (Math.abs(mx) < 30 && ground < TOP - ON_DECK && Math.abs(my) < 3)
        assert.ok(
          Math.abs(ground - wall.level) < ONE_LEVEL + 0.25,
          `a ${kind} wall at ${wall.level} m over ground at ${ground.toFixed(2)} m, at (${mx}, ${my})`,
        )
    }
  }
  // The approaches at grade: no wall within their carriageway that a body on them meets.
  for (const [r, line] of ways.slice(1, 3))
    for (let x = line.pts[0]!; x <= line.pts[2]!; x += 0.5)
      for (const wall of [...each(walls.walk), ...each(walls.drive)])
        assert.ok(
          segmentDistance(wall, x, 0) >= r.w / 2 || Math.abs(wall.level - TOP) >= ONE_LEVEL,
          `a wall at ${wall.level} m on road ${r.id} at x ${x}`,
        )
})

test("deckWalls: a footpath passing a level under a deck keeps a corridor through the low space, walled; one nearer its top opens the walls across it", () => {
  const { walls, ways } = scene(true)
  const walk = each(walls.walk)
  for (const [r, line] of ways.slice(3)) {
    const x = line.pts[0]!,
      surface = line.z[0]! + ROAD_LIFT.path
    for (let y = -20; y <= 20; y += 0.25)
      for (const wall of walk)
        assert.ok(
          segmentDistance(wall, x, y) >= r.w / 2 || Math.abs(wall.level - surface) >= ONE_LEVEL,
          `a wall at ${wall.level} m on path ${r.id} at (${x}, ${y}), its surface ${surface.toFixed(2)} m`,
        )
  }
  // The corridor's wall on the low space's side, past its walkers' reach and the corridor's 0.25 m.
  const edge = 17.5 + footReach("path", 1.5) + 0.25
  assert.ok(
    walk.some(
      ({ ax, ay, bx, by }) =>
        Math.abs(ax - edge) < 0.2 && Math.abs(bx - edge) < 0.2 && Math.abs(ay - by) > 1,
    ),
    `no wall along the path's corridor at x ${edge}`,
  )
})
