import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { settle } from "../../chassis.ts"
import { footZ } from "../../map/ground.ts"
import { ENTER_GAP } from "../../tuning.ts"
import {
  BOARD_SPEED,
  boarded,
  boardingAt,
  cabOf,
  cabSides,
  doorsOf,
  exitSpot,
  trainInReach,
} from "../boarding.ts"
import { LINES, pointAt } from "../lines.ts"
import { TRAINS, trainLength } from "../models.ts"
import { MONZONE, stopOf, UNDER_ROAD } from "../testing.ts"

const line = LINES[MONZONE.line]!,
  LENGTH = trainLength("atr220"),
  { door, width } = TRAINS.atr220
const S = stopOf(MONZONE.station, 1)
const motion = (v = 0, facing: 1 | -1 = 1) => ({
  line: line.index,
  s: S,
  prev: S,
  v,
  facing,
  power: 0.4,
  brake: 0,
})
/** A point `out` m from a door, square off the track. */
const outFrom = (d: { x: number; y: number; s: number; side: 1 | -1 }, out: number) => {
  const { angle } = pointAt(line, d.s)
  return { x: d.x + Ops.sin(angle) * d.side * out, y: d.y - Ops.cos(angle) * d.side * out }
}

test("boarding: a train's crew doors are 2.5 m behind each nose on each side of its body, the active cab's first", () => {
  const doors = doorsOf(line, motion(), "atr220")
  assert.deepEqual(
    doors.map((d) => [d.end, d.side]),
    [
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
    ],
  )
  for (const d of doors) {
    const at = pointAt(line, d.s)
    assert.ok(Math.abs(Ops.hypot(d.x - at.x, d.y - at.y) - width / 2) < 1e-9)
    // Right of +s for side 1.
    assert.ok(((d.x - at.x) * Ops.sin(at.angle) - (d.y - at.y) * Ops.cos(at.angle)) * d.side > 0)
  }
  assert.ok(
    Math.abs(doors[0]!.s - (S - door)) < 1e-9 && Math.abs(doors[2]!.s - (S - LENGTH + door)) < 1e-9,
  )
  assert.deepEqual(cabSides(1), [-1, 1])
  assert.deepEqual(cabSides(-1), [1, -1])
})

test("boarding: a door is in reach within ENTER_GAP of it, the nearest, while the train moves slower than 1.5 m/s", () => {
  const doors = doorsOf(line, motion(), "atr220"),
    far = doors[3]!
  const at = outFrom(far, 1),
    trains = (v: number) => [{ motion: motion(v), model: "atr220" as const }]
  const found = trainInReach(at, far.z, trains(0), (t) => t)
  assert.ok(found?.door.end === 1 && found.door.side === -1)
  assert.ok(Math.abs(found.gap - 1) < 1e-9)
  assert.ok(trainInReach(at, far.z, trains(BOARD_SPEED - 0.01), (t) => t) !== undefined)
  assert.equal(
    trainInReach(at, far.z, trains(BOARD_SPEED), (t) => t),
    undefined,
    "too fast",
  )
  assert.equal(
    trainInReach(outFrom(far, ENTER_GAP + 0.1), far.z, trains(0), (t) => t),
    undefined,
    "too far",
  )
  assert.equal(
    trainInReach(at, far.z + 2, trains(0), (t) => t),
    undefined,
    "off its level",
  )
})

