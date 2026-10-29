import assert from "node:assert/strict"
import { test } from "node:test"

import {
  advanceCrossing,
  CROSSING_HOLD,
  type CrossedLine,
  crossingAt,
  type CrossingState,
  demands,
  LOWERING,
  MARGIN,
  OPEN,
  type RailTrain,
  strikeIn,
  WARNING,
} from "../barriers.ts"
import { brakingDistance } from "../driver.ts"

const S = 60
const road = { walk: false }

/** The phases a box goes through from `state`, step by step, with demand on the steps `demand` says. */
const cycle = (from: CrossingState, steps: number, demand: (step: number) => boolean) => {
  const phases: Array<{ step: number; phase: string }> = []
  let state = from
  for (let step = 1; step <= steps; step++) {
    state = advanceCrossing(state, demand(step), step)
    if (phases.at(-1)?.phase !== state.phase) phases.push({ step, phase: state.phase })
  }
  return { phases, state }
}

test("barriers: a demand lights the light and rings the bell 7 s before the arms come down over 12 s; 2 s after the last demand they rise over 12 s", () => {
  // A train demands the box for 30 s from step 1.
  const { phases } = cycle(OPEN, 80 * S, (step) => step <= 30 * S)
  assert.deepEqual(phases, [
    { step: 1, phase: "warning" },
    { step: 1 + 7 * S, phase: "lowering" },
    { step: 1 + 19 * S, phase: "closed" },
    { step: 32 * S, phase: "raising" },
    { step: 44 * S, phase: "open" },
  ])
  // What shows: dark and up when open; lit and ringing from the warning; lit, quiet and down when closed; lit until fully up.
  const show = (state: CrossingState, now: number) => crossingAt(road, state, now)
  let state = OPEN
  const seen: Array<ReturnType<typeof show>> = []
  for (let step = 1; step <= 50 * S; step++) {
    state = advanceCrossing(state, step <= 30 * S, step)
    if ([1, 7 * S, 7 * S + 1 + 6 * S, 25 * S, 32 * S + 6 * S, 44 * S].includes(step))
      seen.push(show(state, step))
  }
  assert.deepEqual(seen, [
    { arm: 0, lit: true, ringing: true },
    { arm: 0, lit: true, ringing: true },
    { arm: 0.5, lit: true, ringing: true },
    { arm: 1, lit: true, ringing: false },
    { arm: 0.5, lit: true, ringing: false },
    { arm: 0, lit: false, ringing: false },
  ])
  // Up while open or warning and down once closed, whatever a state's `from` says: only moving arms read it.
  for (const phase of ["open", "warning", "closed"] as const)
    assert.equal(show({ ...OPEN, phase, from: 0.7 }, S).arm, phase === "closed" ? 1 : 0, phase)
  // A foot crossing runs the cycle and shows nothing.
  assert.deepEqual(crossingAt({ walk: true }, { ...OPEN, phase: "closed" }, 0), {
    arm: 0,
    lit: false,
    ringing: false,
  })
})

test("barriers: a demand while the arms rise lowers them again from where they are, with the bell, and they never jump", () => {
  // A train's demand at step 1 only: the arms rise as soon as they are down. A second demand comes 6 s into the raising.
  const raising = cycle(OPEN, 30 * S, (step) => step === 1).phases.find(
    (p) => p.phase === "raising",
  )!.step
  assert.equal(raising, 1 + 19 * S + 1)
  let state = OPEN,
    last = 0
  for (let step = 1; step <= raising + 6 * S + 10 * S; step++) {
    state = advanceCrossing(state, step === 1 || step > raising + 6 * S, step)
    const { arm, ringing } = crossingAt(road, state, step)
    assert.ok(Math.abs(arm - last) <= 1 / (12 * S) + 1e-9, `the arms move smoothly at step ${step}`)
    last = arm
    if (step === raising + 6 * S + 1) {
      assert.equal(state.phase, "lowering")
      assert.ok(Math.abs(arm - 0.5) < 0.01 && ringing, "lowering again from half way, ringing")
    }
  }
  assert.equal(state.phase, "closed", "down again after the 6 s back")
})

test("barriers: the strike-in has the arms down before a train at its speed would brake for the box: 45 s at 85 km/h, 2 km at 130", () => {
  for (const kmh of [30, 60, 85, 100, 130, 160]) {
    const v = kmh / 3.6
    // Down after the warning and the lowering, the train still beyond its braking distance from its hold point.
    const left = strikeIn(v) - v * (WARNING + LOWERING) - CROSSING_HOLD
    assert.ok(left > brakingDistance(v) + 3 * v, `${kmh} km/h: ${left.toFixed(0)} m left`)
  }
  assert.ok(Math.abs(strikeIn(85 / 3.6) / (85 / 3.6) - 45) < 0.5)
  assert.ok(Math.abs(strikeIn(130 / 3.6) - 2000) < 5)
})

