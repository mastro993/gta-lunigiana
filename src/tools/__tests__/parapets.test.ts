import assert from "node:assert/strict"
import { test } from "node:test"

import type { RoadClass } from "../../sim/map/kinds.ts"
import type { RoadF } from "../features.ts"
import { segDist2 } from "../geometry.ts"
import { parapets } from "../parapets.ts"
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
/** The parapets of `roads`. */
const build = (roads: ReadonlyArray<ReturnType<typeof road>>) =>
  parapets(
    roads.map((r) => r.f),
    roads.map((r) => r.shipped),
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

test("parapetFaults: none where the parapets hold; an opening over the road under the deck, a parapet across a road on its level, a wall with no level over the road under it, each one", () => {
  const shipped = ROADS.map((r) => r.shipped)
  const walls = (drive: ReadonlyArray<number>, levels: ReadonlyArray<number>) => ({
    drive,
    levels: { drive: levels },
  })
  assert.deepEqual(parapetFaults(shipped, walls(built.walls, built.levels)), [])
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
  const faults = parapetFaults(shipped, walls(before.walls, before.levels))
  assert.equal(faults.length, 1)
  assert.match(
    faults[0]!,
    /^primary bridge 1: open where no road on its level reaches it, at \(2\d\.\d, -3\.8\), its deck's top 150\.16 m$/,
  )
  // A parapet closed across the road joining the deck.
  assert.match(
    parapetFaults(shipped, walls([...built.walls, 43, 3.8, 47, 3.8], [...built.levels, 150.2]))[0]!,
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
    )[0]!,
    /^primary bridge 1: a wall with no level stops a car on road 2 at 143\.12 m/,
  )
})
