import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { MAP } from "../../map/index.ts"
import { strikeIn } from "../barriers.ts"
import {
  curvatureAt,
  DEFAULT_SPEED,
  DRAWN_RUN,
  linesNear,
  LINES,
  makeLine,
  pointAt,
  runOut,
  sharedPart,
  sharedTrack,
  speedAt,
  type TrackPiece,
} from "../lines.ts"
import { trainLength } from "../models.ts"
import {
  checkAtTheirS,
  checkLinesNear,
  checkNoSharedTrack,
  checkStops,
  checkTerminals,
  railwayAround,
} from "./railway-checks.ts"

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }
/**
 * The railway within 4 km of Monzone station: the Lucca–Aulla line, Monzone's, Gragnola's and Equi
 * Terme's stations and boxes; lines.map-test.ts checks the whole map's.
 */
const HERE = railwayAround(STATION, 4000)

test("lines, by Monzone station: each line runs its pieces terminal to terminal from s 0, then its run-out straight on past each, level", () => {
  assert.equal(LINES.length, MAP.railway.lines.length)
  assert.ok(HERE.lines.length > 0, "the Lucca–Aulla line")
  checkTerminals(HERE.lines)
})

test("lines: a run-out lets a train entering at line speed run its strike-in before the terminal, its whole body past the drawn run", () => {
  const length = trainLength("atr220")
  for (const kmh of [10, 85, 130]) {
    const v = kmh / 3.6
    // Its tail at the run-out's end, its nose this far from the terminal.
    const nose = runOut(v) - length
    assert.ok(nose >= strikeIn(v) && nose >= DRAWN_RUN, `${kmh} km/h`)
  }
  // From the line speed at each end: a faster end runs out farther.
  const line = makeLine(0, [{ pts: [0, 0, 1000, 0], z: [0, 0] }], [[0, 1000, 130]])
  assert.deepEqual([line.start, line.end], [-runOut(130 / 3.6), 1000 + runOut(130 / 3.6)])
  assert.ok(runOut(130 / 3.6) > runOut(85 / 3.6) + 900)
})

test("lines, by Monzone station: the crossings and stations lie at their s, the rail head RAIL_LIFT over the bed, and a box's road meets the rail at its level", () => {
  assert.ok(
    HERE.boxes.length >= 4 && HERE.stations.length >= 3,
    "Monzone's, Gragnola's and Equi Terme's",
  )
  checkAtTheirS(HERE)
})

test("lines: a point's place, heading over 5 m, grade and what it runs on; the curvature of a 300 m curve", () => {
  // East 100 m on a 2% climb, a bridge, then north 100 m in a tunnel.
  const line = makeLine(0, [
    { pts: [0, 0, 50, 0, 100, 0], z: [10, 11, 12] },
    { pts: [100, 0, 100, 50], z: [12, 12], bridge: true },
    { pts: [100, 50, 100, 150], z: [12, 12], tunnel: true },
  ])
  assert.equal(line.length, 250)
  const climb = pointAt(line, 25)
  assert.deepEqual(
    [climb.x, climb.y, climb.z, climb.angle, climb.bridge, climb.tunnel],
    [25, 0, 10.5, 0, false, false],
  )
  assert.ok(Math.abs(climb.grade - 0.02) < 1e-9)
  const bridge = pointAt(line, 125),
    tunnel = pointAt(line, 200)
  assert.deepEqual([bridge.x, bridge.y, bridge.bridge, tunnel.tunnel], [100, 25, true, true])
  assert.ok(Math.abs(bridge.angle - Math.PI / 2) < 1e-9)
  assert.deepEqual(line.tunnels, [{ from: 150, to: 250 }])
  // Clamped at the run-outs' ends.
  assert.deepEqual(pointAt(line, -5000).x, line.start)
  // A 300 m curve, sampled every 2 m.
  const arc = Array.from({ length: 200 }, (_, k) => k / 300)
  const curve = makeLine(0, [
    {
      pts: arc.flatMap((a) => [300 * Ops.sin(a), 300 - 300 * Ops.cos(a)]),
      z: arc.map(() => 0),
    },
  ])
  assert.ok(Math.abs(curvatureAt(curve, 100) - 1 / 300) < 1e-5)
})