/** Where a line crosses a box at s 1000, 4 m either side, struck in 1000 m out. */
const at: CrossedLine = { line: 0, s: 1000, half: 4, reach: 1000 }
const box = { on: [at] }
const train = (head: number, v: number, more: Partial<RailTrain> = {}): RailTrain => ({
  line: 0,
  head,
  tail: head - 55.57,
  v,
  ...more,
})
const ai = (ready: boolean, dir: 1 | -1 = 1, stop?: number) => ({ ai: { dir, ready, stop } })

test("barriers: a box is demanded by a train on it, by one coming within its strike-in, by an AI train ready to leave, and by nothing else", () => {
  // On the box and MARGIN m either side, standing or not.
  assert.ok(demands(box, [train(1000 - 4 - MARGIN + 0.1, 0)]))
  assert.ok(demands(box, [train(1050, 0)]), "the tail still on it")
  assert.ok(!demands(box, [train(1000 - 4 - MARGIN - 0.5, 0)]), "standing short of it")
  assert.ok(!demands(box, [train(1100 + 4 + MARGIN, 0)]), "standing past it")
  // Coming at it within its strike-in, at any speed over 0.5 m/s: the point is fixed by the line speed, so a train braking or
  // crawling keeps the box down. Not going away, nor barely moving.
  assert.ok(demands(box, [train(1000 - at.reach, 1)]))
  assert.ok(demands(box, [train(1000 - at.reach + 1, 22)]))
  assert.ok(!demands(box, [train(1000 - at.reach - 1, 1)]))
  assert.ok(!demands(box, [train(990, -10)]), "going away")
  assert.ok(!demands(box, [train(900, 0.4)]), "barely moving")
  // Faster than the line speed, from the strike-in at its own speed.
  const fast = 40
  assert.ok(demands(box, [train(1000 - strikeIn(fast) + 1, fast)]))
  assert.ok(!demands(box, [train(1000 - strikeIn(fast) - 1, fast)]))
  // Backing toward it at 2 m/s, the end leading its motion counts: the tail 984 m off, though the cab is 1040 m off.
  assert.ok(demands(box, [{ line: 0, head: 2040, tail: 1984.43, v: -2 }]))
  // An AI train standing ready to go, the box ahead within its strike-in; not one that dwells on, nor the box behind it.
  assert.ok(demands(box, [train(1000 - at.reach + 5, 0, ai(true))]))
  assert.ok(!demands(box, [train(1000 - at.reach + 5, 0, ai(false))]), "still dwelling")
  assert.ok(!demands(box, [train(1000 - at.reach + 5, 0, ai(true, -1))]), "running the other way")
  // Another line: never; a box no line crosses: never.
  assert.ok(!demands({ on: [{ ...at, line: 1 }] }, [train(1000, 0)]))
  assert.ok(!demands({ on: [] }, [train(1000, 0)]))
})

test("barriers: an AI train demands no box whose near edge is past its next stop, and every box short of it, its head stopping on one", () => {
  // A stop well short of the box: that box waits for the departure.
  assert.ok(!demands(box, [train(700, 20, ai(true, 1, 950))]))
  assert.ok(demands(box, [train(700, 20, ai(true, 1, 1100))]))
  // A stop that puts its head 1 m onto the carriageway: demanded on the way in, from the strike-in, not only once on it.
  assert.ok(demands(box, [train(400, 20, ai(true, 1, 997))]))
  assert.ok(demands(box, [train(400, 0, ai(true, 1, 997))]), "and standing ready short of it")
  // Its stop 1 m short of the box's near edge: past it.
  assert.ok(!demands(box, [train(400, 20, ai(true, 1, 1000 - 4 - MARGIN - 1))]))
  // The other way, mirrored.
  assert.ok(demands(box, [train(1600, -20, { tail: 1655.57, ...ai(true, -1, 1003) })]))
  assert.ok(!demands(box, [train(1600, -20, { tail: 1655.57, ...ai(true, -1, 1007) })]))
})

test("barriers: a box two lines cross closes for the trains of either, each at its own s", () => {
  const both = { on: [at, { line: 3, s: 250, half: 3, reach: 900 }] }
  assert.ok(demands(both, [train(1000 - 900, 20)]), "line 0's train, inside line 0's strike-in")
  assert.ok(demands(both, [{ ...train(250 - 899, 20), line: 3 }]), "line 3's train at its s")
  assert.ok(!demands(both, [{ ...train(250 - 901, 20), line: 3 }]))
  assert.ok(
    !demands(both, [{ ...train(1000 - 900, 20), line: 2 }]),
    "a line that crosses elsewhere",
  )
})
