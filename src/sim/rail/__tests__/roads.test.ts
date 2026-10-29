import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { graph } from "../../map/index.ts"
import { alongLane, laneOf, lanePoint, laneSide, roadOf, type Step } from "../../route.ts"
import { roomFor } from "../../systems/populate.ts"
import { ON_BATTISTI } from "../../testing.ts"
import { type CrossingState, OPEN } from "../barriers.ts"
import { APPROACHES, CROSSINGS } from "../crossings.ts"
import {
  atCrossings,
  backRoom,
  busyBoxes,
  type CrossingCar,
  nearCrossing,
  type Occupant,
  PATIENT_FOR,
  SPAWN_CLEAR,
  STOP_DECEL,
} from "../roads.ts"
import { RIOLO, wayInto } from "../testing.ts"

const S = 60,
  box = CROSSINGS[RIOLO]!
/** The side of Via Riolo whose way in starts at a junction short of its stop line, and that way. */
const SIDE = ([0, 1] as const).find((k) => wayInto(RIOLO, k).stop > 0)!,
  way = wayInto(RIOLO, SIDE)

/** A Panda on `step`, `along` m down its lane, going on to `next`, at `speed` m/s, not braking. */
const panda = (step: Step, along: number, next: Step, speed = 8): CrossingCar => {
  const lane = laneOf(step.edge, step.forward),
    side = laneSide(step, "panda"),
    at = lanePoint(lane, along, side)
  return {
    id: 1,
    ...at,
    angle: Ops.atan2(lane.dy, lane.dx),
    speed,
    length: 3.7,
    width: 1.65,
    side,
    route: step,
    next,
    lane,
    along: alongLane(lane, at.x, at.y),
    grip: 1,
    braking: false,
  }
}
/** Every box open, but box `i` in `state`. */
const states = (i: number, state: CrossingState) =>
  CROSSINGS.map((_, k) => (k === i ? state : OPEN))
const none = CROSSINGS.map(() => false)
/** A parked Panda at (x, y) heading `angle`. */
const parked = (x: number, y: number, angle: number): Occupant => ({
  id: 9,
  x,
  y,
  angle,
  long: 1.85,
  wide: 0.83,
  speed: 0,
})

/** A Panda at 8 m/s 20 m short of the junction the way in starts at, going into the box. */
const coming = () =>
  panda(way.before, laneOf(way.before.edge, way.before.forward).length - 20, way.step)

test("roads: a car on the way into a box not open is held to its stop line; open, it is free", () => {
  const car = coming()
  const closed = atCrossings(
    car,
    [],
    states(RIOLO, { ...OPEN, phase: "closed", since: 0 }),
    none,
    S,
  )
  // Held on a 3.5 m/s² curve to the line: 12.3 m/s 21.5 m short of it.
  assert.ok(Math.abs(closed.limit - Math.sqrt(2 * STOP_DECEL * 21.5)) < 0.3, `${closed.limit} m/s`)
  // Its limit falls to nothing at the line: on a 3.5 m/s² curve, then 0.8 m/s per m.
  const atLine = panda(way.step, way.stop - 1.85 - 0.3, way.step, 0)
  assert.ok(
    atCrossings(atLine, [], states(RIOLO, { ...OPEN, phase: "closed" }), none, S).limit < 1e-6,
  )
  assert.equal(atCrossings(car, [], states(RIOLO, OPEN), none, S).limit, Number.MAX_VALUE)
  // Past the entry it clears the box, whatever the phase.
  const inside = panda(way.step, way.stop + 3, way.step)
  assert.equal(
    atCrossings(inside, [], states(RIOLO, { ...OPEN, phase: "closed" }), none, S).limit,
    Number.MAX_VALUE,
  )
})

test("roads: drivers wait patiently at a closing box for 120 s from its warning, then only while a train moves in its strike-in", () => {
  const car = panda(way.step, 0, way.step, 0)
  const at = (phase: CrossingState["phase"], since: number, now: number, busy = false) =>
    atCrossings(
      car,
      [],
      states(RIOLO, { ...OPEN, phase, since }),
      CROSSINGS.map((_, k) => busy && k === RIOLO),
      now,
    ).patient
  assert.equal(at("warning", 0, 5 * S), true)
  // Closed since 19 s in: 120 s from the warning is 101 s closed.
  assert.equal(at("closed", 19 * S, (PATIENT_FOR - 1) * S), true)
  assert.equal(at("closed", 19 * S, (PATIENT_FOR + 1) * S), false)
  assert.equal(at("closed", 19 * S, (PATIENT_FOR + 1) * S, true), true, "a train moving in")
  assert.equal(at("raising", 0, 1000 * S), true, "the arms on their way up")
  assert.equal(at("open", 0, S), false)
  // Queued back past the tabled ways in, about 45 m off, heading for the box: patient too; heading away, not.
  const back = panda(way.before, -30, way.before)
  const toward = Ops.atan2(box.y - back.y, box.x - back.x)
  const queued = (angle: number) =>
    atCrossings(
      { ...back, angle },
      [],
      states(RIOLO, { ...OPEN, phase: "closed", since: 0 }),
      none,
      S,
    ).patient
  assert.ok(Ops.hypot(box.x - back.x, box.y - back.y) < 60)
  assert.equal(queued(toward), true)
  assert.equal(queued(toward + Math.PI), false)
})

