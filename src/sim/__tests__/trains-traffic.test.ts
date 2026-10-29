import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, type Vec2 } from "@typeonce/ritmo-math"

import { carCircles, carRadius } from "../body.ts"
import { graph } from "../map/index.ts"
import { MARGIN, OPEN } from "../rail/barriers.ts"
import { CLEARANCE } from "../rail/bodies.ts"
import { CROSSINGS } from "../rail/crossings.ts"
import { LINES, linesNear, speedAt } from "../rail/lines.ts"
import { trainLength, TRAINS } from "../rail/models.ts"
import { PATIENT_FOR } from "../rail/roads.ts"
import { trainDraft } from "../rail/service.ts"
import { aiTrain, crossedBy, MONZONE, RIOLO, setCrossing, wayInto } from "../rail/testing.ts"
import {
  alongLane,
  cruiseSpeed,
  endNode,
  laneOf,
  lanePoint,
  laneSide,
  roadOf,
  type Step,
  walkSide,
} from "../route.ts"
import { parkedCar, pedestrian, trafficCar } from "../spawning.ts"
import { HONK_STEPS } from "../systems/traffic.ts"
import { LOOK, start } from "../testing.ts"
import type { VehicleModel } from "../vehicles.ts"
import { waterUnder } from "../water/rivers.ts"

const S = 60,
  /** A spate, m³/s per km² (as water.test.ts has it). */
  SPATE = 0.6,
  /** How far a train's envelope reaches either side of the centreline, m: the ATR 220's half-width and 0.3 m. */
  ENVELOPE = TRAINS.atr220.width / 2 + CLEARANCE,
  line = LINES[MONZONE.line]!,
  riolo = crossedBy(RIOLO, line.index),
  box = CROSSINGS[RIOLO]!,
  LENGTH = trainLength("atr220")
/** The side of Via Riolo whose way in starts at a junction short of its stop line (the north-west one, from Via delle Cave). */
const SIDE = ([0, 1] as const).find((k) => wayInto(RIOLO, k).stop > 0)!
const way = wayInto(RIOLO, SIDE)
/** The junction the way in starts at, and the half-width of the widest road crossing the way there. */
const JUNCTION = graph.nodes[way.from]!,
  CROSSING_ROAD = Math.max(
    ...graph.adjacency[way.from]!.filter(
      (e) => e !== way.step.edge && e !== way.before.edge && graph.trafficEdges.includes(e),
    ).map((e) => roadOf(e).w / 2),
  )
