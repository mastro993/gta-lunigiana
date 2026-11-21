import assert from "node:assert/strict"
import { test } from "node:test"

import { conflateRail, type Layout } from "../conflate.ts"
import type { CtrRail, CtrTrack } from "../ctr-rail.ts"
import type { RailF, RoadF, WaterF } from "../features.ts"
import type { P, V } from "../geometry.ts"
import { surveyId } from "../survey-ids.ts"

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

/** The tightest bend along a line, m: 20 m over the heading's turn across 20 m of it, sampled each metre. */
const tightest = (line: ReadonlyArray<V>) => {
  const heads: Array<number> = []
  for (let k = 1; k < line.length; k++) {
    const [p, q] = [line[k - 1]!, line[k]!]
    const len = Math.hypot(q.x - p.x, q.y - p.y)
    for (let j = 0; j < Math.round(len); j++) heads.push(Math.atan2(q.y - p.y, q.x - p.x))
  }
  let least = Infinity
  for (let k = 0; k + 20 < heads.length; k++) {
    const turn = heads[k + 20]! - heads[k]!
    least = Math.min(least, 20 / Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))))
  }
  return least
}

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
  from: 0,
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
  // Numbered by sheet 23D01's section, record and part (`surveyId`, as the CTR's buildings).
  assert.equal(loop!.id, surveyId("ctr2019", 601, 190020))
  assert.equal(siding!.id, surveyId("ctr2019", 601, 190030))
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

