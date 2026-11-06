import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { GRAVITY, rigFor, RIGS } from "../chassis.ts"
import { REAL_HANDLING } from "../handling.ts"
import { graph } from "../map/index.ts"
import { LEVEL } from "../rail/bodies.ts"
import { roadOf } from "../route.ts"
import { steerLimit } from "../systems/physics.ts"
import {
  comfortSpeed,
  coneRange,
  followSpeed,
  leans,
  onPathLevel,
  roomToTurn,
} from "../systems/traffic.ts"
import { BATTISTI, drive } from "../testing.ts"
import { VEHICLE_MODELS, VEHICLES } from "../vehicles.ts"

// Regression: the AI planned with the real steering lock while the physics turned the wheels by the handling's, so at steering ×2 traffic cornered at twice its comfort.
test("AI comfort: the curve a driver steers is taken under 3.5 m/s² sideways, or under 0.45 of what tips its vehicle over, whatever the handling, times the grip the weather leaves", () => {
  const handlings = [
    REAL_HANDLING,
    { ...REAL_HANDLING, steering: 2 },
    { ...REAL_HANDLING, steering: 0.5 },
    { ...REAL_HANDLING, grip: 1.5 },
  ]
  for (const handling of handlings)
    for (const model of VEHICLE_MODELS)
      for (const steer of [0.3, 0.6, 1])
        for (const speed of [3, 8, 14])
          for (const weather of [1, 0.72, 0.27]) {
            const rig = RIGS[model],
              v = comfortSpeed(model, steer, speed, handling, weather),
              wheel = steer * steerLimit(rigFor(model, handling), speed, weather)
            const lateral = (v * v * Ops.tan(wheel)) / rig.wheelbase
            assert.ok(
              lateral <= Math.min(3.5, 0.45 * rig.tipping * GRAVITY) * weather + 1e-9,
              `${model} steer ${steer} at ${speed} m/s, grip ×${weather}, ${JSON.stringify(handling)}: ${lateral.toFixed(2)} m/s²`,
            )
          }
  assert.ok(comfortSpeed("panda", 0, 10) > 100, "straight ahead: no limit")
  const tight = (weather: number) => comfortSpeed("panda", 1, 3, REAL_HANDLING, weather)
  assert.ok(
    tight(0.27) < tight(0.72) && tight(0.72) < tight(1) * 0.9,
    "a tight turn slower on a wet road, slower still on snow",
  )
})

test("AI leaning: rolled past half its tipping angle a driver fears tipping over; a cambered street does not worry a car", () => {
  assert.equal(leans("ape", { roll: 0.3 }), true, "the Ape at 17°")
  assert.equal(leans("carabinieri", { roll: 0.3 }), false, "the Giulia at 17°")
  // A street pitched 0.33 rad and cambered 0.21 rad (≈ 12°) east of Equi Terme, where Pandas once parked for good.
  assert.equal(leans("panda", { roll: -0.21 }), false)
  assert.equal(leans("truck", { roll: 0.3 }), true)
})

test("AI turning round: never on a bridge or in a tunnel, nor on an edge next to one; on an ordinary street, yes", () => {
  const lifted = (e: number) => roadOf(e).bridge === true || roadOf(e).tunnel === true
  const tunnel = graph.trafficEdges.find((e) => roadOf(e).tunnel === true)!
  const beside = graph.trafficEdges.find(
    (e) =>
      !lifted(e) &&
      [graph.edges[e]!.a, graph.edges[e]!.b].some((n) => graph.adjacency[n]!.some(lifted)),
  )!
  assert.equal(roomToTurn(tunnel), false)
  assert.equal(roomToTurn(beside), false)
  assert.equal(roomToTurn(BATTISTI.edge), true)
  // Short edges of ordinary streets keep their U-turns (a 12 m minimum once excluded 31% of them).
  const short = graph.trafficEdges.filter(
    (e) => graph.edges[e]!.length < 12 && roomToTurn(e),
  ).length
  assert.ok(short > 1000, `${short} short edges allow a turn`)
})

// Regression: the cone and its 0.8 m/s per metre were tuned for 12 m/s; at the trunk road's 25 m/s a laden truck found a car
// standing in its lane 38 m out and hit it at 16 m/s, a Panda at the motorway's 30 m/s at 13 m/s.
test("AI following: at every cruise speed a car finding one standing in its lane at the cone's edge stops short of the gap it keeps", () => {
  const GAP = 2, // traffic.ts: the gap kept to whatever is ahead
    car = VEHICLES.panda.length / 2 // the one standing ahead: its back this far from its centre
  for (const model of VEHICLE_MODELS)
    for (const cruise of [12, 16, 25, 30]) {
      const half = VEHICLES[model].length / 2,
        decel = VEHICLES[model].brakes.decel,
        ahead = coneRange(cruise, 1, decel) + car // its centre, from where the driver starts
      let least = Infinity
      drive(
        model,
        60 * 20,
        (_, { pose, motion }) => {
          const gap = ahead - pose.x - half - car - GAP,
            want = Math.min(cruise, followSpeed(gap, 1, decel))
          return {
            throttle: Math.max(-1, Math.min(1, (want - motion.vx) * 0.4)),
            steer: 0,
            handbrake: false,
          }
        },
        {
          speed: cruise,
          each: (_, { pose }) => (least = Math.min(least, ahead - pose.x - half - car)),
        },
      )
      assert.ok(
        least > 0,
        `a ${model} at ${cruise} m/s ran ${(-least).toFixed(1)} m into the car ahead`,
      )
    }
  // Up to 2 × 0.6 × decel / 0.64 m out the cone's own 0.8 m/s per metre binds first: nothing changes at 12 m/s for a Panda.
  for (const gap of [0, 5, 10, 15, 18.75])
    assert.equal(followSpeed(gap, 1, VEHICLES.panda.brakes.decel), gap * 0.8)
})

