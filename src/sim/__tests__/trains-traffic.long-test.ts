import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { carCircles, carRadius } from "../body.ts"
import { graph } from "../map/index.ts"
import { MARGIN, OPEN } from "../rail/barriers.ts"
import { linesNear, speedAt } from "../rail/lines.ts"
import { aiTrain, RIOLO, setCrossing, wayInto } from "../rail/testing.ts"
import { laneOf, lanePoint, laneSide, roadOf, type Step, walkSide } from "../route.ts"
import { parkedCar, pedestrian } from "../spawning.ts"
import { HONK_STEPS } from "../systems/traffic.ts"
import { LOOK, start } from "../testing.ts"
import type { VehicleModel } from "../vehicles.ts"
import {
  AWAY,
  BOX,
  CROSSING_ROAD,
  ENVELOPE,
  JUNCTION,
  offTrack,
  panda,
  pastEntry,
  SIDE,
  way,
} from "./crossing-traffic.ts"
import { box, LENGTH, line, riolo, S } from "./railway.ts"

test("trains: traffic queues at Via Riolo's closed crossing clear of the box and of the junction before it, waits patiently, a walker holds short of the track, and all go on once the arms are up", () => {
  const lane = laneOf(way.before.edge, way.before.forward)
  const walkerLane = laneOf(way.step.edge, way.step.forward),
    verge = walkSide(roadOf(way.step.edge))
  const walker = pedestrian(
    LOOK,
    { ...lanePoint(walkerLane, 1, verge), angle: Ops.atan2(walkerLane.dy, walkerLane.dx) },
    { ...way.step, side: verge },
    { mood: "walk", until: 0, fx: 0, fy: 0 },
  )
  // The train 980 m short of the box at line speed, inside its strike-in: the bell at once, the arms down 19 s on.
  const s = riolo.s - 980
  const game = start(
    [],
    [
      AWAY,
      {
        traffic: [
          panda(way.before, lane.length - 4, way.step),
          panda(way.before, lane.length - 14, way.step),
        ],
        peds: [walker],
        trains: [aiTrain(s, 1, speedAt(line, s))],
      },
    ],
    { trains: true, alone: true },
  )
  const crossed = new Set<number>()
  let opened = -1,
    passed = -1,
    held = false,
    inJunction = 0,
    honks = 0,
    nearest = Number.MAX_VALUE,
    walkerNearest = Number.MAX_VALUE
  const stuck = new Set<number>()
  game.run(110 * S, (frame) => {
    const world = game.world(),
      { phase } = world.crossings[RIOLO]!,
      train = world.trains[0]!
    const lo = Math.min(train.s, train.s - LENGTH),
      hi = Math.max(train.s, train.s - LENGTH)
    if (phase !== "open") {
      honks = game.heard.honks.length
      for (const car of world.vehicles) {
        // Nobody on the track, and nobody standing in the box, while it is not open.
        nearest = Math.min(nearest, offTrack("panda", car))
        if (car.pilot !== undefined && car.pilot.stuck >= HONK_STEPS) stuck.add(car.id)
      }
      // The junction kept clear: only the car at the stop line may reach into it.
      inJunction = Math.max(
        inJunction,
        world.vehicles.filter((car) =>
          carCircles("panda", car.angle).some(
            (o) =>
              Ops.hypot(car.x + o.x - JUNCTION.x, car.y + o.y - JUNCTION.y) - carRadius("panda") <
              CROSSING_ROAD,
          ),
        ).length,
      )
      const ped = world.peds[0]!,
        near = linesNear(ped.x, ped.y, 30).find((p) => p.line === line.index)
      walkerNearest = Math.min(walkerNearest, near?.distance ?? 30)
      held ||= ped.mood === "look" && Ops.hypot(ped.vx, ped.vy) < 0.05
    }
    if (passed < 0 && lo > riolo.s + riolo.half + MARGIN) passed = frame
    if (hi > riolo.s - riolo.half && lo < riolo.s + riolo.half)
      for (const car of world.vehicles)
        assert.ok(offTrack("panda", car) > 2, `a car ${offTrack("panda", car)} m off the train`)
    if (opened < 0 && passed > 0 && phase === "open") opened = frame
    for (const body of [...world.vehicles, ...world.peds])
      if (pastEntry(SIDE, body) > BOX + 3) crossed.add(body.id)
  })
  assert.ok(
    passed > 0 && opened > passed,
    `the train passed (${passed}), the arms rose (${opened})`,
  )
  assert.ok(nearest > 1.5, `the queue keeps clear of the track (${nearest.toFixed(2)} m)`)
  assert.deepEqual([...stuck], [], "nobody counts as stuck while the box is closed")
  assert.ok(inJunction <= 1, `the junction kept clear (${inJunction} cars in it)`)
  assert.equal(honks, 0, "nobody honks")
  assert.ok(held, "the walker held, watching")
  assert.ok(walkerNearest > 2.8, `the walker kept ${walkerNearest.toFixed(2)} m from the track`)
  // The arms up, everyone went over.
  assert.equal(crossed.size, 3, "both cars and the walker went over")
})

