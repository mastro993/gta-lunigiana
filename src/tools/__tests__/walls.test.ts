import assert from "node:assert/strict"
import { test } from "node:test"

import type { BuildingF, RoadF } from "../features.ts"
import { segDist2 } from "../geometry.ts"
import { clipBuildings } from "../house-walls.ts"
import { outlineOf } from "../play-area.ts"
import { pushOutline } from "../wall-pieces.ts"
import { barrierWalls, boresOf, openBarriers } from "../walls.ts"
import { segments } from "./wall-segments.ts"

// walls.long-test.ts builds the walls round a staged lake and river polygon (about a second).
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

test("a guard rail stays whole along its road, inside its w/2, and opens where a drivable road's middle 1.2 m reaches it", () => {
  const road = (
    cls: RoadF["cls"],
    w: number,
    pts: ReadonlyArray<readonly [number, number]>,
  ): RoadF => ({
    id: 1,
    cls,
    w,
    surface: "asphalt",
    private: false,
    pts: pts.map(([x, y]) => ({ x, y })),
  })
  // A rail 4 m off a 9 m road's centreline, inside its w/2, running on to 0.7 m short of the
  // centreline of a track that leaves the road there (OSM's by Tendola stops so); a wall drawn the
  // same goes, as it stands in the road.
  const roads = [
    road("primary", 9, [
      [0, 0],
      [100, 0],
    ]),
    road("track", 3, [
      [50, 0],
      [50, -30],
    ]),
  ]
  const out = openBarriers(
    [
      { kind: "guard_rail", pts: [0, -4, 49.3, -4] },
      { kind: "wall", pts: [0, -4, 49.3, -4] },
    ],
    roads,
  )
  assert.equal(out.length, 1)
  const [rail] = out
  assert.equal(rail!.kind, "guard_rail")
  assert.deepEqual(rail!.pts.slice(0, -2), [0, -4])
  assert.equal(rail!.pts.at(-1), -4)
  // It ends at the last free 0.25 m sample: 1.2 m from the track's centreline, or a sample more.
  const gap = 50 - rail!.pts.at(-2)!
  assert.ok(gap >= 1.2 && gap < 1.2 + 0.25, `the rail ends ${gap} m from the track`)
})

// Regression (#20): the jersey barrier 887066016 runs between the underpasses of Via Alcide De
// Gasperi and the container terminal's service road at (−17097, −1238), on the ground 5.3 m over the
// bore of the unclassified road 1352409570 (layer −2), and stood at every level across it: traffic
// edge 205834 in the bore ran into it; levelled along its whole 16 m piece, it took the railway
// embankment's level 10.6 m off the bore, over the underpass roads beside it. And the concrete wall
// 887046364, drawn from 2.4 m inside that bore's north mouth on its floor, stood 0.95 m off its
// centreline, and 1.37 m once the bore's middle 1.2 m alone opened it, in the northbound lane.
test("a barrier over a road tunnel's bore deep under it takes the ground's level over its carriageway and a kerb alone; on the bore's level the bore opens it as a road at grade does; off the bore it stands at every level", () => {
  const bore = (cls: RoadF["cls"], w: number): RoadF => ({
    id: 1,
    cls,
    w,
    surface: "asphalt",
    private: false,
    tunnel: true,
    pts: [
      { x: 0, y: -40 },
      { x: 0, y: 40 },
    ],
  })
  // The bore's floor at 10.7 m, the ground over it 16 m to the north (5.3 m over: deep) and 12 m to
  // the south (1.3 m, under the bore's 4 m clear height: at its level).
  const level = () => 10.7,
    terrain = (_: number, y: number) => (y > 0 ? 16 : 12)
  const wallsOf = (kind: string, y: number, road = bore("unclassified", 5)) => {
    const { walls, levels } = barrierWalls(
      { kind, pts: [-30, y, 30, y] },
      boresOf([road]),
      level,
      terrain,
    )
    return segments(walls).map(([ax, , bx], w) => ({
      x0: Math.min(ax!, bx!),
      x1: Math.max(ax!, bx!),
      level: levels[w]!,
    }))
  }
  // Deep under it: the wall over the 5 m carriageway and a 1 m kerb either side (3.5 m, to the next
  // 0.25 m sample) takes the ground's level; the rest stands at every level, round the whole line.
  const deep = wallsOf("wall", 20)
  for (const { x0, x1, level } of deep)
    if (Math.abs(x0 + x1) / 2 < 3.5) {
      assert.equal(level, 16, `the piece at x ${x0}…${x1} over the bore: the ground's level`)
      assert.ok(x0 >= -3.75 && x1 <= 3.75, `the piece at x ${x0}…${x1} reaches past the kerb`)
    } else assert.ok(Number.isNaN(level), `the piece at x ${x0}…${x1}, off the bore: every level`)
  assert.ok(
    deep.some(({ level }) => level === 16),
    "levelled over the bore",
  )
  assert.deepEqual(
    [deep[0]!.x0, deep.at(-1)!.x1, deep.reduce((s, { x0, x1 }) => s + x1 - x0, 0)],
    [-30, 30, 60],
    "whole",
  )
  // On its level, a wall opens over the bore's w/2, as at grade: to the last free sample past 2.5 m.
  const gap = (pieces: ReturnType<typeof wallsOf>) => {
    for (const { level } of pieces) assert.ok(Number.isNaN(level), "at every level")
    const west = pieces.filter(({ x1 }) => x1 <= 0),
      east = pieces.filter(({ x0 }) => x0 >= 0)
    assert.equal(west.length + east.length, pieces.length, "no piece across the bore")
    return [
      west.length === 0 ? Number.NaN : -Math.max(...west.map(({ x1 }) => x1)),
      east.length === 0 ? Number.NaN : Math.min(...east.map(({ x0 }) => x0)),
    ]
  }
  for (const side of gap(wallsOf("wall", -20)))
    assert.ok(side >= 2.5 && side < 2.75, `a wall opens ${side} m off the bore's centreline`)
  // A guard rail opens over a drivable bore's middle 1.2 m only, and on a path's bore not at all.
  for (const side of gap(wallsOf("guard_rail", -20)))
    assert.ok(side >= 1.2 && side < 1.45, `a guard rail opens ${side} m off the bore's centreline`)
  const rail = wallsOf("guard_rail", -20, bore("path", 2))
  assert.deepEqual(
    rail.map(({ x0, x1 }) => [x0, x1]),
    [
      [-30, -15],
      [-15, 0],
      [0, 15],
      [15, 30],
    ],
    "a guard rail stands whole over a path's bore",
  )
})