test("boarding: the action gets into the nearer of a car and a train's door", () => {
  const d = doorsOf(line, motion(), "atr220")[0]!,
    at = outFrom(d, 1.5)
  const car = (gap: number) => {
    // A Panda beyond the person, square off the track, its near side `gap` m away.
    const { angle } = pointAt(line, d.s),
      off = 1.5 + gap + 0.8
    const pose = {
      x: d.x + Ops.sin(angle) * d.side * off,
      y: d.y - Ops.cos(angle) * d.side * off,
      angle,
    }
    return { model: "panda" as const, pose, chassis: settle("panda", pose), damage: 0 }
  }
  const train = [{ motion: motion(), model: "atr220" as const }]
  assert.equal(
    boardingAt(
      at,
      d.z,
      [car(1)],
      (c) => c,
      train,
      (t) => t,
    )?.kind,
    "vehicle",
  )
  assert.equal(
    boardingAt(
      at,
      d.z,
      [car(1.9)],
      (c) => c,
      train,
      (t) => t,
    )?.kind,
    "train",
  )
  assert.equal(
    boardingAt(
      at,
      d.z,
      [car(1)],
      (c) => c,
      [],
      (t: (typeof train)[number]) => t,
    )?.kind,
    "vehicle",
  )
})

test("boarding: boarded at the far cab a train's active cab is that one: its nose at the old tail, facing the other way, the power pulling as it did", () => {
  const was = motion(0.3, 1)
  assert.equal(boarded(was, "atr220", 0), was)
  const now = boarded(was, "atr220", 1)
  assert.deepEqual(now, { ...was, s: S - LENGTH, prev: S - LENGTH, facing: -1, power: -0.4 })
  // The cab's driver's place moved to that end, facing the other way.
  const a = cabOf(line, was, "atr220"),
    b = cabOf(line, now, "atr220")
  assert.ok(Math.abs(Ops.hypot(a.x - b.x, a.y - b.y) - (LENGTH - 2 * door)) < 0.5)
  assert.ok(Math.abs(Math.abs(a.angle - b.angle) - Math.PI) < 0.05)
})

test("boarding: at Monzone someone gets out of the cab 0.6 m out from its door, the side asked first, facing the cab's way", () => {
  for (const side of [1, -1] as const) {
    const spot = exitSpot(line, motion(), "atr220", 0, [side, side > 0 ? -1 : 1])!,
      d = doorsOf(line, motion(), "atr220").find((x) => x.end === 0 && x.side === side)!
    const want = outFrom(d, 0.6)
    assert.ok(Ops.hypot(spot.x - want.x, spot.y - want.y) < 1e-9, `side ${side}`)
    assert.equal(spot.angle, cabOf(line, motion(), "atr220").angle)
  }
})

test("boarding: getting out along a station's platforms, the player steps down on their side whichever is asked first; the driver keeps the order", () => {
  const away = MONZONE.side > 0 ? -1 : 1
  const sideOf = (p: { readonly x: number; readonly y: number }) => {
    const at = pointAt(line, S - door)
    return Math.sign((p.x - at.x) * Ops.sin(at.angle) - (p.y - at.y) * Ops.cos(at.angle))
  }
  assert.equal(sideOf(exitSpot(line, motion(), "atr220", 0, [away, MONZONE.side])!), away)
  assert.equal(
    sideOf(exitSpot(line, motion(), "atr220", 0, [away, MONZONE.side], true)!),
    MONZONE.side,
    "the platforms' side",
  )
})

test("boarding: under a road bridge someone gets out of the cab onto the track's level beside it, not the deck above; only someone on the track's level there, not on the deck, gets in", () => {
  const under = { ...motion(), s: UNDER_ROAD + door, prev: UNDER_ROAD + door }
  const spot = exitSpot(line, under, "atr220", 0, [1, -1])!,
    rail = pointAt(line, UNDER_ROAD).z
  assert.ok(Math.abs(footZ(spot.x, spot.y, rail) - rail) < 2, "beside the track")
  assert.ok(footZ(spot.x, spot.y) - rail > 2, "the deck over it")
  const d = doorsOf(line, under, "atr220")[0]!,
    at = outFrom(d, 1)
  const trains = [{ motion: under, model: "atr220" as const }]
  assert.ok(footZ(at.x, at.y) - d.z > 2, "the deck stands over the rail there")
  assert.equal(
    trainInReach(at, footZ(at.x, at.y), trains, (t) => t),
    undefined,
    "from the deck",
  )
  assert.ok(
    trainInReach(at, d.z, trains, (t) => t),
    "from beside the track",
  )
})
