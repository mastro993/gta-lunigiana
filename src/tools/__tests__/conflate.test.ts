import assert from "node:assert/strict"
import { test } from "node:test"

import { conflateRail, type Layout } from "../conflate.ts"
import type { CtrRail, CtrTrack } from "../ctr-rail.ts"
import type { RailF, RoadF, WaterF } from "../features.ts"
import type { P, V } from "../geometry.ts"

const NONE: Layout = { drop: new Set(), reserved: new Set(), swap: new Map() }
const track = (src: string, ...pts: ReadonlyArray<P>): CtrTrack => ({ src: [src], pts })
const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })
const road = (id: number, ...pts: ReadonlyArray<V>): RoadF => ({
  id,
  cls: "residential",
  w: 5,
  surface: "asphalt",
  private: false,
  pts,
})
const ctr = (tracks: ReadonlyArray<CtrTrack>): CtrRail => ({
  tracks,
  bridges: [],
  tunnels: [],
  platforms: [],
  crossings: [],
})

// The CTR's line at y 0, unmapped for 100 m around a tunnel (x 200–300); a loop north of it that
// leaves and rejoins the line, and a siding to the south with both ends free.
const TRACKS = [
  track("23D01 VLI#0.0", [-100, 0], [0, 0], [100, 0], [200, 0]),
  track("23D01 VLI#1.0", [300, 0], [400, 0], [500, 0], [700, 0]),
  track("23D01 VLI#2.0", [420, 0.2], [440, 2], [460, 4], [560, 4], [580, 2], [600, 0.2]),
  track("23D01 VLI#3.0", [450, -5], [650, -5]),
]
// OSM draws the line 1.5 m north, its tunnel bowing 3.5 m off.
const RAIL: ReadonlyArray<RailF> = [
  { id: 1, pts: [v(-100, 1.5, "a"), v(50, 1.5, "b"), v(150, 1.5, "c"), v(210, 1.5, "p")] },
  { id: 2, tunnel: true, pts: [v(210, 1.5, "p"), v(250, 3.5), v(290, 1.5, "q")] },
  { id: 3, pts: [v(290, 1.5, "q"), v(400, 1, "d"), v(500, 1, "lc"), v(700, 1)] },
]
const ROADS = [
  road(10, v(500, -20, "r0"), v(500, 1, "lc"), v(500, 20, "r1")), // a level crossing on the line
  road(11, v(620, -30, "s0"), v(620, -6, "s1"), v(621, -2, "s2")), // crosses the siding 1 m from its own vertex s1
  road(12, v(520, -30, "t0"), v(520, -8, "t1"), v(540, -8, "t2")), // a road ending short of the siding
  // Crosses the siding 4.2 m from its vertex u2: too far to move it there, so a new vertex is shared.
  road(13, v(470, -30, "u0"), v(470, -12, "u1"), v(480, -2, "u2"), v(485, -1.5, "u3")),
]
const STREAM: WaterF = {
  id: 20,
  kind: "stream",
  w: 2,
  bed: 3,
  depth: 1,
  pts: [v(100, -30, "w0"), v(100, 30, "w1")],
}