// Regression: a substation the CTR maps under the SR445's bridge west of Gragnola (552592647, at
// (−3256, 4472)) reached 1.1 m from the deck's centreline: the 1.2 m corridor left its walls, which
// stand at every level, on the deck, too narrow for a truck, and that cut the truck's network in two
// there; once Aulla's part made the north piece the larger, Monzone had no truck.
test("a deck's carriageway clips a footprint under it or beside it its whole w/2 out; a road at grade only its middle 1.2 m", () => {
  const road = (bridge: boolean): RoadF => ({
    id: 1,
    cls: "primary",
    w: 11.6,
    surface: "asphalt",
    private: false,
    ...(bridge ? { bridge: true as const } : {}),
    pts: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
    ],
  })
  // 10 × 6 m, from 1.1 to 7.1 m right of the centreline.
  const cabin: BuildingF = {
    id: -1,
    kind: "substation",
    h: 2.9,
    style: "industrial",
    tint: 1,
    outer: [15, -1.1, 25, -1.1, 25, -7.1, 15, -7.1],
  }
  const nearest = (bs: ReadonlyArray<BuildingF>) =>
    Math.min(
      ...bs.flatMap((b) =>
        Array.from({ length: b.outer.length / 2 }, (_, k) =>
          Math.sqrt(segDist2(b.outer[2 * k]!, b.outer[2 * k + 1]!, 0, 0, 40, 0).d2),
        ),
      ),
    )
  const deck = clipBuildings([cabin], [road(true)]),
    grade = clipBuildings([cabin], [road(false)])
  assert.equal(deck.length, 1)
  assert.ok(Math.abs(nearest(deck) - 5.8) < 0.2, `under the deck: ${nearest(deck)} m`)
  assert.ok(Math.abs(nearest(grade) - 1.2) < 0.2, `at grade: ${nearest(grade)} m`)
})

test("a breakwater's outline opens only where a drivable road's middle crosses it, as a guard rail does: a path onto it leaves it whole", () => {
  const road = (cls: RoadF["cls"], w: number, x: number): RoadF => ({
    id: 1,
    cls,
    w,
    surface: "asphalt",
    private: false,
    pts: [
      { x, y: -20 },
      { x, y: 20 },
    ],
  })
  // Its south edge, from x 0 to 40 along y = 0, crossed by a footpath at x 10 and a service road
  // at x 30.
  const [south, ...rest] = openBarriers(
    [{ kind: "breakwater", pts: [0, 0, 40, 0] }],
    [road("path", 1.5, 10), road("service", 4, 30)],
  )
  assert.equal(rest.length, 1)
  assert.deepEqual([south!.pts[0], south!.pts.at(-2)! < 30 - 1.2], [0, true])
  assert.deepEqual([rest[0]!.pts[0]! > 30 + 1.2 - 0.25, rest[0]!.pts.at(-2)], [true, 40])
})
