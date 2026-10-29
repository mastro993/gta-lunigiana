import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { footZ, platformTop } from "../../map/ground.ts"
import { CLEARANCE, foulsAt, LEVEL, offCar, onLevel, ownSide, trainCars } from "../bodies.ts"
import { carsOf } from "../consist.ts"
import { LINES, linesNear, pointAt } from "../lines.ts"
import { TRAINS, trainLength } from "../models.ts"
import { MONZONE } from "../testing.ts"

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
/** An at-grade stretch of the line off any platform, its ground level with the rail 4 m either side, and one in its longest tunnel. */
const GRADE = (() => {
  for (let s = 0; s < line.length; s += 10) {
    const at = pointAt(line, s)
    const level = [-4, -2, 2, 4].every((d) => {
      const p = beside(s, d)
      return Math.abs(footZ(p.x, p.y) - at.z) < 0.5 && platformTop(p.x, p.y) === undefined
    })
    if (!at.bridge && !at.tunnel && level) return s
  }
  return -1
})()
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
  assert.ok(!onLevel(footZ(over.x, over.y), pointAt(line, TUNNEL).z))
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
  // At the platform's very edge, 1.7 m off: reaching into where the train's body passes.
  const brink = [-1.7, 1.7]
    .map((d) => beside(mid, d))
    .find((p) => platformTop(p.x, p.y) !== undefined)!
  assert.notEqual(foulsAt(line.index, body(brink), HALF), undefined)
  assert.equal(LEVEL, 2)
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
