import assert from "node:assert/strict"
import { test } from "node:test"

import { BELOW, BENEATH, DECK_Z } from "../../../sim/__tests__/viaduct.ts"
import { atGrade } from "../../../sim/map/ground.ts"
import { alongLane, laneOf, lanePoint } from "../../../sim/route.ts"
import { gainToDb } from "../../acoustics.ts"
import { HELD, residentAround } from "../../testing.ts"
import type { Happening, OneShot } from "../../types.ts"
import { animal, FRAME, PANDA, person, rig, world } from "../testing.ts"

// The SR445's viaduct west of Gragnola over the residential road under it (src/sim/__tests__/viaduct.ts): its 7 m deck
// spans the road from about 5 m south of BENEATH to 1 m north of it, 6.1 m over it.
residentAround([BENEATH], HELD)

const lane = laneOf(BELOW, true),
  start = alongLane(lane, BENEATH.x, BENEATH.y)
/** The road below's lane centre `metres` past BENEATH, northward. */
const along = (metres: number) => lanePoint(lane, start + metres, 0)
/** Walking pace, m/s. */
const PACE = 1.4

/**
 * The listener on foot on the road under the deck, 4 m south of BENEATH; a kid walking south toward them for 1 s from 0.5 m
 * south of BENEATH (3.5 to 2.1 m off) and a dog beside them, all the way under the deck, on the road (`deck` false) or on the
 * deck over it. Then the kid screams and is struck by a car, and the dog barks. The loudest gain of each sound's plays, dB.
 */
const heardUnder = (deck: boolean): Record<"step" | "scream" | "thud" | "bark", number> => {
  const director = rig(),
    ears = along(-4)
  const frame = (metres: number, happenings: ReadonlyArray<Happening> = []) => {
    const at = along(metres),
      z = deck ? DECK_Z : atGrade(at.x, at.y),
      heard = world(ears, {
        people: [person(1, at, { age: "kid", z, vx: -lane.dx * PACE, vy: -lane.dy * PACE })],
        animals: [animal(2, "dog", at, { z })],
        happenings,
      })
    return { ...heard, listener: { ...heard.listener, z: atGrade(ears.x, ears.y) } }
  }
  for (let i = 0; i < 60; i++) director.hear(frame(-0.5 - PACE * i * FRAME))
  const end = -0.5 - PACE,
    { x, y } = along(end)
  director.hear(
    frame(end, [
      { kind: "cry", who: 1, x, y, feeling: "fright" },
      { kind: "cry", who: 2, x, y, feeling: "anger" },
      { kind: "impact", hit: "person", x, y, speed: 5, mass: PANDA, car: 9, other: 1 },
    ]),
  )
  director.hear(frame(end))
  const loudest = (kind: OneShot["kind"]) => {
    const plays = director.take(kind)
    assert.ok(plays.length > 0, `a ${kind} ${deck ? "on the deck" : "on the road"}`)
    return Math.max(...plays.map((p) => gainToDb(p.at.gain)))
  }
  return {
    step: loudest("step"),
    scream: loudest("scream"),
    thud: loudest("thud"),
    bark: loudest("bark"),
  }
}

// Regression: the director stood everyone on foot, and the listener, on the highest ground under them, so a kid and a dog
// walking on the road under a bridge were voiced at its deck's height, as loud as next to the listener's ears there.
test("under a viaduct, a kid and a dog on the road are heard there, beside the listener on the road; the same on the deck over them are quieter", () => {
  const road = heardUnder(false),
    deck = heardUnder(true)
  for (const kind of ["step", "scream", "thud", "bark"] as const)
    assert.ok(
      road[kind] - deck[kind] > 5,
      `${kind}: ${road[kind].toFixed(1)} dB on the road, ${deck[kind].toFixed(1)} dB on the deck`,
    )
})
