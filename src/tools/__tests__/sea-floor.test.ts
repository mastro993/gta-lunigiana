// The sea's floor (sea-floor.ts) on a synthetic shore: a straight coastline east along y = 0, the
// sea south of it, and a survey's isobaths along it.
import assert from "node:assert/strict"
import { test } from "node:test"

import { coastIndex } from "../coast.ts"
import { hash01, type P, segDist2 } from "../geometry.ts"
import { type Isobath, seaFloor } from "../sea-floor.ts"

/** The shore: a coastline east along y = 0, its land north of it (OSM's rule). */
const SHORE = coastIndex([
  {
    pts: [
      [-20000, 0],
      [20000, 0],
    ],
    closed: false,
  },
])
/** A survey's line at `depth` m along y = `y`, from x0 to x1. */
const line = (id: number, depth: number, y: number, x0 = -20000, x1 = 20000): Isobath => ({
  id,
  depth,
  pts: [
    [x0, y],
    [x1, y],
  ],
})
/** The survey: its 2 m line 81 m out and its 3 m line 113 m out, as off Marinella. */
const SURVEY = [line(1, 2, -81), line(2, 3, -113)]
const floor = seaFloor(SHORE, SURVEY)

/** `a` within 1e-9 of `b`. */
const close = (a: number, b: number, what: string) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a}, want ${b}`)

test("the floor is a line's depth on it, between two lines their depths weighed by distance, and past the last eases toward the one before", () => {
  close(floor(1234, -81), -2, "on the 2 m line")
  close(floor(1234, -113), -3, "on the 3 m line")
  // Halfway, the two lines 16 m off and the shore (the third) 97 m: each weighs 1/16 − 1/97.
  close(floor(1234, -97), -2.5, "halfway")
  // 8 m short of the 3 m line, the 2 m line 24 m off, the shore 105 m.
  close(
    floor(1234, -105),
    -(3 * (1 / 8 - 1 / 105) + 2 * (1 / 24 - 1 / 105)) / (1 / 8 + 1 / 24 - 2 / 105),
    "near the 3 m line",
  )
  // From the shore to the 3 m line it falls, but where the next line lies nearer than the shore
  // short of a line (56.5…81 m out): there the line past it, the second nearest, pulls the floor
  // 0.11 m under the line's depth, which it rises back to on it.
  let deepest = 0,
    rise = 0
  for (let y = -0.25; y >= -113; y -= 0.25) {
    const depth = -floor(1234, y)
    rise = Math.max(rise, deepest - depth)
    deepest = Math.max(deepest, depth)
  }
  assert.ok(rise > 0.1 && rise < 0.11, `a rise of ${rise} m`)
  // 100 m past the last line, the line before 132 m off and the shore 213 m: under the line
  // before, over the last.
  close(
    floor(1234, -213),
    -(3 * (1 / 100 - 1 / 213) + 2 * (1 / 132 - 1 / 213)) / (1 / 100 + 1 / 132 - 2 / 213),
    "past the last",
  )
})

test("by the shore the floor is the shoreface profile at its distance, where no line lies across: the beach's 8 % face to 0.6 m, Marinella's survey to 10 m, the EMODnet shelf on to 17 m", () => {
  const bare = seaFloor(SHORE, [])
  for (const [d, depth] of [
    [0, 0],
    [3, 0.24],
    [7.5, 0.6],
    [81, 2],
    [881, 9],
    [1212, 10],
    [2200, 13],
    [5000, 15],
    [7800, 17],
    [9000, 17],
  ] as const)
    close(bare(1234, -d), -depth, `${d} m out`)
})

test("past the survey the floor fades into the profile from 1 km off its nearest line to 1.5 km, with no step", () => {
  const bare = seaFloor(SHORE, [])
  close(floor(1234, -1613), bare(1234, -1613), "1.5 km past the 3 m line")
  close(floor(1234, -2500), bare(1234, -2500), "2.4 km past it")
  // Within 1 km of the 3 m line, the survey's alone: shallower than the profile there.
  assert.ok(floor(1234, -1063) > bare(1234, -1063) + 5, "950 m past it")
  // Between, a blend, and no step anywhere across.
  for (let y = -1063; y >= -1663; y -= 0.5) {
    const a = floor(1234, y),
      b = floor(1234, y - 0.5)
    assert.ok(Math.abs(a - b) < 0.02, `a step of ${a - b} m at y ${y}`)
  }
})

test("an islet's shore is the shore too: the floor rises to it out at sea", () => {
  const islet: ReadonlyArray<P> = [
    [0, -1000],
    [10, -1000],
    [10, -990],
    [0, -990],
    [0, -1000],
  ]
  const withIslet = seaFloor(
    coastIndex([
      {
        pts: [
          [-20000, 0],
          [20000, 0],
        ],
        closed: false,
      },
      { pts: islet, closed: true },
    ]),
    [...SURVEY, line(3, 9, -900)],
  )
  // 3 m off it: the islet's shore 3 m off (the profile's 0.24 m there), the 9 m line 103 m, the 3 m line 890 m.
  close(
    withIslet(5, -1003),
    -(0.24 * (1 / 3 - 1 / 890) + 9 * (1 / 103 - 1 / 890)) / (1 / 3 + 1 / 103 - 2 / 890),
    "3 m off the islet",
  )
  assert.ok(withIslet(5, -1003) > -1, "shallow by the islet")
})

test("a line under 50 m long counts for nothing: the survey's seams and edges stack them a depth a metre", () => {
  const stack = [10, 11, 12, 13].map((depth, k) => line(10 + k, depth, -150, 1220, 1260 - k))
  const withStack = seaFloor(SHORE, [...SURVEY, ...stack])
  for (const [x, y] of [
    [1234, -150],
    [1240, -140],
    [1300, -160],
  ] as const)
    assert.equal(withStack(x, y), floor(x, y), `(${x}, ${y})`)
  // 50 m and over, it does.
  assert.notEqual(
    seaFloor(SHORE, [...SURVEY, line(20, 10, -150, 1210, 1260)])(1234, -150),
    floor(1234, -150),
  )
})

test("a node's floor is the same bits whichever floor of the same inputs reads it, in whatever order: tiles meet", () => {
  // The nodes of two tiles' windows meeting at x = 2000 (a 4 m lattice), read by two floors, one
  // tile after the other and the other way round, and the survey's lines bent.
  const survey = [
    {
      id: 1,
      depth: 2,
      pts: [
        [-20000, -90],
        [1990, -110],
        [2050, -95],
        [20000, -100],
      ] as Array<P>,
    },
    {
      id: 2,
      depth: 5,
      pts: [
        [-20000, -300],
        [2010, -260],
        [20000, -320],
      ] as Array<P>,
    },
  ]
  const nodes = (x0: number) =>
    Array.from({ length: 51 * 200 }, (_, k): P => [x0 + 4 * (k % 51), -4 - 4 * Math.floor(k / 51)])
  const west = nodes(1800),
    east = nodes(2000)
  const one = seaFloor(SHORE, survey),
    two = seaFloor(SHORE, survey)
  const first = [...west, ...east].map(([x, y]) => one(x, y))
  const second = [...east, ...west].map(([x, y]) => two(x, y))
  const again = [...second.slice(east.length), ...second.slice(0, east.length)]
  first.forEach((z, k) => assert.ok(Object.is(z, again[k]), `node ${k}: ${z} and ${again[k]}`))
  // The seam's column, in both windows.
  for (let k = 0; k < west.length; k += 51)
    assert.ok(Object.is(one(...west[k + 50]!), two(...east[k]!)), `seam node ${k / 51}`)
})

test("the floor reads each depth's nearest isobath exactly: its cells' candidates against every segment measured", () => {
  // A wiggly shore along y = 0 and 40 wiggly lines of 1 to 16 m, 60 m to 2 km out, some short.
  const wiggle = (k: number, y: number, n: number, x0: number, x1: number): Array<P> =>
    Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y + 30 * hash01(k, i) - 15])
  const shoreline = wiggle(0, 0, 200, -3000, 3000)
  const survey: Array<Isobath> = Array.from({ length: 40 }, (_, k) => ({
    id: k,
    depth: 1 + (k % 16),
    pts: wiggle(k + 1, -60 - 50 * k, 20 + (k % 7) * 30, -2500 + 40 * k, 2500 - 90 * (k % 5)),
  }))
  const floor = seaFloor(coastIndex([{ pts: shoreline, closed: false }]), survey)
  // The rule, read from every segment: the shore at its profile, each depth's nearest within 1.5 km.
  const segmentsOf = (pts: ReadonlyArray<P>) => pts.slice(1).map((b, i) => [pts[i]!, b] as const)
  const near = (x: number, y: number, pts: ReadonlyArray<P>) =>
    Math.sqrt(
      Math.min(...segmentsOf(pts).map(([a, b]) => segDist2(x, y, a[0], a[1], b[0], b[1]).d2)),
    )
  // The profile at d m from the shore: the floor with no survey d m off a straight one.
  const profile = (d: number) => -seaFloor(SHORE, [])(0, -d)
  const length = (pts: ReadonlyArray<P>) =>
    segmentsOf(pts).reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0)
  for (let k = 0; k < 400; k++) {
    const x = -2800 + 5600 * hash01(k, 100),
      y = -2200 * hash01(k, 101) - 1
    const dc = near(x, y, shoreline)
    const byDepth = new Map<number, number>()
    for (const l of survey)
      if (length(l.pts) >= 50)
        byDepth.set(l.depth, Math.min(byDepth.get(l.depth) ?? Infinity, near(x, y, l.pts)))
    const shoreAt: readonly [number, number] = [dc, profile(Math.min(dc, 7800))]
    const contours = [
      shoreAt,
      ...[...byDepth].map(([depth, d]): readonly [number, number] => [d, depth]),
    ]
      .filter(([d]) => d < 1500)
      .sort((a, b) => a[0] - b[0])
    const iso = Math.min(...byDepth.values())
    const [d1, v1] = contours[0] ?? [1500, 0],
      [d2, v2] = contours[1] ?? [1500, 0],
      [d3] = contours[2] ?? [1500]
    const w1 = 1 / d1 - 1 / d3,
      w2 = d2 < d3 ? 1 / d2 - 1 / d3 : 0
    const read = (w1 * v1 + w2 * v2) / (w1 + w2)
    const trust = Math.min(1, Math.max(0, (1500 - iso) / 500))
    const want =
      d1 >= 1500
        ? profile(Math.min(dc, 7800))
        : trust * read + (1 - trust) * profile(Math.min(dc, 7800))
    assert.ok(Math.abs(floor(x, y) + want) < 1e-9, `(${x}, ${y}): ${-floor(x, y)}, want ${want}`)
  }
})
