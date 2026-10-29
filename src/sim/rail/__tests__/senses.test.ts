import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { graph } from "../../map/index.ts"
import { laneOf, lanePoint, roadOf, walkIndex, walkSide } from "../../route.ts"
import type { TrainMotionValue } from "../../schema.ts"
import { deathChance, halfOf } from "../../systems/contacts.ts"
import { type CrossingState, OPEN } from "../barriers.ts"
import { CROSSINGS } from "../crossings.ts"
import { LINES, linesNear, pointAt, speedAt } from "../lines.ts"
import { railSense, WHISTLE_RANGE } from "../senses.ts"
import { trainDeath } from "../strikes.ts"
import { crossedBy, MONZONE, RIOLO, wayInto } from "../testing.ts"

const line = LINES[MONZONE.line]!,
  riolo = crossedBy(RIOLO, line.index)
const ground = () => pointAt(line, riolo.s).z
/** A train with its nose at s, facing +s, at `v` m/s. */
const train = (s: number, v: number) => ({
  id: 5,
  model: "atr220" as const,
  motion: { line: line.index, s, prev: s, v, facing: 1, power: 0, brake: 0 } as TrainMotionValue,
})
const states = (i: number, state: CrossingState) =>
  CROSSINGS.map((_, k) => (k === i ? state : OPEN))

test("senses: a moving train's cars are vehicles to keep out of the way of, at its line's pace; a standing one's are not", () => {
  const { cars } = railSense([train(riolo.s - 200, 20)], [], states(-1, OPEN), 1)
  assert.equal(cars.length, 3)
  for (const car of cars) {
    assert.equal(car.usual, speedAt(line, riolo.s - 200))
    assert.ok(Math.abs(car.speed - 20) < 1e-9 && car.length > 16 && car.width === 2.883)
  }
  assert.equal(railSense([train(riolo.s, 0)], [], states(-1, OPEN), 1).cars.length, 0)
})

test("senses: a whistle draws a look within 60 m; the alarm sends whoever stands in the train's path off the track", () => {
  const nose = pointAt(line, riolo.s - 200)
  const sense = (urgent: boolean) =>
    railSense([train(riolo.s - 200, 20)], [{ train: 5, x: nose.x, y: nose.y, urgent }], [], 1)
  const near = { x: nose.x + 40, y: nose.y }
  assert.deepEqual(sense(false).whistled(near, ground), [{ mood: "look", x: nose.x, y: nose.y }])
  const beyond = { x: nose.x + WHISTLE_RANGE + 5, y: nose.y }
  assert.deepEqual(sense(false).whistled(beyond, ground), [])
  // On the track 200 m ahead: out of earshot of a look, but the alarm is for them; they run off its way.
  const onTrack = pointAt(line, riolo.s)
  const [flee] = sense(true).whistled(onTrack, ground)
  assert.equal(flee?.mood, "flee")
  const { angle } = pointAt(line, riolo.s)
  const path = flee?.path ?? { x: 0, y: 0 }
  assert.ok(Math.abs(path.x - Ops.cos(angle)) < 1e-9 && Math.abs(path.y - Ops.sin(angle)) < 1e-9)
  // Behind it, or off its level, the alarm is not for them.
  assert.deepEqual(sense(true).whistled(pointAt(line, riolo.s - 400), ground), [])
  assert.deepEqual(
    sense(true).whistled(onTrack, () => ground() + 3),
    [],
  )
})

/** The last point walking `lane` on its `side` from which the next metre does not yet reach within 3 m of a track's centreline. */
const shortOfTrack = (lane: ReturnType<typeof laneOf>, side: number) => {
  const onTrack = (u: number) => {
    const p = lanePoint(lane, u, side)
    return linesNear(p.x, p.y, 3).length > 0
  }
  let along = -20
  while (!onTrack(along + 1) && along < lane.length) along += 0.05
  return lanePoint(lane, along, side)
}

test("senses: a walker whose next metre takes it onto the track holds at a road crossing in every phase but open, at a foot crossing while a train demands it", () => {
  const way = wayInto(RIOLO, 0),
    lane = laneOf(way.step.edge, way.step.forward),
    verge = walkSide(roadOf(way.step.edge)),
    route = { ...way.step, side: verge }
  const at = shortOfTrack(lane, verge)
  for (const phase of ["warning", "lowering", "closed", "raising"] as const)
    assert.deepEqual(
      railSense([], [], states(RIOLO, { ...OPEN, phase }), 9).holding(at, route),
      { x: CROSSINGS[RIOLO]!.x, y: CROSSINGS[RIOLO]!.y },
      phase,
    )
  assert.equal(railSense([], [], states(RIOLO, OPEN), 9).holding(at, route), undefined)
  // Already on the track when it closes: walks clear.
  const on = lanePoint(lane, (at.x - lane.x) * lane.dx + (at.y - lane.y) * lane.dy + 2, verge)
  assert.equal(
    railSense([], [], states(RIOLO, { ...OPEN, phase: "closed" }), 9).holding(on, route),
    undefined,
  )
  // Equi Terme's foot crossing: held while a train demands it this step, not in its cycle's tail.
  const foot = CROSSINGS.findIndex((c) => c.walk),
    box = CROSSINGS[foot]!
  const path = walkIndex.nearest(box.x, box.y),
    toward = laneOf(path, true),
    forward = (box.x - toward.x) * toward.dx + (box.y - toward.y) * toward.dy > 0
  const walkLane = laneOf(path, forward),
    walking = { edge: path, forward, side: 0.3 },
    walker = shortOfTrack(walkLane, 0.3)
  const demanded = { ...OPEN, phase: "closed" as const, demanded: 9 }
  assert.notEqual(railSense([], [], states(foot, demanded), 9).holding(walker, walking), undefined)
  assert.equal(railSense([], [], states(foot, demanded), 10).holding(walker, walking), undefined)
  assert.ok(graph.walkEdges.includes(path))
})

test("strikes: the train's death curve fits the train strikes by speed, never under a car's, nobody under 5 m/s", () => {
  // Up to 50, 51–60, 61–70, 71–80 and over 80 km/h: 57.3 / 57.7 / 71.7 / 80.0 / 89.7 % died; the train's own curve (a body no car
  // could kill, `half` beyond reach) 52 / 65 / 72 / 78 / 86 %.
  const fit = [40, 55.5, 65.5, 75.5, 90].map((kmh) => Math.round(trainDeath(kmh / 3.6, 1000) * 100))
  assert.deepEqual(fit, [52, 65, 72, 78, 86])
  const adult = halfOf("adult")
  assert.equal(trainDeath(4.9, adult), 0)
  for (const v of [6, 12, 18, 24, 30, 36])
    for (const half of [halfOf("adult"), halfOf("elder"), 7])
      assert.ok(trainDeath(v, half) >= deathChance(v, half))
})