test("conflateRail moves a road that ends on the line with it, onto the CTR's track", () => {
  // As driveway 1455968336 at Santo Stefano di Magra: it ends on OSM's line, which the CTR puts 1 m
  // south, short of the road's last segment, so the road's end comes onto the line where it is nearest.
  const ends = road(10, v(500, 20, "r0"), v(500, 1, "lc"))
  const c = conflateRail(RAIL, [ends], [], ctr(TRACKS.slice(0, 2)), NONE)
  assert.deepEqual(c.roads[0]!.pts.at(-1), { x: 500, y: 0, id: "lc" })
  assert.ok(c.rail.some((r) => r.pts.some((p) => p.id === "lc" && p.x === 500 && p.y === 0)))
  assert.equal(c.report.crossings[0]!.shift, 1)
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

// Regression: every unmatched run was smoothed, so with no CTR at all a 20° kink in 1 km of open track came back 6 m off OSM,
// its node with it. The kink itself turned the track at a point: no curve through the far vertices rounds it within 1.5 m (the
// Pontremolese's tunnels north of Aulla turn 9° between straights of 143–257 m, a bend of 127.6 m over 20 m chords), so the
// track takes an arc inside it, the corner's node 1.5 m in, onto it.
test("conflateRail keeps OSM's line where no CTR track maps it, but for an arc inside a corner between long straights", () => {
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
  const pts = conflateRail([open], [], [], ctr([]), NONE).rail[0]!.pts
  assert.deepEqual(
    pts.filter((p) => p.id !== undefined && p.id !== "c"),
    open.pts.filter((p) => p.id !== "c"),
    "the straights' own vertices where they were",
  )
  const c = pts.find((p) => p.id === "c")!
  assert.ok(
    Math.hypot(c.x - 500, c.y) <= 1.5 + 1e-9,
    `the corner ${Math.hypot(c.x - 500, c.y)} m in`,
  )
  assert.ok(tightest(pts) > 90, `a bend of ${tightest(pts).toFixed(1)} m over 20 m`)
})

// Regression: Aulla's tunnel 140772193, which no survey maps, kept OSM's 11.4° corner between 41 and 52 m segments, a bend of
// 100.9 m over 20 m chords, where an ATR 220's cars no longer met at their joints.
test("conflateRail rounds a corner of OSM's line no survey guides along a curve through its vertices, which stay", () => {
  const a = (11.4 * Math.PI) / 180
  const open: RailF = {
    id: 1,
    pts: [v(-41, 0, "a"), v(0, 0, "k"), v(52 * Math.cos(a), 52 * Math.sin(a), "b")],
  }
  const [rounded] = conflateRail([open], [], [], ctr([]), NONE).rail
  const pts = rounded!.pts
  assert.deepEqual(
    pts.filter((p) => p.id !== undefined),
    open.pts,
    "OSM's vertices, ids and all, where they were",
  )
  assert.ok(pts.length >= 8, `${pts.length} points`)
  // No corner: the line turns 3° at most at any of its points (OSM's 11.4° at one), and bows no more than 1.5 m off OSM's segments.
  for (let k = 1; k + 1 < pts.length; k++) {
    const [p, q, r] = [pts[k - 1]!, pts[k]!, pts[k + 1]!]
    const turn = Math.atan2(r.y - q.y, r.x - q.x) - Math.atan2(q.y - p.y, q.x - p.x)
    assert.ok(
      Math.abs(turn) < (3 * Math.PI) / 180,
      `${((turn * 180) / Math.PI).toFixed(1)}° at ${k}`,
    )
    const along = q.x <= 0 ? Math.abs(q.y) : Math.abs(q.y * Math.cos(a) - q.x * Math.sin(a))
    assert.ok(along <= 1.5, `${along.toFixed(2)} m off OSM's line`)
  }
})

// Regression: north of Aulla the Pontremolese's 4.3 m bridge 842172344 runs on from OSM's 11.4° corner at its first node, in
// line with the 176 m segment after it; the curve, held through its far node on that straight, turned in those 4.3 m, a bend of
// 107.4 m over 20 m chords, where an ATR 220's cars no longer met at their joints. OSM's nodes there, from the corner.
test("conflateRail rounds a corner past a short piece beside it: the piece's far node slides onto the curve, which bends no tighter than 200 m", () => {
  const ways: ReadonlyArray<RailF> = [
    { id: 1, pts: [v(27.8, 117.4, "q"), v(18.7, 59.1, "p"), v(0, 0, "a")] },
    { id: 2, bridge: true, pts: [v(0, 0, "a"), v(-2.1, -3.8, "b")] },
    { id: 3, pts: [v(-2.1, -3.8, "b"), v(-85.5, -154.4, "n"), v(-110.4, -204.7, "m")] },
  ]
  const c = conflateRail(ways, [], [], ctr([]), NONE)
  const line = [1, 2, 3].flatMap((id, k) =>
    c.rail.find((r) => r.id === id)!.pts.slice(k === 0 ? 0 : 1),
  )
  // Each node within OSM's accuracy of where OSM has it: the bridge's far one slides, the corners take arcs inside them.
  for (const p of ways.flatMap((w) => w.pts)) {
    const at = line.find((q) => q.id === p.id)!
    assert.ok(Math.hypot(at.x - p.x, at.y - p.y) <= 1.5 + 1e-9, `${p.id} by where OSM has it`)
  }
  assert.ok(tightest(line) >= 200, `a bend of ${tightest(line).toFixed(1)} m over 20 m`)
})

// Regression: no 2019 sheet maps Aulla Lunigiana's track 5, which matched the CTR's yard track 419182734 beside it (OSM's own
// 0.3 m off it) for 58 m, up to 5.9 m away, and the whole track moved 5.9 m east, 8 m off its island platform.
test("conflateRail matches a CTR track only to the OSM track nearest it: a track the CTR leaves out beside one it maps keeps OSM's line", () => {
  // OSM's two tracks 4 m apart; the CTR maps only the south one, 0.3 m off OSM's.
  const south: RailF = { id: 1, pts: [v(0, 0, "a"), v(200, 0, "b")] },
    north: RailF = { id: 2, pts: [v(0, 4, "c"), v(100, 4), v(200, 4, "d")] }
  const c = conflateRail(
    [south, north],
    [],
    [],
    ctr([track("23D01 VLI#0.0", [-10, 0.3], [210, 0.3])]),
    NONE,
  )
  assert.ok(
    c.rail[0]!.pts.every((p) => Math.abs(p.y - 0.3) < 1e-9),
    "the south track on the CTR",
  )
  assert.deepEqual(c.rail[1]!.pts, north.pts, "the north one where OSM draws it")
})

// Regression: a test region without Gragnola (issue #7) threw reading the missing node's id.
test("conflateRail passes over a swapped node the play area leaves out", () => {
  const away: Layout = { ...NONE, swap: new Map([["gone", "lc"]]) }
  assert.deepEqual(
    conflateRail(RAIL, ROADS, [STREAM], ctr(TRACKS), away).rail,
    conflateRail(RAIL, ROADS, [STREAM], ctr(TRACKS), NONE).rail,
  )
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

// Regression: Pieve San Lorenzo's yard siding 621942965 leaves the loop at a switch the loop's way
// placed on the loop's CTR track; the CTR draws the siding from 0.9 m beside it, and the siding's
// first sample, matched there, hung a 0.9 m stub past the switch.
test("conflateRail starts a way that leaves another at a switch at the switch, where the CTR draws it from beside the track", () => {
  const tracks = [
    track("23D01 VLI#0.0", [0, 0], [600, 0]),
    track("23D01 VLI#1.0", [300, -0.9], [340, -4.9], [500, -12.9]),
  ]
  const rail: ReadonlyArray<RailF> = [
    { id: 1, pts: [v(0, 0.3, "a"), v(300, 0.3, "sw"), v(600, 0.3, "b")] },
    { id: 2, pts: [v(300, 0.3, "sw"), v(340, -4.6), v(500, -12.6, "e")] },
  ]
  const c = conflateRail(rail, [], [], ctr(tracks), NONE)
  const siding = c.rail.find((r) => r.id === 2)!
  assert.deepEqual(siding.pts[0], { x: 300, y: 0, id: "sw" })
  assert.ok(
    c.rail.filter((r) => r.id === 1).some((r) => r.pts.some((p) => p.id === "sw" && p.y === 0)),
    "the switch on the line",
  )
})

// Regression: the CTR's 70 m stub 23D01 VLI#0.0 at Rometta, which OSM maps as an abandoned railway
// (way 1252090894), was drawn as a siding 6.5 m from the SS63's level crossing: its box's stop line
// stood 2 m from the stub's end, and the crossing's barrier and lights 0.8–1.1 m from its track.
test("conflateRail leaves out a CTR-only track lying along a railway OSM maps with its rails gone, and only that", () => {
  // The siding at y −5 (x 450–650) with an abandoned way 0.5 m off it over 90% of its length; the loop
  // with one along a fifth of it.
  const gone = [
    [v(470, -5.5), v(660, -5.5)],
    [v(460, 4.5), v(500, 4.5)],
  ]
  const c = conflateRail(RAIL, [], [], ctr(TRACKS), NONE, gone)
  assert.deepEqual(c.report.gone, ["23D01 VLI#3.0"])
  assert.deepEqual(
    c.report.extras.map((e) => e.src),
    ["23D01 VLI#2.0"],
  )
})
