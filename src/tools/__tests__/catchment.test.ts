import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"

import { catchments } from "../catchment.ts"
import type { Grid, Profile } from "../terrain.ts"

/** A 4 m grid over 400 × 160 m falling 2 % to the east, and a polyline sampled every 2 m on its surface less 0.5 m. */
const cols = 101,
  rows = 41
const grid: Grid = {
  cell: 4,
  cols,
  rows,
  x0: 0,
  y0: 0,
  ax: 0,
  ay: 0,
  z: Float64Array.from({ length: cols * rows }, (_, n) => 100 - 0.02 * 4 * (n % cols)),
}
/** A polyline sampled every 2 m, its surface `surface` there (the plane above less 0.5 m when not given). */
const profile = (
  pts: ReadonlyArray<readonly [number, number]>,
  surface: (x: number, y: number) => number = (x) => 99.5 - 0.02 * x,
): Profile => {
  const x: Array<number> = [],
    y: Array<number> = [],
    s: Array<number> = [],
    vertexSample: Array<number> = []
  let along = 0
  pts.forEach(([ax, ay], i) => {
    vertexSample.push(x.length)
    const [bx, by] = pts[i + 1] ?? [ax, ay],
      l = Math.hypot(bx - ax, by - ay),
      n = i + 1 < pts.length ? Math.max(1, Math.ceil(l / 2)) : 1
    for (let k = 0; k < n; k++) {
      x.push(ax + ((bx - ax) * k) / n)
      y.push(ay + ((by - ay) * k) / n)
      s.push(along + (l * k) / n)
    }
    along += l
  })
  return { x, y, s, z: Float64Array.from(x, (xi, k) => surface(xi, y[k]!)), vertexSample }
}

// Regression: each arm of a braid carried the whole river's area from the fork, so the rejoin added them up, doubling it.
test("catchments: a river's arms share its area at a fork and add up to it again where they rejoin", () => {
  const wp = [
    profile([
      [8, 80],
      [120, 80],
    ]),
    profile([
      [120, 80],
      [160, 120],
      [200, 80],
    ]),
    profile([
      [120, 80],
      [160, 40],
      [200, 80],
    ]),
    profile([
      [200, 80],
      [392, 80],
    ]),
  ]
  const ids = [
    ["source", "fork"],
    ["fork", "north", "rejoin"],
    ["fork", "south", "rejoin"],
    ["rejoin", "mouth"],
  ]
  const [above, north, south, below] = catchments(grid, wp, ids)
  const into = above!.at(-1)!,
    out = below![0]!
  assert.ok(into > 0, "the river above drains its hillside")
  assert.ok(Math.abs(north![0]! + south![0]! - into) < 1e-9, "the arms share what comes down")
  // Below the rejoin: what came down to the fork once, and what each arm gathered on its way.
  const gathered = north!.at(-1)! - north![0]! + (south!.at(-1)! - south![0]!)
  assert.ok(
    Math.abs(out - (into + gathered)) < 1e-9,
    `${out} km² below the rejoin against ${into} + ${gathered}`,
  )
})

test("catchments fills and routes a grid of flats and pits to the same heights and areas as before", () => {
  // Heights on a few whole metres, so most neighbours tie, and two streams across them.
  const cols = 61,
    rows = 47
  const g: Grid = {
    cell: 4,
    cols,
    rows,
    x0: 0,
    y0: 0,
    ax: 0,
    ay: 0,
    z: Float64Array.from({ length: cols * rows }, (_, n) => ((n * 7919) % 13) % 4),
  }
  const wp = [
    profile([
      [10, 30],
      [120, 90],
      [236, 100],
    ]),
    profile([
      [40, 170],
      [120, 90],
    ]),
  ]
  const areas = catchments(g, wp, [
    ["a", "b", "c"],
    ["d", "b"],
  ])
  const digest = createHash("sha256")
  digest.update(new Uint8Array(g.z.buffer))
  for (const a of areas) digest.update(new Uint8Array(a.buffer))
  assert.equal(digest.digest("hex").slice(0, 16), "1f425d940e4a6bd8")
})

test("catchments: an unlisted tile's nodes are outlets, as the box's edge is: they are never read, ground beside them drains out and they bring no area", () => {
  // A 4 m grid over 320 × 240 m rising 2 % east and 3 % north, its north-east corner (x 204…320,
  // y 144…240) unlisted, as an L's notch is, and a stream across the plane 44 m south of it that
  // the corner drains into (D8 runs south-west).
  const cols = 81,
    rows = 61
  const plane = (x: number, y: number) => 100 + 0.02 * x + 0.03 * y
  const inNotch = (n: number) => n % cols >= 51 && Math.floor(n / cols) >= 36
  const listed = Uint8Array.from({ length: cols * rows }, (_, n) => (inNotch(n) ? 0 : 1))
  const run = (notch: number | undefined, mask?: Uint8Array) => {
    const g: Grid = {
      cell: 4,
      cols,
      rows,
      x0: 0,
      y0: 0,
      ax: 0,
      ay: 0,
      z: Float64Array.from({ length: cols * rows }, (_, n) =>
        notch !== undefined && inNotch(n) ? notch : plane(4 * (n % cols), 4 * Math.floor(n / cols)),
      ),
    }
    const wp = [
      profile(
        [
          [312, 100],
          [8, 100],
        ],
        (x, y) => plane(x, y) - 0.5,
      ),
    ]
    const [area] = catchments(g, wp, [["source", "mouth"]], mask)
    return { area: area!, z: g.z.filter((_, n) => listed[n] === 1) }
  }
  const masked = run(undefined, listed)
  // Peaks in the notch change nothing: its ground is never read.
  assert.deepEqual(run(1e4, listed), masked)
  // Its nodes are outlets below every node of ground, the listed nodes beside them an edge: the same
  // fill and areas as a pit there that the box's edge drains.
  assert.deepEqual(run(-1e6), masked)
  // Read whole, the corner's ground drains into the stream.
  const whole = run(undefined)
  assert.ok(
    masked.area.at(-1)! < whole.area.at(-1)! - 0.01,
    `${masked.area.at(-1)} km² at the mouth against ${whole.area.at(-1)} with the notch's ground`,
  )
})
