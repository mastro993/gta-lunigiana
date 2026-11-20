import assert from "node:assert/strict"
import { test } from "node:test"

import type { V } from "../geometry.ts"
import {
  clearOfTrack,
  cutAtBridges,
  keepSpans,
  onBridge,
  spanned,
  underpasses,
  type Crossed,
  type Span,
  type SpanReport,
} from "../rail-spans.ts"

const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })
/** A chain at height y: at grade to x 100, a bridge from 100 to 115, at grade on to 200. */
const chain = (y: number) => [v(0, y), v(100, y, "b0"), v(115, y, "b1"), v(200, y)]
const SPANS: ReadonlyArray<Span> = [
  { id: 1, bridge: false, tunnel: false, to: "b0" },
  { id: 2, bridge: true, tunnel: false, from: "b0", to: "b1" },
  { id: 3, bridge: false, tunnel: false, from: "b1" },
]
// A river 4 m wide crossing at 45°: on OSM's line (y 1) at x 111, its far edge 1.2 m before the bridge's end.
const river = (margin = 0): Crossed => {
  const pts = [v(90, -20), v(130, 20)]
  return { what: "water 7", w: 4, margin, osm: pts, pts: [...pts], water: true }
}
const empty = (): SpanReport => ({ slid: [], culverts: [], cut: [], ends: [] })
const none = () => false

test("keepSpans slides a bridge end out until the river it spans is under it again", () => {
  // Moved 3 m north, the line meets the river at x 114: its edge would stand 1.8 m past the deck.
  const line = chain(4),
    report = empty()
  keepSpans(chain(1), line, SPANS, [river()], none, none, none, report)
  const end = line.find((p) => p.id === "b1")!
  assert.ok(
    Math.abs(end.x - (114 + 2 * Math.SQRT2)) < 1e-6 && end.y === 4,
    `bridge end at ${end.x}`,
  )
  assert.equal(report.slid.length, 1)
  assert.ok(Math.abs(report.slid[0]!.by - (2 * Math.SQRT2 - 1)) < 1e-6)
  // A river sloping the other way slips off the bridge's start when the line moves 7 m north.
  const back: Crossed = { ...river(), osm: [v(130, -20), v(90, 20)], pts: [v(130, -20), v(90, 20)] }
  const north = chain(8)
  keepSpans(chain(1), north, SPANS, [back], none, none, none, report)
  const start = north.find((p) => p.id === "b0")!
  assert.ok(Math.abs(start.x - (102 - 2 * Math.SQRT2)) < 1e-6, `bridge start at ${start.x}`)
  // Moved south instead, the river stays well inside: nothing slides.
  const south = chain(-2)
  keepSpans(chain(1), south, SPANS, [river()], none, none, none, report)
  assert.deepEqual(south, chain(-2))
  // Regression: a bridge reaches `margin` past what it spans (a river's protected
  // bed, a tertiary road's core), so no at-grade track beyond it hangs over the carved cells.
  const wide = chain(1)
  keepSpans(chain(1), wide, SPANS, [river(5)], none, none, none, report)
  const far = wide.find((p) => p.id === "b1")!
  assert.ok(Math.abs(far.x - (111 + 7 * Math.SQRT2)) < 1e-6, `bridge end at ${far.x}`)
  // A bridge end another line shares (a road's node) cannot slide.
  assert.throws(
    () => keepSpans(chain(1), chain(4), SPANS, [river()], (id) => id === "b1", none, none, report),
    /bridge 2: its to end must slide but is b1/,
  )
})

// Regression: the Pontremolese's crossover north of Aulla is a bridge of its own between two
// switches on the main tracks' decks, and a road passes under its first metres: the chain's end
// cannot slide, and need not, as the main track's deck spans the road past it.
test("keepSpans leaves a bridge's end on another track's deck, and refuses one in the open", () => {
  const crossover = [v(100, 0, "s0"), v(160, 20, "s1")]
  const spans: ReadonlyArray<Span> = [{ id: 9, bridge: true, tunnel: false }]
  const road: Crossed = {
    what: "road 5",
    w: 5,
    margin: 0,
    osm: [v(102, -10), v(102, 10)],
    pts: [v(102, -10), v(102, 10)],
    water: false,
  }
  const line = [...crossover],
    report = empty()
  keepSpans(crossover, line, spans, [road], none, (id) => id === "s0", none, report)
  assert.deepEqual(line, crossover)
  assert.deepEqual(report.slid, [])
  assert.throws(
    () => keepSpans(crossover, [...crossover], spans, [road], none, none, none, report),
    /bridge 9: its from end must slide but is a chain end/,
  )
})

