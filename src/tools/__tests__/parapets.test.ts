import assert from "node:assert/strict"
import { test } from "node:test"

import type { RoadClass } from "../../sim/map/kinds.ts"
import { gridGround, levelOn } from "../build-ground.ts"
import type { RoadF } from "../features.ts"
import { segDist2 } from "../geometry.ts"
import { parapets } from "../parapets.ts"
import type { Grid } from "../terrain.ts"
import { parapetFaults, type ShippedRoad } from "./parapets.ts"

/** A road as the build carries it (`f`) and as the map ships it, its profile `z` per vertex. */
const road = (
  id: number,
  cls: RoadClass,
  w: number,
  pts: ReadonlyArray<readonly [number, number]>,
  z: ReadonlyArray<number>,
  bridge?: true,
) => {
  const f: RoadF = {
    id,
    cls,
    w,
    surface: "asphalt",
    private: false,
    ...(bridge ? { bridge } : {}),
    pts: pts.map(([x, y]) => ({ x, y })),
  }
  const shipped: ShippedRoad = { ...f, pts: pts.flat(), z }
  return { f, shipped }
}

// A primary road's 7 m deck along y 0, its top 150.16 m (its profile 150 m, ROAD_LIFT 0.16 m), over
// a residential road 7 m under it at x 30, which a residential road on its level joins at x 45.
const DECK = road(
  1,
  "primary",
  7,
  [
    [0, 0],
    [20, 0],
    [45, 0],
    [60, 0],
  ],
  [150, 150, 150, 150],
  true,
)
const UNDER = road(
  2,
  "residential",
  4.5,
  [
    [30, -20],
    [30, 20],
  ],
  [143, 143],
)
const JOIN = road(
  3,
  "residential",
  4.5,
  [
    [45, 0],
    [45, 20],
  ],
  [150, 151],
)
const ROADS = [DECK, UNDER, JOIN]
/** A 4 m grid of 31 × 21 nodes from (−30, −40), its node at (x, y) at `z(x, y)`, to the decimetre. */
const grid = (z: (x: number, y: number) => number): Grid => {
  const cols = 31,
    rows = 21
  return {
    cell: 4,
    cols,
    rows,
    x0: -30,
    y0: -40,
    ax: -30,
    ay: -40,
    z: Float64Array.from(
      { length: cols * rows },
      (_, n) => Math.round(z(-30 + (n % cols) * 4, -40 + Math.floor(n / cols) * 4) * 10) / 10,
    ),
  }
}
/** The valley under the deck: the terrain 130 m a.s.l., under every road. */
const VALLEY = grid(() => 130)
/** Each of `roads`' surface by its index, over the terrain of `g` (`roadLevel`). */
const levelOf = (roads: ReadonlyArray<ReturnType<typeof road>>, g = VALLEY) =>
  levelOn(
    gridGround(
      g,
      roads.map((r) => r.f),
      roads.map((r) => r.shipped),
    ),
  )
/** The parapets of `roads` over the terrain of `g`. */
const build = (roads: ReadonlyArray<ReturnType<typeof road>>, g = VALLEY) =>
  parapets(
    roads.map((r) => r.f),
    levelOf(roads, g),
  )
const built = build(ROADS)

/** The parapet walls within 0.1 m of (x, y), each as its level. */
const levelsAt = (
  walls: ReadonlyArray<number>,
  levels: ReadonlyArray<number>,
  x: number,
  y: number,
) =>
  levels.filter(
    (_, w) =>
      segDist2(x, y, walls[4 * w]!, walls[4 * w + 1]!, walls[4 * w + 2]!, walls[4 * w + 3]!).d2 <
      0.01,
  )

test("parapets close a deck's sides over a road passing under it, at the deck's top, and open them where a road on its level joins it", () => {
  // The parapets stand 3.75 m off the centreline: over the road under it on both sides, closed.
  for (const y of [3.75, -3.75])
    assert.deepEqual(
      levelsAt(built.walls, built.levels, 30, y),
      [150.2],
      `over the road under it at y ${y}`,
    )
  // Where the road on its level joins it from the north, open on that side alone.
  assert.deepEqual(levelsAt(built.walls, built.levels, 45, 3.75), [])
  assert.deepEqual(levelsAt(built.walls, built.levels, 46, -3.75), [150.2])
  assert.ok(
    built.walls.every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-9),
    "on 0.1 m",
  )
  assert.ok(
    built.walls.every(
      (_, k) =>
        k % 4 !== 0 ||
        Math.hypot(
          built.walls[k + 2]! - built.walls[k]!,
          built.walls[k + 3]! - built.walls[k + 1]!,
        ) <= 16,
    ),
    "16 m at most",
  )
})