/** A deck 6.07 m over flat ground at 100 m (the SR445's viaduct over the road under it), along x and 8 m wide; which of the two a point is on goes by the level nearest `near`, as `groundZ` does. */
const DECK = 106.07
const deckOver = (x: number, y: number, near: number) =>
  Math.abs(y) <= 4 && Math.abs(x) <= 60 && Math.abs(near - DECK) < Math.abs(near - 100) ? DECK : 100
/** A driver heading east (+x) from (x, 0), its wheels' ground `ground`, rising `rise` a metre ahead. */
const east = (x: number, ground: number, rise = 0) => ({ x, y: 0, angle: 0, ground, rise })
/** Something whose middle is `front` m ahead on the path's axis, a circle of radius `wide`. */
const ahead = (front: number, wide = 0.35) => ({ front, across: 0, off: 0, wide, circle: 0 })

test("AI level: on a deck a driver passes over what stands on the ground under its path and holds for what stands on the deck; under the deck, the other way round", () => {
  assert.equal(
    onPathLevel(east(-20, DECK), ahead(20), 100, deckOver),
    false,
    "on the deck, a person under it",
  )
  assert.equal(
    onPathLevel(east(-20, DECK), ahead(20), DECK, deckOver),
    true,
    "on the deck, a person on it",
  )
  assert.equal(
    onPathLevel(east(-20, 100), ahead(20), DECK, deckOver),
    false,
    "under the deck, a person on it",
  )
  assert.equal(
    onPathLevel(east(-20, 100), ahead(20), 100, deckOver),
    true,
    "under the deck, a person under it",
  )
  // A car standing on the deck in line, 1.95 m to the left of the path's axis: it reaches into the path on the deck.
  const beside = { front: 20, across: 1.95, off: 1.95, wide: 0.83, circle: 0 }
  assert.equal(onPathLevel(east(-20, DECK), beside, DECK + 0.1, deckOver), true)
})

test("AI level: a train's car crossing under a deck is read where it reaches into the path, under the deck, however far its middle lies off it", () => {
  // An ATR 220's end car (19.5 m by 2.88) heading north under the deck, its middle 9 m south of the path, its rail head 100.12 m.
  const train = { front: 20, across: -9, off: 9, wide: 19.535 / 2, circle: 0 },
    rail = 100.12
  assert.equal(deckOver(20, -9, DECK), 100, "its middle off the deck")
  assert.equal(onPathLevel(east(0, DECK), train, rail, deckOver), false, "from the deck")
  assert.equal(onPathLevel(east(0, 100), train, rail, deckOver), true, "from the road under it")
})

test("AI level: through a dip a driver holds for a car standing on the far side, where the ground under its own middle, or that carried along its pitch, loses it", () => {
  // 15% down into a dip at x = 0 and 15% up out of it, as the SR445's east of the viaduct.
  const dip = (x: number) => 100 + 0.15 * Math.abs(x)
  const surface = (x: number) => dip(x)
  // At the foot, a car 40 m up the climb: 6 m over the ground under the driver's middle.
  assert.ok(dip(40) - dip(0) > LEVEL)
  assert.equal(
    onPathLevel(east(0, dip(0)), ahead(40, 0.83), dip(40), surface),
    true,
    "from the foot",
  )
  // 25 m down the descent, one 15 m past the foot: 4.5 m off that ground carried along the driver's pitch.
  assert.ok(Math.abs(dip(-25) - 0.15 * 40 - dip(15)) > LEVEL)
  assert.equal(
    onPathLevel(east(-25, dip(-25), -0.15), ahead(40, 0.83), dip(15), surface),
    true,
    "from the descent",
  )
})

test("AI level: steering round a bend, a driver reads the level on the arc its wheels steer, where the car ahead stands, not off the road along its heading", () => {
  // A road on a ledge, 6 m wide along a circle of radius 30 m round (0, 30), at 100 m; off it the hillside falls to 90 m.
  const circle = 30,
    ledge = (x: number, y: number) => (Math.abs(Ops.hypot(x, y - circle) - circle) <= 3 ? 100 : 90)
  // A car standing on the arc 15 m ahead: 4 m left of the heading there.
  const across = circle - Math.sqrt(circle * circle - 15 * 15)
  assert.equal(ledge(15, 0), 90, "off the road along the heading")
  assert.equal(
    onPathLevel(east(0, 100), { front: 15, across, off: 0, wide: 0.83, circle }, 100, ledge),
    true,
  )
})