test("keepSpans gives a stream at grade a culvert vertex both lines share, and refuses new crossings", () => {
  const stream: Crossed = {
    what: "water 8",
    w: 2,
    margin: 0,
    osm: [v(50, -10), v(50, 10)],
    pts: [v(50, -10), v(50, 10)],
    water: true,
  }
  const line = chain(0),
    report = empty()
  keepSpans(chain(1), line, SPANS, [stream], none, none, none, report)
  assert.deepEqual(report.culverts, ["culvert:water8:0"])
  assert.deepEqual(line[1], { x: 50, y: 0, id: "culvert:water8:0" })
  assert.deepEqual(stream.pts[1], { x: 50, y: 0, id: "culvert:water8:0" })
  // A stream that OSM's track ran past, but the moved track now crosses.
  const short: Crossed = {
    what: "water 9",
    w: 2,
    margin: 0,
    osm: [v(60, 2), v(60, 10)],
    pts: [v(60, 2), v(60, 10)],
    water: true,
  }
  assert.throws(
    () => keepSpans(chain(1), chain(4), SPANS, [short], none, none, none, report),
    /rail 1 now crosses water 9 at grade/,
  )
  // Under a CTR bridge the stream gets no culvert: cutAtBridges makes the track a bridge there.
  const under = chain(0),
    bridged = empty()
  keepSpans(
    chain(1),
    under,
    SPANS,
    [{ ...stream, pts: [v(50, -10), v(50, 10)] }],
    none,
    none,
    (x) => x > 45 && x < 55,
    bridged,
  )
  assert.deepEqual(bridged.culverts, [])
})

// Regression: OSM ends the Canale Manarola 4.5 m either side of the Pontremolese at (−14178, 11509), where its culvert under
// the line (dropped, features.ts) begins, and its protected bed held the ground 4.54 m under the line; the Canale del
// Piccardo, ended 0.45 m off the line at (−13423, 9190), stood 0.22 m deep on the rail bed in the 30 years' highest flood.
test("clearOfTrack cuts a stream's dead end back off at-grade track: a wide one's bed and a cell's diagonal, a narrow one's water off the bed", () => {
  // A wide stream's margin is its protected bed's 1 m and a 4 m cell's diagonal (conflate.ts).
  const corner = 4 * Math.SQRT2,
    track = [[v(0, 0), v(200, 0)]]
  const stream = (id: number, w: number, ...pts: Array<V>): Crossed => ({
    what: `water ${id}`,
    w,
    margin: w >= 4 ? 1 + corner : 0,
    osm: pts,
    pts: [...pts],
    water: true,
  })
  const wide = stream(1, 4, v(50, -30, "a"), v(50, -10), v(50, -0.45, "c")),
    narrow = stream(2, 2, v(60, 20), v(60, 1, "n"))
  // A stream joined to another at its end, and one ending clear of the track, keep their ends.
  const joined = stream(3, 4, v(100, -20), v(100, -1, "j")),
    into = stream(4, 2, v(100, -1, "j"), v(120, -20)),
    clear = stream(5, 4, v(150, -30), v(150, -9))
  // A stub within reach all along keeps its line: nothing of it is clear.
  const stub = stream(7, 4, v(180, -1), v(180, -4))
  const report = empty()
  clearOfTrack([wide, narrow, joined, into, clear, stub], track, report)
  assert.deepEqual(stub.pts, [v(180, -1), v(180, -4)])
  const end = wide.pts.at(-1)!
  assert.ok(end.x === 50 && end.y <= -(3 + corner) && end.y > -(3.5 + corner), `${end.y}`)
  assert.deepEqual(wide.pts, [v(50, -30, "a"), v(50, -10), { x: 50, y: end.y }])
  assert.deepEqual(narrow.pts, [v(60, 20), { x: 60, y: 3 }])
  assert.deepEqual(joined.pts, [v(100, -20), v(100, -1, "j")])
  assert.deepEqual(clear.pts, [v(150, -30), v(150, -9)])
  assert.deepEqual(
    report.ends.map((e) => e.water),
    ["water 1", "water 2"],
  )
  // A stream running along the track, inside its reach, is no culvert's end: the build stops there.
  const along = stream(6, 4, v(10, -40), v(10, -5), v(90, -5))
  assert.throws(() => clearOfTrack([along], track, empty()), /water 6: its end runs/)
})