test("conflateRail puts OSM's line on the CTR, its crossing nodes on the road where the CTR crosses it, and adds the CTR-only tracks", () => {
  const c = conflateRail(RAIL, ROADS, [STREAM], ctr(TRACKS), NONE)
  // Way 3 is cut at the loop's two switches: tracks meet only at piece ends.
  assert.deepEqual(
    c.rail.map((r) => r.id),
    [1, 2, 3, 3, 3],
  )
  const [west, tunnel] = c.rail
  const way3 = c.rail.filter((r) => r.id === 3)
  for (let k = 1; k < way3.length; k++) assert.deepEqual(way3[k]!.pts[0], way3[k - 1]!.pts.at(-1))
  const east = { id: 3, pts: way3.flatMap((r, k) => (k === 0 ? r.pts : r.pts.slice(1))) }
  // On the CTR where it maps the line (x ≤ 200, ≥ 300), within 0.1 m of it between; the ids survive.
  const onCtr = (p: V) => Math.abs(p.y) < (p.x <= 200 || p.x >= 300 ? 1e-9 : 0.1)
  for (const r of [west!, east]) assert.ok(r.pts.every(onCtr), `rail ${r.id} on the CTR`)
  assert.deepEqual(
    west!.pts.filter((p) => p.id !== undefined).map((p) => [p.id, Math.round(p.x)]),
    [
      ["a", -100],
      ["b", 50],
      ["culvert:water20:0", 100],
      ["c", 150],
      ["p", 210],
    ],
  )
  assert.deepEqual(west!.pts.at(-1), tunnel!.pts[0])
  assert.deepEqual(tunnel!.pts.at(-1), east.pts[0])
  // The tunnel runs between the CTR's ends, headed on along them: no 3.5 m bow left.
  assert.ok(
    tunnel!.pts.every((p) => Math.abs(p.y) < 0.5),
    "the tunnel straightened onto the CTR's line",
  )
  // The level crossing slid 1 m along its road to the CTR track; the road took the same position.
  const lc = east.pts.find((p) => p.id === "lc")!
  assert.deepEqual([lc.x, lc.y], [500, 0])
  assert.deepEqual(
    c.roads[0]!.pts.find((p) => p.id === "lc"),
    { x: 500, y: 0, id: "lc" },
  )
  assert.equal(c.report.crossings[0]!.shift, 1)
  // The stream crossing at grade shares a culvert vertex with the rail.
  assert.ok(c.water[0]!.pts.some((p) => p.id === "culvert:water20:0" && p.x === 100 && p.y === 0))
  assert.ok(c.report.residual[2] < 1e-9)
  // The loop's ends are switch vertices of the line; the siding's are free.
  const [loop, siding] = c.extra
  assert.equal(loop!.id, -190020)
  assert.equal(siding!.id, -190030)
  for (const end of [loop!.pts[0]!, loop!.pts.at(-1)!])
    assert.ok(
      east.pts.some((p) => p.id === end.id && p.x === end.x && p.y === end.y),
      `switch ${end.id} on the line`,
    )
  assert.deepEqual(loop!.pts[0], { x: 420, y: 0, id: "ctr:23D01 VLI#2.0:0" })
  for (const end of [siding!.pts[0]!, siding!.pts.at(-1)!]) assert.equal(end.id, undefined)
  // Road 11 crosses the siding 1.2 m from its vertex s1, which moves there; road 13 gets a new shared vertex; road 12 is not crossed.
  const s1 = c.roads[1]!.pts[1]!
  assert.equal(s1.id, "s1")
  assert.ok(Math.abs(s1.y + 5) < 1e-9 && siding!.pts.some((p) => p.id === "s1" && p.x === s1.x))
  const shared = c.roads[3]!.pts.find((p) => p.id?.startsWith("ctr:") === true)!
  assert.ok(Math.abs(shared.y + 5) < 1e-9 && siding!.pts.some((p) => p.id === shared.id))
  assert.equal(c.roads[2]!.pts.length, 3)
  assert.deepEqual(c.moves.get("lc"), { x: 500, y: 0, id: "lc" })
})

test("conflateRail throws when a crossing node would slide past half of its road segment", () => {
  // The CTR crosses the road 1 m from the node, on a segment 1.5 m long.
  const short = road(10, v(500, 10, "r0"), v(500, 1, "lc"), v(500, -0.5, "r1"), v(500, -20, "r2"))
  assert.throws(
    () => conflateRail(RAIL, [short], [], ctr(TRACKS.slice(0, 2)), NONE),
    /level crossing lc: shifts 1\.00 m along road 10, half its segment is 0\.75 m/,
  )
})

