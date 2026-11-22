import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { footZ, platformTop } from "../../map/ground.ts"
import { onOneLevel } from "../../one-level.ts"
import { CLEARANCE, foulsAt, offCar, ownSide, trainCars } from "../bodies.ts"
import { carsOf } from "../consist.ts"
import { LINES, linesNear, pointAt } from "../lines.ts"
import { TRAINS, trainLength } from "../models.ts"
import { atGrade, MONZONE } from "../testing.ts"

const line = LINES[MONZONE.line]!,
  HALF = TRAINS.atr220.width / 2

/** The point `off` m to the left (+) of the centreline at s. */
const beside = (s: number, off: number) => {
  const at = pointAt(line, s)
  return { x: at.x - Ops.sin(at.angle) * off, y: at.y + Ops.cos(at.angle) * off }
}
/** Signed distance of `p` left of the centreline, at its nearest point. */
const leftOf = (p: { readonly x: number; readonly y: number }) => {
  const near = linesNear(p.x, p.y, 40).find((n) => n.line === line.index)!,
    at = pointAt(line, near.s)
  return (p.x - at.x) * -Ops.sin(at.angle) + (p.y - at.y) * Ops.cos(at.angle)
}
/** An at-grade stretch of the line by Monzone off any platform, its ground level with the rail 4 m either side, and one in its longest tunnel. */
const GRADE = atGrade()
const TUNNEL = (() => {
  const t = line.tunnels.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))
  return (t.from + t.to) / 2
})()

test("bodies: a train's cars are its bodies, moving with it, round at the noses and square at the joints", () => {
  const s = GRADE + 100
  const motion = { line: line.index, s, prev: s, v: -12, facing: -1, power: 0, brake: 0 } as const
  const cars = trainCars([{ id: 7, motion, model: "atr220" }])
  const poses = carsOf(line, s, -1, "atr220")
  assert.equal(cars.length, poses.length)
  for (const [k, car] of cars.entries()) {
    assert.deepEqual([car.train, car.x, car.y, car.z], [7, poses[k]!.x, poses[k]!.y, poses[k]!.z])
    // Toward −s at 12 m/s, the train's front leading.
    assert.ok(Math.abs(car.speed - 12) < 1e-9 && Math.abs(Ops.hypot(car.vx, car.vy) - 12) < 1e-9)
    assert.ok(car.vx * Ops.cos(car.angle) + car.vy * Ops.sin(car.angle) > 0, "moving front first")
    assert.ok(Math.abs(car.usual - 80 / 3.6) < 1 || Math.abs(car.usual - 85 / 3.6) < 1)
  }
  // The nose: its axis ends a half-width in, so the body reaches the nose; at a joint the axis reaches it.
  const nose = pointAt(line, s),
    front = cars[0]!
  assert.ok(Math.abs(offCar(front, nose.x, nose.y)) < 0.05, "the nose is the body's edge")
  const joint = pointAt(line, s + poses[0]!.length)
  const between = Math.min(...cars.map((car) => offCar(car, joint.x, joint.y)))
  assert.equal(between, 0, "no gap at a joint")
  assert.ok(Math.abs(cars.reduce((sum, car) => sum + car.length, 0) - trainLength("atr220")) < 1e-9)
})

test("bodies: a body fouls the track inside the envelope on the train's level, on a platform only leaning into the train's body, never over a tunnel or on a deck", () => {
  const body = (p: { x: number; y: number }, r = 0.35) => ({
    ...p,
    angle: 0,
    long: r,
    wide: r,
    ground: () => footZ(p.x, p.y),
  })
  const s = GRADE
  assert.ok(Math.abs(foulsAt(line.index, body(beside(s, 0)), HALF)! - s) < 0.5, "on the track")
  assert.notEqual(foulsAt(line.index, body(beside(s, HALF + CLEARANCE + 0.2)), HALF), undefined)
  assert.equal(foulsAt(line.index, body(beside(s, HALF + CLEARANCE + 0.4)), HALF), undefined)
  // A car square across the track reaches 1.85 m either way.
  const across = {
    ...beside(s, 3),
    angle: pointAt(line, s).angle + Math.PI / 2,
    long: 1.85,
    wide: 0.83,
  }
  assert.notEqual(
    foulsAt(line.index, { ...across, ground: () => footZ(across.x, across.y) }, HALF),
    undefined,
  )
  // Over the longest tunnel: far over the rail, so never.
  const over = beside(TUNNEL, 0)
  assert.ok(!onOneLevel(footZ(over.x, over.y), pointAt(line, TUNNEL).z))
  assert.equal(foulsAt(line.index, body(over), HALF), undefined)
  // Someone on a platform by the line: off the track, whatever its edge.
  // Monzone's platform beside the track: a point on it 2 m off the centreline.
  const mid = (MONZONE.s0 + MONZONE.s1) / 2,
    edge = [-2, 2].map((d) => beside(mid, d)).find((p) => platformTop(p.x, p.y) !== undefined)!
  // Reaching over the edge, it would foul the track anywhere else.
  assert.notEqual(
    foulsAt(line.index, body(beside(mid + 200, 2)), HALF),
    undefined,
    "off it, it fouls",
  )
  assert.equal(foulsAt(line.index, body(edge), HALF), undefined)
  // At the platform's very edge, its first point out from the track (the map keeps platforms 1.6 m off; at Monzone's
  // middle it begins 1.78 m out): reaching into where the train's body passes.
  const brink = Array.from({ length: 30 }, (_, k) => 1.6 + 0.01 * k)
    .flatMap((d) => [beside(mid, d), beside(mid, -d)])
    .find((p) => platformTop(p.x, p.y) !== undefined)
  assert.ok(brink !== undefined, "Monzone's platform within 1.9 m of the track")
  assert.notEqual(foulsAt(line.index, body(brink), HALF), undefined)
})