test("parapets stay closed by a road at grade whose surface the terrain lifts off the deck's level, as the game stands a car on it", () => {
  // The joining road's profile is on the deck's level, but it runs at grade over a bank 156 m high
  // north-east of the deck: its surface floats over the terrain there (`roadZ`), past ONE_LEVEL over
  // the deck's top where it meets the parapet.
  const bank = build(
    ROADS,
    grid((x, y) => (x >= 42 && y >= 4 ? 156 : 130)),
  )
  assert.deepEqual(levelsAt(bank.walls, bank.levels, 46, 3.75), [150.2])
})

test("parapetFaults: none where the parapets hold; an opening over the road under the deck, a parapet across a road on its level, a wall with no level over the road under it, each one", () => {
  const shipped = ROADS.map((r) => r.shipped),
    level = levelOf(ROADS)
  const walls = (drive: ReadonlyArray<number>, levels: ReadonlyArray<number>) => ({
    drive,
    levels: { drive: levels },
  })
  assert.deepEqual(parapetFaults(shipped, walls(built.walls, built.levels), level), [])
  // The parapets as they were, open over every road's carriageway: as if the road under the deck ran on its level.
  const before = build([
    DECK,
    road(
      2,
      "residential",
      4.5,
      [
        [30, -20],
        [30, 20],
      ],
      [150, 150],
    ),
    JOIN,
  ])
  const faults = parapetFaults(shipped, walls(before.walls, before.levels), level)
  assert.equal(faults.length, 1)
  assert.match(
    faults[0]!,
    /^primary bridge 1: open where no road on its level reaches it, at \(2\d\.\d, -3\.8\), its deck's top 150\.16 m$/,
  )
  // A parapet closed across the road joining the deck.
  assert.match(
    parapetFaults(
      shipped,
      walls([...built.walls, 43, 3.8, 47, 3.8], [...built.levels, 150.2]),
      level,
    )[0]!,
    /^primary bridge 1: its parapet at 150\.2 m stops a car on road 3 at 150\.\d+ m/,
  )
  // The parapets with no level stop the road under the deck.
  assert.match(
    parapetFaults(
      shipped,
      walls(
        built.walls,
        built.levels.map(() => NaN),
      ),
      level,
    )[0]!,
    /^primary bridge 1: a wall with no level stops a car on road 2 at 143\.12 m/,
  )
})

test("parapetFaults reads a road at grade where the parapet stands: one ending where a road climbing with the terrain leaves the deck's level holds, one closed along all of it fails", () => {
  // A primary road at grade beside the deck, its carriageway reaching 2.5 m past the parapet, its
  // profile 140 m, over terrain climbing 1.5 m a metre east of x 10 to 158 m: its surface crosses
  // the deck's level, 150.16 m, along the parapet.
  const SIDE = road(
    4,
    "primary",
    7,
    [
      [0, 6],
      [60, 6],
    ],
    [140, 140],
  )
  const roads = [DECK, SIDE],
    climb = grid((x) => Math.min(158, Math.max(140, 140 + 1.5 * (x - 10)))),
    level = levelOf(roads, climb)
  const walls = (p: ReturnType<typeof build>) => ({ drive: p.walls, levels: { drive: p.levels } })
  assert.deepEqual(
    parapetFaults(
      roads.map((r) => r.shipped),
      walls(build(roads, climb)),
      level,
    ),
    [],
  )
  // The parapets built as if the road kept to its profile: closed along it, where it is on the deck's level.
  assert.match(
    parapetFaults(
      roads.map((r) => r.shipped),
      walls(build(roads)),
      level,
    )[0]!,
    /^primary bridge 1: its parapet at 150\.2 m stops a car on road 4 at 1(4[89]|5[01])\.\d+ m/,
  )
})
