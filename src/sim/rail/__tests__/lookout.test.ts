import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import type { TrainRunValue } from "../../schema.ts"
import { LINES, pointAt } from "../lines.ts"
import { fouledAhead, HORN, lookout, lookoutReach, touchingAlong } from "../lookout.ts"
import { TRAINS } from "../models.ts"
import { MONZONE } from "../testing.ts"

const S = 60,
  line = LINES[MONZONE.line]!,
  HALF = TRAINS.atr220.width / 2
const running: TrainRunValue = { dir: 1, stop: -1, state: "run", until: 0 }

test("lookout: a driver looks out as far as its emergency stop and 20 m more: 334 m from 85 km/h, 20 m standing", () => {
  assert.ok(Math.abs(lookoutReach(85 / 3.6) - 334.1) < 0.5, `${lookoutReach(85 / 3.6)}`)
  assert.equal(lookoutReach(0), 20)
  // The emergency brake stops it within that from 80 km/h even under snow (254 m).
  assert.ok(lookoutReach(80 / 3.6) > 254)
})

test("lookout: something on the track ahead within reach holds a train, none behind it or beyond reach", () => {
  const head = 6000,
    on = (s: number) => {
      const at = pointAt(line, s)
      return {
        x: at.x,
        y: at.y,
        angle: Ops.atan2(1, 0),
        long: 0.35,
        wide: 0.35,
        ground: () => at.z,
      }
    }
  assert.equal(fouledAhead(line, head, 1, 100, HALF, [on(head + 60)]), true)
  assert.equal(fouledAhead(line, head, 1, 100, HALF, [on(head + 140)]), false, "beyond reach")
  assert.equal(fouledAhead(line, head, 1, 100, HALF, [on(head - 30)]), false, "behind it")
  assert.equal(fouledAhead(line, head, -1, 100, HALF, [on(head - 30)]), true, "ahead the other way")
  // Off the level (2.5 m over the rail): not on the track.
  const high = { ...on(head + 60), ground: () => pointAt(line, head + 60).z + 2.5 }
  assert.equal(fouledAhead(line, head, 1, 100, HALF, [high]), false)
})

test("lookout: a car beside a train's body, touching its side, holds it from nose to tail; one 0.3 m off, or beside the track past its tail, does not", () => {
  // A train's body from 5945 to 6000; a Panda parallel to the track, its side `gap` m off the train's at s.
  const beside = (s: number, gap: number) => {
    const at = pointAt(line, s),
      off = HALF + gap + 0.83
    return {
      x: at.x - Ops.sin(at.angle) * off,
      y: at.y + Ops.cos(at.angle) * off,
      angle: at.angle,
      long: 1.85,
      wide: 0.83,
      ground: () => at.z,
    }
  }
  assert.equal(touchingAlong(line, 5945, 6000, HALF, [beside(5970, 0.05)]), true)
  assert.equal(touchingAlong(line, 5945, 6000, HALF, [beside(5970, 0.3)]), false, "clear of it")
  assert.equal(touchingAlong(line, 5945, 6000, HALF, [beside(5930, 0.05)]), false, "past its tail")
})

test("lookout: held, a driver brakes to a stand, sounds the horn 10 s while the track stays fouled, then creeps; clear, it runs again", () => {
  // Running onto something: braking, the alarm.
  const onto = lookout(running, false, true, 100)
  assert.deepEqual([onto.run.state, onto.urgent], ["braking", true])
  // Still braking: the alarm every 2 s.
  assert.equal(lookout(onto.run, false, true, 101).run.state, "braking")
  assert.equal(lookout(onto.run, false, false, 220).urgent, true, "again at 2 s")
  // Stopped with it still there: the horn for HORN s.
  const horn = lookout(onto.run, true, true, 300)
  assert.deepEqual([horn.run.state, horn.run.until], ["horn", 300 + HORN * S])
  assert.equal(lookout(horn.run, true, true, 300 + HORN * S - 1).run.state, "horn")
  // Then a creep on.
  const creep = lookout(horn.run, true, true, 300 + HORN * S)
  assert.equal(creep.run.state, "creep")
  assert.equal(lookout(creep.run, true, true, 300 + HORN * S + 1).run.state, "creep")
  // The way clear: running again, whether it stood braking, sounding the horn or creeping.
  for (const run of [onto.run, horn.run, creep.run])
    for (const now of [301, 300 + HORN * S + 10]) {
      const clear = lookout(run, true, false, now)
      assert.deepEqual([clear.run.state, clear.urgent], ["run", false])
    }
  // Braking still moving with the way clear: it brakes on to a stand (an emergency is not taken back).
  assert.equal(lookout(onto.run, false, false, 150).run.state, "braking")
  // A dwelling train is left alone.
  const dwell: TrainRunValue = { ...running, state: "dwell", until: 900 }
  assert.deepEqual(lookout(dwell, true, true, 100), { run: dwell, urgent: false })
})

// Regression: the alarm (1.6 s long) sounded on taking the hold, on the game's 2 s grid and again at the stand, so two
// alarms started on top of each other, their high and low blasts at once, every time an AI train was held.
test("lookout: held from any step, braking to a stand at any step after, the alarms sound 2 s or more apart", () => {
  for (const from of [100, 119, 120, 157])
    for (const stand of [1, 37, 120, 121, 239, 400]) {
      let run = running
      const alarms: Array<number> = []
      for (let now = from; now < from + stand + HORN * S + 2 * S; now++) {
        const watch = lookout(run, now >= from + stand, true, now)
        if (watch.urgent) alarms.push(now)
        run = watch.run
      }
      assert.equal(run.state, "creep")
      assert.equal(alarms[0], from, "the first on taking the hold")
      for (let k = 1; k < alarms.length; k++)
        assert.ok(
          alarms[k]! - alarms[k - 1]! >= 2 * S,
          `held at ${from}, standing ${stand} on: alarms at ${alarms[k - 1]} and ${alarms[k]}`,
        )
      assert.ok(alarms.length >= HORN / 2, `${alarms.length} alarms`)
    }
})

// Regression: each hold taken again sounded the alarm at once, so someone stepping on and off the track in front of a held
// train set alarms going on top of each other; and the horn, its beat begun again on each hold, kept it silent.
test("lookout: held again and again for someone stepping on and off the track, a standing train sounds the alarm every 2 s, once they are on it", () => {
  const END = 100 + 30 * S
  for (const every of [1, 17, 30, 48, 90]) {
    let run = running
    const alarms: Array<number> = []
    for (let now = 100; now < END; now++) {
      const watch = lookout(run, true, Math.floor((now - 100) / every) % 2 === 0, now)
      if (watch.urgent) alarms.push(now)
      run = watch.run
    }
    assert.equal(alarms[0], 100, "the first on taking the hold")
    assert.ok(
      END - alarms.at(-1)! <= 2 * S + every,
      `on and off every ${every}: silent from ${alarms.at(-1)}`,
    )
    for (let k = 1; k < alarms.length; k++) {
      const gap = alarms[k]! - alarms[k - 1]!
      assert.ok(
        gap >= 2 * S && gap <= 2 * S + every,
        `on and off every ${every}: alarms ${gap} steps apart`,
      )
    }
  }
})