/** Far from the box: the player watches from 85 m off, on the first corner of a square round it dry in a spate (the Torrente Lucido runs by). */
const AWAY = (
  [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const
)
  .map(([sx, sy]) => ({ x: box.x + 60 * sx, y: box.y + 60 * sy, angle: 0 }))
  .find(({ x, y }) => waterUnder(x, y, false, SPATE) === undefined)!

/** A traffic car of `model` (a Panda by default) on `step`, `along` m down its lane, heading on to `next`, at `speed` m/s. */
const panda = (step: Step, along: number, next: Step, speed = 5, model: VehicleModel = "panda") => {
  const lane = laneOf(step.edge, step.forward),
    side = laneSide(step, model)
  return trafficCar(
    model,
    0x8b8170,
    { ...lanePoint(lane, along, side), angle: Ops.atan2(lane.dy, lane.dx) },
    speed,
    { ...step, side },
    next,
  )
}

/** How near a vehicle of model `model` at `pose` comes to the line's centreline, its body's edge (m). */
const offTrack = (
  model: VehicleModel,
  pose: { readonly x: number; readonly y: number; readonly angle: number },
) =>
  Math.min(
    ...carCircles(model, pose.angle).map((o) => {
      const near = linesNear(pose.x + o.x, pose.y + o.y, 30).find((p) => p.line === line.index)
      return (near?.distance ?? 30) - carRadius(model)
    }),
  )
/** How far past the box's near entry on side `k` (along the way in) a point lies, m: over 0 inside the box or beyond it. */
const pastEntry = (k: 0 | 1, p: Vec2.Vec2) => {
  const { entry, heading } = box.approaches[k]!
  return (p.x - entry.x) * Ops.cos(heading) + (p.y - entry.y) * Ops.sin(heading)
}
/** The box's length along the way in from side `SIDE`, entry to entry, m. */
const BOX = pastEntry(SIDE, box.approaches[1 - SIDE]!.entry)

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

test("trains: a car in a queue for a box closed long for a standing train counts as stuck again after 120 s, and honks", () => {
  // A train standing across Via Riolo, no driver: the box closed for as long as it stands there.
  const parked = trainDraft("atr220", {
    line: line.index,
    s: riolo.s + LENGTH / 2,
    facing: 1,
    v: 0,
  })
  const lane = laneOf(way.before.edge, way.before.forward)
  const game = start(
    [],
    [AWAY, { traffic: [panda(way.before, lane.length - 8, way.step)], trains: [parked] }],
    { trains: true, alone: true },
  )
  const honked: Array<number> = []
  let closed = -1
  game.run((PATIENT_FOR + 15) * S, (frame) => {
    const world = game.world()
    if (closed < 0 && world.crossings[RIOLO]!.phase === "warning") closed = frame
    if (game.heard.honks.length > honked.length) honked.push(frame)
  })
  assert.equal(closed, 0, "closing from the first step")
  assert.ok(honked.length > 0, "it honks in the end")
  // Then stuck as for a person in the way (the train across the road moves on): its horn half-way to backing up, at four times
  // the count, 6 s on.
  assert.ok(
    Math.abs(honked[0]! / S - PATIENT_FOR - (4 * HONK_STEPS) / S) < 1,
    `not before the box has been closing 120 s, then 6 s (${honked[0]! / S} s)`,
  )
})

test("trains: a walker holds at a box a standing train keeps closed for 120 s from its warning, as drivers wait, then goes another way", () => {
  const parked = trainDraft("atr220", {
    line: line.index,
    s: riolo.s + LENGTH / 2,
    facing: 1,
    v: 0,
  })
  const lane = laneOf(way.step.edge, way.step.forward),
    verge = walkSide(roadOf(way.step.edge))
  const walker = pedestrian(
    LOOK,
    { ...lanePoint(lane, 1, verge), angle: Ops.atan2(lane.dy, lane.dx) },
    { ...way.step, side: verge },
    { mood: "walk", until: 0, fx: 0, fy: 0 },
  )
  const game = start([], [AWAY, { peds: [walker], trains: [parked] }], {
    trains: true,
    alone: true,
  })
  const off = () => {
    const ped = game.world().peds[0]!
    return linesNear(ped.x, ped.y, 60).find((p) => p.line === line.index)?.distance ?? 60
  }
  game.run((PATIENT_FOR - 5) * S)
  assert.equal(game.world().peds[0]!.mood, "look", "holding, watching")
  assert.ok(off() > 2.8)
  game.run(40 * S)
  assert.equal(game.world().peds[0]!.mood, "walk")
  assert.ok(off() > 8, `gone another way (${off().toFixed(1)} m from the track)`)
  assert.equal(game.world().crossings[RIOLO]!.phase, "closed", "the box still closed")
  assert.deepEqual(game.heard.impacts, [], "never struck")
})

test("trains: an open crossing is kept clear: a car does not drive onto Via Riolo's box with a car standing just past it", () => {
  // A parked Panda just past the far side, in the lane a car going over would take.
  const far = box.approaches[1 - SIDE]!.entry,
    { heading } = box.approaches[SIDE]!,
    side = laneSide(way.step, "panda")
  const beyond = {
    x: far.x + Ops.cos(heading) * 2.5 + Ops.sin(heading) * side,
    y: far.y + Ops.sin(heading) * 2.5 - Ops.cos(heading) * side,
    angle: heading,
  }
  const lane = laneOf(way.before.edge, way.before.forward)
  const game = start(
    [],
    [
      AWAY,
      {
        cars: [parkedCar("panda", 0x8b8170, beyond)],
        traffic: [panda(way.before, lane.length - 6, way.step)],
      },
    ],
    { alone: true },
  )
  let deepest = -Number.MAX_VALUE
  game.run(8 * S, () => {
    const car = game.world().vehicles.find((v) => v.traffic)!
    deepest = Math.max(deepest, pastEntry(SIDE, car) + 1.85)
    assert.equal(game.world().crossings[RIOLO]!.phase, "open")
  })
  assert.ok(deepest < 0, `its nose stays short of the box (${deepest.toFixed(2)} m past the entry)`)
  // With the way past clear it goes over.
  const free = start([], [AWAY, { traffic: [panda(way.before, lane.length - 6, way.step)] }], {
    alone: true,
  })
  free.run(8 * S)
  assert.ok(pastEntry(SIDE, free.world().vehicles[0]!) > 5, "with room past the box, it crosses")
})

test("trains: an open crossing is kept clear of a car standing in the middle of the road past it, as the braking cone sees it: a car at cruise never stands on the track", () => {
  // The road box whose lanes lie widest apart, where a car could pass one standing on the road's axis but for a hand's breadth.
  const wide = CROSSINGS.flatMap((b, i) => (b.walk ? [] : [i])).reduce((a, b) =>
    laneSide(wayInto(b, 0).step, "panda") > laneSide(wayInto(a, 0).step, "panda") ? b : a,
  )
  const into = wayInto(wide, 0),
    far = CROSSINGS[wide]!.approaches[1]!.entry,
    { heading } = CROSSINGS[wide]!.approaches[0]!
  const middle = {
    x: far.x + Ops.cos(heading) * 3.5,
    y: far.y + Ops.sin(heading) * 3.5,
    angle: heading,
  }
  const lane = laneOf(into.before.edge, into.before.forward)
  const game = start(
    [],
    [
      { x: CROSSINGS[wide]!.x + 60, y: CROSSINGS[wide]!.y + 60, angle: 0 },
      {
        cars: [parkedCar("panda", 0x8b8170, middle)],
        traffic: [
          panda(into.before, lane.length - 35, into.step, cruiseSpeed(roadOf(into.before.edge))),
        ],
      },
    ],
    { alone: true },
  )
  const near = (p: Vec2.Vec2) =>
    linesNear(p.x, p.y, 40).find((n) => CROSSINGS[wide]!.on.some((on) => on.line === n.line))
  let standing = 0
  game.run(25 * S, () => {
    const car = game.world().vehicles.find((v) => v.traffic)!,
      edge = Math.min(
        ...carCircles("panda", car.angle).map(
          (o) => (near({ x: car.x + o.x, y: car.y + o.y })?.distance ?? 40) - carRadius("panda"),
        ),
      )
    if (Ops.hypot(car.vx, car.vy) < 0.5 && edge < ENVELOPE) standing++
  })
  assert.equal(standing, 0, `${(standing / S).toFixed(1)} s standing in the trains' envelope`)
})

test("trains: a car that cannot stop gently when the bell starts clears the box, and one that can stops at the line", () => {
  // Rolling at 7 m/s, 5 m and 12 m short of the stop line (4.3 and 2.1 m/s² to stop), the bell ringing from the first step.
  const lane = laneOf(way.before.edge, way.before.forward)
  const toLine = lane.length + way.stop - 1.85
  const scene = (short: number) => {
    const game = start([], [AWAY, { traffic: [panda(way.before, toLine - short, way.step, 7)] }], {
      alone: true,
    })
    assert.ok(game.runtime.tick(setCrossing(RIOLO, { ...OPEN, phase: "warning" })).ok)
    let past = -Number.MAX_VALUE
    game.run(5 * S, () => {
      past = Math.max(past, pastEntry(SIDE, game.world().vehicles[0]!) + 1.85)
    })
    return { past, world: game.world() }
  }
  const close = scene(5),
    far = scene(12)
  assert.ok(close.past > 5, `5 m short it went over (${close.past.toFixed(1)} m past)`)
  assert.ok(far.past < -0.5, `12 m short it stopped short of the box (${far.past.toFixed(2)} m)`)
  assert.ok(Ops.hypot(far.world.vehicles[0]!.vx, far.world.vehicles[0]!.vy) < 0.1, "and stands")
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

// Regression (PR review): a car that had cleared Via Riolo and stood stuck in the queue past it counted as stuck (it heads away
// from the box, so nothing made it wait patiently) and backed up onto the track behind it with the arms down.
test("trains: a car stuck in the queue past Via Riolo while its arms are down backs up, but never onto the track", () => {
  const far = box.approaches[1 - SIDE]!.entry,
    { heading } = box.approaches[SIDE]!,
    fx = Ops.cos(heading),
    fy = Ops.sin(heading)
  // The traffic step that takes a car on from the far side, going over from SIDE, and the step after it.
  const ahead = { x: far.x + fx * 6, y: far.y + fy * 6 }
  const off = (step: Step) => {
    const lane = laneOf(step.edge, step.forward),
      along = alongLane(lane, ahead.x, ahead.y)
    return along < 0 || along > lane.length || lane.dx * fx + lane.dy * fy < 0.8
      ? Number.MAX_VALUE
      : Math.abs((ahead.x - lane.x) * lane.dy - (ahead.y - lane.y) * lane.dx)
  }
  const out = graph.trafficEdges
    .flatMap((edge) => [true, false].map((forward): Step => ({ edge, forward })))
    .reduce((p, q) => (off(q) < off(p) ? q : p))
  const lane = laneOf(out.edge, out.forward),
    node = endNode(out.edge, out.forward)
  const then = graph.adjacency[node]!.filter(
    (e) => e !== out.edge && graph.trafficEdges.includes(e),
  )
    .map((e): Step => ({ edge: e, forward: graph.edges[e]!.a === node }))
    .reduce((p, q) => {
      const lp = laneOf(p.edge, p.forward),
        lq = laneOf(q.edge, q.forward)
      return lq.dx * lane.dx + lq.dy * lane.dy > lp.dx * lane.dx + lp.dy * lane.dy ? q : p
    })
  // Just over, stopped: its tail 0.5 m short of the far entry, 4 m clear of the envelope; a parked Panda 1 m ahead of its nose holds
  // it there.
  const along = alongLane(lane, far.x, far.y) - 0.5 + 1.85,
    side = laneSide(out, "panda"),
    blocker = { ...lanePoint(lane, along + 3.7 + 1, side), angle: Ops.atan2(lane.dy, lane.dx) }
  const game = start(
    [],
    [
      AWAY,
      {
        cars: [parkedCar("panda", 0x8b8170, blocker)],
        traffic: [panda(out, along, then, 0)],
      },
    ],
    { alone: true },
  )
  // The arms down for a train that has not come yet, and kept down.
  assert.ok(game.runtime.tick(setCrossing(RIOLO, { ...OPEN, phase: "closed", demanded: 1e9 })).ok)
  const start0 = game.world().vehicles.find((v) => v.traffic)!
  assert.ok(offTrack("panda", start0) > ENVELOPE, "it starts clear of the envelope")
  let nearest = Number.MAX_VALUE,
    backed = 0
  game.run(10 * S, () => {
    const car = game.world().vehicles.find((v) => v.traffic)!
    nearest = Math.min(nearest, offTrack("panda", car))
    backed = Math.max(backed, (start0.x - car.x) * fx + (start0.y - car.y) * fy)
    assert.equal(game.world().crossings[RIOLO]!.phase, "closed")
  })
  assert.ok(backed > 0.5, `stuck, it backs up (${backed.toFixed(2)} m)`)
  assert.ok(
    nearest > ENVELOPE,
    `its body stays ${(nearest - ENVELOPE).toFixed(2)} m outside the trains' envelope`,
  )
})