// Regression: the CTR maps the ballast on a bridge over the Fosso di Rubiana where
// OSM draws 42 m of the track at grade, 12 m over the stream.
test("cutAtBridges cuts at-grade track where the CTR maps a bridge, and keeps level crossings off it", () => {
  const box = (x0: number, x1: number) => [[x0, -5, x1, -5, x1, 5, x0, 5]]
  const line = chain(0),
    report = empty()
  // A 20 m bridge over x 30–50, and one 1.5 m long at x 70 (shorter than a stretch may be).
  cutAtBridges(line, SPANS, [box(30, 50), box(70, 71.5)], none, report)
  assert.deepEqual(
    line.map((p) => p.id ?? p.x),
    [0, "afe:1:0", "afe:1:1", "b0", "b1", 200],
  )
  assert.deepEqual(report.cut, [{ piece: 1, m: 20 }])
  const at = (id: string) => line.findIndex((p) => p.id === id)
  assert.ok(onBridge(line.slice(at("afe:1:0"), at("afe:1:1") + 1), [box(30, 50)]))
  assert.ok(!onBridge(line.slice(0, at("afe:1:0") + 1), [box(30, 50)]))
  // A level crossing (a vertex a road shares) on the bridge stops the build.
  const crossing = [v(0, 0), v(40, 0, "lc"), v(100, 0, "b0"), v(115, 0, "b1"), v(200, 0)]
  assert.throws(
    () => cutAtBridges(crossing, SPANS, [box(30, 50)], (id) => id === "lc", empty()),
    /rail 1: lc would stand on the CTR bridge/,
  )
})

test("underpasses: track over a road tunnel's mouth is cut into a bridge reaching `half` m either side of the road; deeper in, none", () => {
  const track = [v(0, 0), v(100, 0)]
  // A tunnel 8 m long crossing square under the track, its south mouth 2 m from it; another whose mouths lie 40 m off.
  const short = { pts: [v(50, -2), v(50, 6)], half: 10 },
    long = { pts: [v(80, -40), v(80, 40)], half: 10 }
  const polygons = underpasses([track], [short, long])
  assert.equal(polygons.length, 1)
  const line = [...track],
    report = empty()
  cutAtBridges(line, [{ id: 1, bridge: false, tunnel: false }], polygons, none, report)
  const cuts = line.filter((p) => p.id?.startsWith("afe:") === true).map((p) => p.x)
  assert.deepEqual(
    cuts.map((x) => Math.round(x * 1e6) / 1e6),
    [40, 60],
  )
  assert.ok(onBridge([v(40, 0), v(60, 0)], polygons) && !onBridge([v(60, 0), v(100, 0)], polygons))
})

// Regression: OSM's culvert under the CTR's 6.7 m bridge over the Canale di Campiglia crosses the
// track 1.3 m from the bridge's east end; the stream's protected bed, 3 m either side, left the track
// there 1.2 m over the ground.
test("spanned: a CTR bridge reaches `half` m either side of a line crossing under it; a crossing at grade gets none", () => {
  const track = [v(0, 0), v(100, 0)]
  // The CTR's bridge over x 40–46.7; a stream crossing square under it at x 45.4, another at x 80.
  const ctr = (x: number, y: number) => x >= 40 && x <= 46.7 && Math.abs(y) < 3
  const polygons = spanned(
    [track],
    [
      { pts: [v(45.4, -20), v(45.4, 20)], half: 8.66 },
      { pts: [v(80, -20), v(80, 20)], half: 8.66 },
    ],
    ctr,
  )
  assert.equal(polygons.length, 1)
  const line = [...track]
  cutAtBridges(line, [{ id: 1, bridge: false, tunnel: false }], polygons, none, empty())
  assert.deepEqual(
    line.filter((p) => p.id?.startsWith("afe:") === true).map((p) => Math.round(p.x * 100) / 100),
    [36.74, 54.06],
  )
})