test("bodies: a place picked across the track at grade is kept on the picker's side, 3 m off; on its side, or across a tunnel, it stands", () => {
  const s = GRADE
  const from = beside(s, 8)
  // Across: drawn 8 m the other side, it is brought back 3 m off on this one, beside where it was drawn.
  const kept = ownSide(from, beside(s + 4, -8))
  assert.ok(Math.abs(leftOf(kept) - 3) < 0.05, `${leftOf(kept)} m left`)
  assert.ok(Ops.hypot(kept.x - beside(s + 4, 3).x, kept.y - beside(s + 4, 3).y) < 0.2)
  // On the track: off it, on this side.
  assert.ok(Math.abs(leftOf(ownSide(from, beside(s, 0.5))) - 3) < 0.05)
  // From the other side, the same.
  assert.ok(Math.abs(leftOf(ownSide(beside(s, -8), beside(s, 6))) + 3) < 0.05)
  // On its own side and clear: unchanged.
  const mine = beside(s + 10, 12)
  assert.deepEqual(ownSide(from, mine), mine)
  // Over the tunnel the track is no barrier.
  const up = beside(TUNNEL, 10),
    down = beside(TUNNEL, -10)
  assert.deepEqual(ownSide(up, down), down)
})

// Regression: ownSide took the lines round the walk in the order their grid met them, which the
// lines' lowest corner moves as parts join, and kept the place off the first that barred it: beside
// two tracks side by side at Aulla, the farther one, so the place lay 0.8 m off the nearer one's
// centreline, inside a train's envelope.
test("bodies: a place picked across two lines side by side at grade is kept 3 m off the nearer, on the picker's side", () => {
  const grade = (line: number, s: number) => {
    const at = pointAt(LINES[line]!, s)
    return !at.bridge && !at.tunnel
  }
  // Every 25 m of every line at grade, 8 m off either side, with another line at grade 2.5 to 6 m beyond it.
  const cases = LINES.flatMap((line) =>
    Array.from({ length: Math.floor(line.length / 25) }, (_, k) => 25 * k).flatMap((s) => {
      if (!grade(line.index, s)) return []
      const at = pointAt(line, s),
        nx = -Ops.sin(at.angle),
        ny = Ops.cos(at.angle)
      return ([1, -1] as const).flatMap((side) => {
        const from = { x: at.x + nx * side * 8, y: at.y + ny * side * 8 }
        const near = linesNear(from.x, from.y, 30).filter((p) => grade(p.line, p.s)),
          mine = near.find((p) => p.line === line.index)
        const beyond = near.some(
          (p) =>
            mine !== undefined &&
            p.distance - mine.distance > 2.5 &&
            p.distance < mine.distance + 6,
        )
        return beyond ? [{ from, to: { x: at.x - nx * side * 20, y: at.y - ny * side * 20 } }] : []
      })
    }),
  )
  // Those within 1 km of the one nearest Monzone station: Aulla's, where the Pontremolese and the line to Lucca run side by side.
  const station = pointAt(line, (MONZONE.s0 + MONZONE.s1) / 2),
    off = (p: { readonly x: number; readonly y: number }) => (c: (typeof cases)[number]) =>
      Ops.hypot(c.from.x - p.x, c.from.y - p.y)
  const nearest = cases.reduce((a, b) => (off(station)(b) < off(station)(a) ? b : a)).from,
    there = cases.filter((c) => off(nearest)(c) < 1000)
  assert.ok(there.length >= 20, `${there.length} places beside two lines`)
  for (const { from, to } of there) {
    const kept = ownSide(from, to),
      clear = Math.min(
        ...linesNear(kept.x, kept.y, 10)
          .filter((p) => grade(p.line, p.s))
          .map((p) => p.distance),
      )
    assert.ok(
      clear > 2.95,
      `from (${from.x.toFixed(1)}, ${from.y.toFixed(1)}): ${clear.toFixed(2)} m off a line`,
    )
  }
})

// Regression: ownSide asked whether the line was on a bridge beside the place picked, not where the walk meets it: a cow 8 m off
// the track walked to a place across it 3 m off a bridge's first metres, and crossed the track at grade 2 m short of the bridge.
test("bodies: a place picked across the track beside a bridge is kept on the picker's side when the walk crosses the track at grade", () => {
  const level = (s: number) => {
    const at = pointAt(line, s)
    return at.bridge ? "bridge" : at.tunnel ? "tunnel" : "grade"
  }
  // The start of a bridge 10 m long or more, the line at grade for 20 m before it, nearest Monzone station.
  const mid = (MONZONE.s0 + MONZONE.s1) / 2
  const starts = Array.from({ length: Math.floor(line.length) }, (_, s) => s).filter(
    (s) =>
      level(s) === "bridge" &&
      [1, 5, 10, 15, 20].every((d) => level(s - d) === "grade") &&
      [2, 5, 10].every((d) => level(s + d) === "bridge"),
  )
  assert.ok(starts.length > 0, "a bridge on the line")
  const start = starts.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a))
  // From 8 m off the track 12 m short of the bridge to 4 m off it on the other side 2 m onto the bridge: the walk crosses the
  // track 2.7 m short of the bridge.
  for (const side of [1, -1]) {
    const from = beside(start - 12, 8 * side),
      kept = ownSide(from, beside(start + 2, -4 * side))
    assert.ok(leftOf(kept) * side > 2.95, `${leftOf(kept).toFixed(2)} m left of the centreline`)
  }
  // Under the bridge, the walk crossing the track where it is on the deck: it stands.
  const under = beside(start + 6, -4)
  assert.deepEqual(ownSide(beside(start + 6, 8), under), under)
})