test("roads: an open box is kept clear: with a car standing just past it, in its lane or just beside it heading its way, a car on its way in stops at the line", () => {
  const far = box.approaches[1 - SIDE]!.entry,
    { heading } = box.approaches[SIDE]!,
    car = coming()
  const past = (d: number) =>
    parked(
      far.x + Ops.cos(heading) * d + Ops.sin(heading) * car.side,
      far.y + Ops.sin(heading) * d - Ops.cos(heading) * car.side,
      heading,
    )
  const open = states(RIOLO, OPEN)
  assert.ok(atCrossings(car, [past(2.5)], open, none, S).limit < 13, "no room past it")
  assert.equal(atCrossings(car, [past(9)], open, none, S).limit, Number.MAX_VALUE, "room for it")
  // A car driving on out of the way leaves room.
  assert.equal(
    atCrossings(car, [{ ...past(2.5), speed: 8 }], open, none, S).limit,
    Number.MAX_VALUE,
  )
  // One 0.3 m off its lane's footprint, within how far the straight on past the box may stray from its lane, heading its way takes
  // the room too; coming the other way, queued in its own lane, it drives on through toward the car.
  const off = car.side - (car.width / 2 + 0.3 + 0.83)
  const beside = (angle: number) =>
    parked(
      far.x + Ops.cos(heading) * 2.5 + Ops.sin(heading) * off,
      far.y + Ops.sin(heading) * 2.5 - Ops.cos(heading) * off,
      angle,
    )
  assert.ok(atCrossings(car, [beside(heading)], open, none, S).limit < 13, "beside its lane")
  assert.equal(
    atCrossings(car, [beside(heading + Math.PI)], open, none, S).limit,
    Number.MAX_VALUE,
    "coming the other way",
  )
})

test("roads: toward a box not open, a car stays out of the junction before the way in unless it fits there behind the queue", () => {
  const lane = laneOf(way.before.edge, way.before.forward)
  const car = panda(way.before, lane.length - 9, way.step)
  const into = laneOf(way.step.edge, way.step.forward)
  // The first in line at the stop line, its tail in the junction.
  const first = lanePoint(into, way.stop - 0.3 - 1.85, car.side)
  const queue = [parked(first.x, first.y, Ops.atan2(into.dy, into.dx))]
  const closed = states(RIOLO, { ...OPEN, phase: "closed", since: 0 })
  const held = atCrossings(car, queue, closed, none, S)
  assert.ok(held.limit < car.speed, "it holds")
  // It stands short of the junction by the widest road crossing its way there (and 0.5 m): 0.2 m short of that, held still.
  const crossing = Math.max(
    ...graph.adjacency[way.from]!.filter(
      (e) => e !== way.step.edge && e !== way.before.edge && graph.trafficEdges.includes(e),
    ).map((e) => roadOf(e).w / 2),
  )
  const short = panda(way.before, lane.length - 1.85 - crossing - 0.5 - 0.2, way.step, 0)
  assert.ok(atCrossings(short, queue, closed, none, S).limit < 0.5)
  // With nobody on the way in, it goes on to the stop line, its tail in the junction.
  assert.ok(atCrossings(car, [], closed, none, S).limit > held.limit)
  assert.ok(atCrossings(short, [], closed, none, S).limit > 0.5)
})

// Regression: nothing tested that a car already braking stops for a box in its warning at HARD_DECEL.
test("roads: in the warning, a car already braking stops where it can at 6 m/s², one coasting at that speed goes over", () => {
  const warning = states(RIOLO, { ...OPEN, phase: "warning", since: 0 })
  // At 9 m/s, 8.1 m short of where it stops at its line: 5 m/s² to stop, over STOP_DECEL's 3.5 and under HARD_DECEL's 6.
  const at = laneOf(way.before.edge, way.before.forward).length + way.stop - 1.85 - 0.3 - 8.1
  const car = (braking: boolean) => ({ ...panda(way.before, at, way.step, 9), braking })
  assert.equal(
    atCrossings(car(false), [], warning, none, S).limit,
    Number.MAX_VALUE,
    "coasting, it clears the box",
  )
  assert.ok(atCrossings(car(true), [], warning, none, S).limit < 9, "braking, it stops")
})