test("conflateRail re-homes OSM's ids by the layout: dropped ways, reserved CTR tracks, swapped nodes", () => {
  // As at Gragnola: OSM's line crosses over to where the CTR has the loop (its node "lc" there), and
  // OSM's loop way 9 lies on the CTR's line (its node "lc2"). Way 9 is dropped, the CTR loop may not
  // take the line, and the two nodes swap tracks.
  const rail: ReadonlyArray<RailF> = [
    RAIL[0]!,
    RAIL[1]!,
    {
      id: 3,
      pts: [
        v(290, 1.5, "q"),
        v(400, 1, "d"),
        v(460, 3.5),
        v(500, 3.5, "lc"),
        v(540, 3.5),
        v(700, 1),
      ],
    },
    { id: 9, pts: [v(420, 0.5, "x"), v(500, 0.5, "lc2"), v(600, 0.5, "y")] },
  ]
  const roads = [
    road(10, v(500, -20, "r0"), v(500, 0.5, "lc2"), v(500, 3.5, "lc"), v(500, 20, "r1")),
  ]
  const layout: Layout = {
    drop: new Set([9]),
    reserved: new Set(["23D01 VLI#2.0"]),
    swap: new Map([["lc", "lc2"]]),
  }
  const c = conflateRail(rail, roads, [], ctr(TRACKS.slice(0, 3)), layout)
  assert.deepEqual(
    c.rail.map((r) => r.id),
    [1, 2, 3, 3, 3],
  )
  assert.ok(
    c.rail.slice(2).every((r) => r.pts.every((p) => Math.abs(p.y) < (p.x >= 300 ? 1e-9 : 0.1))),
    "the line stays on the CTR's through track",
  )
  assert.ok(c.extra[0]!.pts.some((p) => p.id === "lc" && p.x === 500 && Math.abs(p.y - 4) < 1e-9))
  assert.deepEqual(
    c.roads[0]!.pts.map((p) => [p.id, Math.round(p.y * 1e6) / 1e6]),
    [
      ["r0", -20],
      ["lc2", 0],
      ["lc", 4],
      ["r1", 20],
    ],
  )
})

// Regression: every unmatched run was smoothed, so with no CTR at all a 20°
// kink in 1 km of open track came back 6 m off OSM, its node with it.
test("conflateRail keeps OSM's line where no CTR track maps it", () => {
  const a = (20 * Math.PI) / 180
  const open: RailF = {
    id: 1,
    pts: [
      v(-1000, 0, "a"),
      v(0, 0, "b"),
      v(500, 0, "c"),
      v(500 + 500 * Math.cos(a), 500 * Math.sin(a), "d"),
    ],
  }
  const c = conflateRail([open], [], [], ctr([]), NONE)
  assert.deepEqual(c.rail[0]!.pts, open.pts)
})

// Regression: nothing checked the crossing nodes against the
// CTR's level-crossing polygons (AGE 0122).
test("conflateRail throws when a level crossing misses the CTR's crossing polygon there", () => {
  const box = (src: string, x0: number, x1: number, y0: number, y1: number) => ({
    src,
    rings: [[x0, y0, x1, y0, x1, y1, x0, y1]],
  })
  const run =
    (...crossings: ReadonlyArray<ReturnType<typeof box>>) =>
    () =>
      conflateRail(RAIL, [ROADS[0]!], [], { ...ctr(TRACKS), crossings }, NONE)
  // Road 10 crosses the siding at (500, −5), the line at (500, 0) and the loop at (500, 4).
  assert.doesNotThrow(run(box("A", 496, 504, -6, 6)))
  assert.throws(run(box("B", 503, 507, -6, 6)), /CTR level crossing B holds no level-crossing node/)
  assert.throws(
    run(box("C", 496, 504, -2, 2)),
    /level crossing ctr:23D01 VLI#3\.0:x0 lies 3\.00 m outside CTR C/,
  )
})