test("trains: no car drives onto Via Riolo's track with its arms down, nor onto it with no room past, from the side whose way in starts at a junction inside the box", () => {
  // The south-east way in starts at a junction past its own stop line: cars come in round its corner, from either arm.
  const se = wayInto(RIOLO, 1 - SIDE)
  assert.ok(se.stop < 0, "its stop line lies behind the way in's start")
  const arms = graph.adjacency[se.from]!.filter(
    (e) => e !== se.step.edge && graph.trafficEdges.includes(e),
  ).map((edge) => ({ edge, forward: graph.edges[edge]!.b === se.from }))
  /** The nearest a car of `model` at `speed`, 20 m (or its arm's length) short of the junction, comes to the track in 20 s (stuck, it backs up and tries again). */
  const nearest = (
    model: VehicleModel,
    from: Step,
    next: Step,
    closed: boolean,
    blocked = false,
    speed = 8,
  ) => {
    const lane = laneOf(from.edge, from.forward)
    // A Panda parked just past the box's far side, in the lane a car going over would take.
    const far = box.approaches[SIDE]!.entry,
      heading = box.approaches[1 - SIDE]!.heading,
      side = laneSide(se.step, "panda")
    const parked = parkedCar("panda", 0x8b8170, {
      x: far.x + Ops.cos(heading) * 1 + Ops.sin(heading) * side,
      y: far.y + Ops.sin(heading) * 1 - Ops.cos(heading) * side,
      angle: heading,
    })
    const game = start(
      [],
      [
        AWAY,
        {
          traffic: [panda(from, Math.max(0, lane.length - 20), next, speed, model)],
          cars: blocked ? [parked] : [],
        },
      ],
      { trains: true, alone: true },
    )
    if (closed)
      assert.ok(
        game.runtime.tick(setCrossing(RIOLO, { ...OPEN, phase: "closed", demanded: 1e9 })).ok,
      )
    let near = Number.MAX_VALUE
    game.run(20 * S, () => {
      const car = game.world().vehicles.find((v) => v.traffic)!
      near = Math.min(near, offTrack(model, car))
    })
    return near
  }
  for (const arm of arms)
    for (const model of ["panda", "ape"] as const) {
      const closed = nearest(model, arm, se.step, true),
        blocked = nearest(model, arm, se.step, false, true)
      assert.ok(
        closed > ENVELOPE,
        `${model} from ${arm.edge}, arms down: ${closed.toFixed(2)} m off`,
      )
      assert.ok(
        blocked > ENVELOPE,
        `${model} from ${arm.edge}, no room: ${blocked.toFixed(2)} m off`,
      )
    }
  // A truck off the other side's junction at 13 m/s, the arms down, stops short of the envelope too.
  const truck = nearest("truck", way.before, way.step, true, false, 13)
  assert.ok(truck > ENVELOPE, `the truck from the north-west: ${truck.toFixed(2)} m off`)
})