// Regression: nothing tested that a car too fast to stop gently at a box in its warning still holds short of the junction before
// its way in while the queue fills that way.
test("roads: in the warning, a car too fast to stop gently at the line still holds short of the junction when the way in is full", () => {
  const warning = states(RIOLO, { ...OPEN, phase: "warning", since: 0 })
  // 20 m short of the junction at 12.5 m/s: 3.7 m/s² to stop at its line, under 6 m/s² short of the junction.
  const car = panda(
    way.before,
    laneOf(way.before.edge, way.before.forward).length - 20,
    way.step,
    12.5,
  )
  const into = laneOf(way.step.edge, way.step.forward),
    first = lanePoint(into, way.stop - 0.3 - 1.85, car.side)
  const queue = [parked(first.x, first.y, Ops.atan2(into.dy, into.dx))]
  assert.equal(
    atCrossings(car, [], warning, none, S).limit,
    Number.MAX_VALUE,
    "with its way in clear, it goes over",
  )
  assert.ok(
    atCrossings(car, queue, warning, none, S).limit < car.speed,
    "with a queue on it, it holds",
  )
})

test("roads: a box is busy while a train moves within its strike-in, and no traffic is brought out within 15 m of a box", () => {
  const { on } = box,
    at = on[0]!
  // A train facing −s with its nose at `lo`: its body from there up to lo + its length.
  const train = (lo: number, v: number) => [
    {
      id: 1,
      model: "atr220" as const,
      motion: { line: at.line, s: lo, prev: lo, v, facing: -1 as const, power: 0, brake: 0 },
    },
  ]
  assert.equal(busyBoxes(train(at.s - at.reach + 10, 20))[RIOLO], true)
  assert.equal(busyBoxes(train(at.s - at.reach - 200, 20))[RIOLO], false, "beyond its strike-in")
  assert.equal(busyBoxes(train(at.s - 20, 0))[RIOLO], false, "standing")
  // Every traffic step tabled into a box has its middle, where traffic is brought out, inside the clearance, or is long.
  for (const [key, entry] of APPROACHES) {
    const lane = laneOf(key >> 1, (key & 1) === 1),
      mid = lanePoint(lane, lane.length / 2, 0),
      crossing = CROSSINGS[entry.box]!
    if (Ops.hypot(mid.x - crossing.x, mid.y - crossing.y) < SPAWN_CLEAR)
      assert.equal(nearCrossing(mid.x, mid.y), true)
  }
  assert.equal(nearCrossing(box.x + SPAWN_CLEAR - 0.1, box.y), true)
  assert.equal(nearCrossing(box.x + SPAWN_CLEAR + 0.1, box.y), false)
  // Populate turns such a spot down, on the way in as anywhere near the box; one on an open road it takes.
  const lane = laneOf(way.step.edge, way.step.forward),
    spot = lanePoint(lane, lane.length / 2, laneSide(way.step, "panda"))
  assert.ok(Ops.hypot(spot.x - box.x, spot.y - box.y) < SPAWN_CLEAR)
  assert.equal(roomFor("panda", { ...spot, angle: Ops.atan2(lane.dy, lane.dx) }, []), false)
  assert.equal(roomFor("panda", ON_BATTISTI, []), true)
})

// Regression (PR review): a car that had cleared Via Riolo and stood stuck in the queue past it backed up onto the track behind it
// with the arms down, 2–4 m at 3 m/s, as the far entry lies about 1 m outside the trains' envelope.
test("roads: a car past a box not open never backs onto its track; open, or backing away from the track, it backs up freely", () => {
  const far = box.approaches[1 - SIDE]!.entry,
    { heading } = box.approaches[SIDE]!
  // A Panda that went over from SIDE, its tail `tail` m past the far entry, heading on away from the box.
  const past = (tail: number) => ({
    x: far.x + Ops.cos(heading) * (tail + 1.85),
    y: far.y + Ops.sin(heading) * (tail + 1.85),
    angle: heading,
    length: 3.7,
    width: 1.65,
  })
  const shut = states(RIOLO, { ...OPEN, phase: "closed", since: 0 }),
    closed = backRoom(past(0.2), shut)
  assert.ok(
    closed > 0 && closed < 4.5,
    `it may back ${closed.toFixed(2)} m, less than a reverse takes`,
  )
  // Backed that far it may back no farther; half-way, half as far again.
  assert.ok(Math.abs(backRoom(past(0.2 - closed), shut)) < 0.01)
  assert.ok(Math.abs(backRoom(past(0.2 - closed / 2), shut) - closed / 2) < 0.01)
  assert.equal(backRoom(past(0.2), states(RIOLO, { ...OPEN, phase: "raising", since: 0 })), closed)
  assert.equal(
    backRoom(past(0.2), states(RIOLO, OPEN)),
    Number.MAX_VALUE,
    "open, it backs up as anywhere",
  )
  // Facing the box from the near side, backing up takes it away from the track.
  const near = box.approaches[SIDE]!.entry
  const waiting = {
    x: near.x - Ops.cos(heading) * 4,
    y: near.y - Ops.sin(heading) * 4,
    angle: heading,
    length: 3.7,
    width: 1.65,
  }
  assert.equal(
    backRoom(waiting, states(RIOLO, { ...OPEN, phase: "closed", since: 0 })),
    Number.MAX_VALUE,
  )
})