test("lines: line speed from OSM's limits, a stretch with none at its lower neighbour's, a line with none at DEFAULT_SPEED, the run-outs at their ends'", () => {
  const pieces = [{ pts: [0, 0, 1000, 0], z: [0, 0] }]
  const line = makeLine(0, pieces, [
    [0, 300, 85],
    [400, 1000, 60],
  ])
  assert.deepEqual(
    [-100, 100, 350, 500, 1100].map((s) => Math.round(speedAt(line, s) * 3.6)),
    [85, 85, 60, 60, 60],
  )
  assert.equal(speedAt(makeLine(0, pieces), 500), DEFAULT_SPEED)
  // The map's Lucca–Aulla line: OSM's 85 / 80 / 85 km/h.
  const map = LINES[0]!
  assert.deepEqual(
    [-50, 100, 5000, 10500, map.length + 50].map((s) => Math.round(speedAt(map, s) * 3.6)),
    [85, 85, 80, 85, 85],
  )
})

test("lines, by Monzone station: linesNear finds each line's s and the distance off it, and nothing out of reach", () => {
  checkLinesNear(HERE.lines)
  assert.deepEqual(linesNear(MAP.spawns.player.x - 2000, MAP.spawns.player.y - 2000, 10), [])
})

test("lines, by Monzone station: a train stops centred on the platforms, and calls next at the first station ahead past its stop reach", () => {
  checkStops(HERE.lines)
})

test("lines: lines on the same pieces share that track, either way round, and the run-out past a terminal they share", () => {
  // Pieces 10 → 11 → 12 east from (0, 0); 13 branches north off the end of 11. Line a runs 10, 11, 12; b runs 10, 11, 13;
  // c runs b's way back, 13, 11, 10, each piece walked from its last vertex.
  const piece = (rail: number, pts: Array<number>, rev = false): TrackPiece => {
    const n = pts.length / 2
    const walked = rev
      ? Array.from({ length: pts.length }, (_, i) => pts[2 * (n - 1 - (i >> 1)) + (i & 1)]!)
      : pts
    return { pts: walked, z: Array.from({ length: n }, () => 0), rail, rev }
  }
  const p10 = [0, 0, 100, 0],
    p11 = [100, 0, 150, 0, 200, 0],
    p12 = [200, 0, 400, 0],
    p13 = [200, 0, 200, 300]
  const a = makeLine(0, [piece(10, p10), piece(11, p11), piece(12, p12)])
  const b = makeLine(1, [piece(10, p10), piece(11, p11), piece(13, p13)])
  const c = makeLine(2, [piece(13, p13, true), piece(11, p11, true), piece(10, p10, true)])
  assert.deepEqual(
    a.runs.map((r) => [r.key, r.from, r.to, r.forward]),
    [
      [-21, a.start, 0, false],
      [10, 0, 100, true],
      [11, 100, 200, true],
      [12, 200, 400, true],
      [-26, 400, a.end, true],
    ],
  )
  const shared = sharedTrack([a, b, c])
  const onto = (to: number, from: number, lo: number, hi: number) =>
    sharedPart(shared[to]![from]!, lo, hi).map((p) => [p.lo, p.hi, p.sign])
  // A body on a's pieces 10–11 is where b runs too, at the same s; on c the other way round, at c.length − s: one stretch each,
  // over the joint, as the track they share runs on unbroken from the run-out to the end of 11.
  assert.deepEqual(onto(1, 0, 50, 160), [[50, 160, 1]])
  assert.deepEqual(onto(2, 0, 50, 160), [[c.length - 160, c.length - 50, -1]])
  assert.deepEqual(
    shared[1]![0]!.map((r) => [r.from, r.to, r.sign]),
    [[a.start, 200, 1]],
  )
  // Partly on a's own piece 12: only the part on 11 is on b's track.
  assert.deepEqual(onto(1, 0, 180, 250), [[180, 200, 1]])
  assert.deepEqual(onto(0, 1, 250, 300), [], "b's branch is not a's track")
  // The run-out west of (0, 0): a's and b's start, c's end.
  assert.deepEqual(onto(1, 0, -300, -200), [[-300, -200, 1]])
  assert.deepEqual(onto(2, 0, -300, -200), [[c.length + 200, c.length + 300, -1]])
  assert.deepEqual(onto(0, 0, 0, 10), [], "none with itself")
  // The map's lines by Monzone station share no track today.
  checkNoSharedTrack(HERE.lines)
})
