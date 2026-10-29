import assert from "node:assert/strict"
import { test } from "node:test"

import { Keyboard } from "@typeonce/ritmo-browser"
import { Vec2 } from "@typeonce/ritmo-math"

import { misfires, NEW_ENGINE, UNDAMAGED } from "../../sim/damage.ts"
import { engineRevs } from "../../sim/drivetrain.ts"
import {
  bindings,
  CarInput,
  Chassis,
  type ChassisValue,
  Cry,
  Damage,
  type DamageValue,
  DEFAULT_START,
  Follows,
  Game,
  Honk,
  Impact,
  KeyboardInput,
  Lightning,
  makeRuntime,
  Motion,
  Pedestrian,
  Person,
  Pose,
  type PoseValue,
  PrevPose,
  Route,
  SetClock,
  setup,
  Skid,
  SkyView,
  update,
  Vehicle,
} from "../../sim/index.ts"
import { groundZ } from "../../sim/map/ground.ts"
import { laneOf, lanePoint, laneSide, roadOf, walkSide } from "../../sim/route.ts"
import { animal, parkedCar, pedestrian, rollingChassis } from "../../sim/spawning.ts"
import {
  BATTISTI,
  battistiTraffic,
  burning,
  door,
  LOOK,
  ON_BATTISTI,
  press,
  rolling,
  stage,
  type Timeline,
  wear,
} from "../../sim/testing.ts"
import { VEHICLES, type VehicleModel } from "../../sim/vehicles.ts"
import { followYaw, QUARTER } from "../../sim/view.ts"
import { Audio, audio, skyAt } from "../index.ts"
import type { Heard } from "../types.ts"

/** A runtime on `timeline` whose Audio service records every Heard, the audio schedule ticked after each update. */
const listen = (timeline: Timeline, ...staging: Parameters<typeof stage>) => {
  const frames: Array<Heard> = []
  const made = makeRuntime({
    seed: 1,
    services: Game.Runtime.services(
      Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, timeline)),
      Game.Runtime.service(Audio, { hear: (heard: Heard) => frames.push(heard) }),
    ),
  })
  assert.ok(made.ok)
  const runtime = made.value
  assert.ok(runtime.tick(setup).ok)
  assert.ok(runtime.tick(stage(...staging)).ok)
  const run = (n: number) => {
    for (let i = 0; i < n; i++) assert.ok(runtime.tick(update, audio).ok)
  }
  /** One audio frame with no sim step in between: the staged world as it is. */
  const hear = () => assert.ok(runtime.tick(audio).ok)
  return { runtime, run, hear, frames }
}

/** An unmanned `model` at `pose` rolling at `speed` along its heading with the pedal at `throttle`, its chassis changed by `chassis`, as worn as `damage`. */
const staged = (
  model: VehicleModel,
  pose: PoseValue,
  speed: number,
  throttle: number,
  chassis: Partial<ChassisValue> = {},
  damage: DamageValue = UNDAMAGED,
) => {
  const body = { ...rollingChassis(model, pose, speed), ...chassis }
  const spawn = Game.Command.spawn(
    [Vehicle, { model, color: 0x8b8170 }],
    [Pose, pose],
    [PrevPose, pose],
    [Motion, { vx: Math.cos(pose.angle) * speed, vy: Math.sin(pose.angle) * speed, spin: 0 }],
    [CarInput, { throttle, steer: 0, handbrake: false }],
    [Chassis, body],
    [Damage, damage],
  )
  return { spawn, body }
}

test("hear: the player on foot, then at the wheel of a running car with the horn held, and a pedestrian nearby", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const side = walkSide(roadOf(BATTISTI.edge))
  const verge = { ...lanePoint(lane, 8, side), angle: 0 }
  const walker = pedestrian(
    LOOK,
    verge,
    { ...BATTISTI, side },
    { mood: "walk", until: 0, fx: 0, fy: 0 },
  )
  const { run, frames } = listen(
    [...press(1, "action"), { frame: 3, press: ["horn"] }],
    door(ON_BATTISTI),
    { cars: [parkedCar("panda", 0xb8312b, ON_BATTISTI)], peds: [walker] },
  )
  run(4)
  assert.equal(frames.length, 4, "one Heard per tick")
  const [onFoot, , seated, horn] = frames
  assert.equal(onFoot!.listener.car, undefined)
  assert.ok(
    onFoot!.people.some((p) => p.player && Vec2.distance(p, door(ON_BATTISTI)) < 0.5),
    "the player on foot is a person",
  )
  assert.ok(
    !onFoot!.vehicles.some((v) => Vec2.distance(v, ON_BATTISTI) < 0.5),
    "a parked, still car is silent",
  )

  const mine = seated!.vehicles.filter((v) => v.mine)
  assert.equal(mine.length, 1)
  assert.deepEqual(
    [mine[0]!.id, mine[0]!.model, mine[0]!.running],
    [seated!.listener.car, "panda", true],
  )
  assert.ok(!seated!.people.some((p) => p.player), "the driver is no person on foot")
  assert.ok(
    seated!.people.some(
      (p) => !p.player && p.mood === "walk" && !p.down && !p.dead && Vec2.distance(p, verge) < 2,
    ),
    "the pedestrian on the verge",
  )
  assert.deepEqual([onFoot!.horn, seated!.horn, horn!.horn], [false, false, true])
})

test("hear: who each person is and what they do, who walks with whom, the animals, and the cries since the last frame", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const side = walkSide(roadOf(BATTISTI.edge)),
    route = { ...BATTISTI, side }
  const at = (along: number, offset = 0) => ({ ...lanePoint(lane, along, side + offset), angle: 0 })
  const mother = { ...LOOK, female: true, outfit: "dress", hairdo: "long", height: 1.62 } as const,
    kid = { ...LOOK, age: "kid", height: 1.2 } as const
  const chatter = pedestrian(LOOK, at(14), route, { mood: "chat", until: 1e6, fx: 1, fy: 2 })
  const cat = animal({ species: "cat", coat: 0x222222, patch: 0xffffff, size: 1.1 }, at(18))
  const { runtime, hear, frames } = listen([], door(ON_BATTISTI), {
    peds: [chatter],
    animals: [cat],
  })
  // A mother and the child following her, as Populate spawns a party.
  const party = Game.Schedule(
    Game.System(
      "Test/Party",
      {
        commands: Game.System.commands(
          Game.System.spawns(Pedestrian, Person, Pose, PrevPose, Motion, Route, Follows),
        ),
      },
      ({ commands }) => {
        const leader = Game.Entity.handle(
          commands.spawn(
            pedestrian(mother, at(8), route, { mood: "walk", until: 0, fx: 0, fy: 0 }),
          ),
          Pedestrian,
        )
        commands.spawn(
          Game.Command.extend(
            pedestrian(kid, at(8.4, 0.5), route, { mood: "walk", until: 0, fx: 0, fy: 0 }),
            [Follows, { leader, side: 0.5, back: 0.4 }],
          ),
        )
      },
    ),
    Game.Schedule.applyDeferred(),
  )
  assert.ok(runtime.tick(party).ok)
  hear()
  const people = frames[0]!.people.filter((p) => !p.player),
    near = (along: number) => people.find((p) => Vec2.distance(p, at(along)) < 0.6)!
  assert.deepEqual(
    [near(14).mood, near(14).fx, near(14).fy, near(14).age, near(14).female, near(14).with],
    ["chat", 1, 2, "adult", false, undefined],
  )
  const [mum, child] = [near(8), people.find((p) => p.age === "kid")!]
  assert.deepEqual([mum.female, mum.with, child.with, child.dead], [true, child.id, mum.id, false])
  assert.deepEqual(
    frames[0]!.animals.map((a) => [a.species, a.size, a.mood, a.down, a.dead]),
    [["cat", 1.1, "idle", false, false]],
  )
  runtime.send(Cry, { who: child.id, x: child.x, y: child.y, feeling: "fright" })
  hear()
  hear()
  assert.deepEqual(
    frames.slice(1).map((f) => f.happenings),
    [[{ kind: "cry", who: child.id, x: child.x, y: child.y, feeling: "fright" }], []],
  )
})

test("hear: the listener carries the view's yaw, which the stereo image turns with: the quarter turns on foot, the car's heading driving", () => {
  const { run, frames } = listen(
    [
      ...press(1, "turnLeft"),
      ...press(3, "turnLeft"),
      ...press(5, "turnRight"),
      ...press(7, "action"),
    ],
    door(ON_BATTISTI),
    { cars: [parkedCar("panda", 0xb8312b, ON_BATTISTI)] },
  )
  run(9)
  assert.deepEqual(
    frames.slice(0, 7).map((f) => f.listener.yaw),
    [0, 1, 1, 2, 2, 1, 1].map((turns) => turns * QUARTER),
  )
  const driving = frames.at(-1)!
  assert.ok(driving.listener.car !== undefined)
  assert.equal(driving.listener.yaw, followYaw(driving.vehicles[0]!.angle))
})

test("hear: AI traffic runs even standing; a car nobody drives is heard only while it moves", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const side = laneSide(BATTISTI, "panda")
  const coasting = { ...lanePoint(lane, 30, side), angle: ON_BATTISTI.angle },
    parked = { ...lanePoint(lane, 60, side), angle: ON_BATTISTI.angle }
  const { run, frames } = listen([], door(ON_BATTISTI), {
    cars: [rolling("truck", coasting, 5, 0), parkedCar("panda", 0x3d6155, parked)],
    traffic: [battistiTraffic(0xd4a85e)],
  })
  run(1)
  const near = (p: { readonly x: number; readonly y: number }) =>
    frames[0]!.vehicles.filter((v) => Vec2.distance(v, p) < 1)
  assert.deepEqual(
    near(ON_BATTISTI).map((v) => [v.model, v.running, v.mine]),
    [["panda", true, false]],
  )
  assert.deepEqual(
    near(coasting).map((v) => [v.model, v.running, v.mine]),
    [["truck", false, false]],
  )
  assert.deepEqual(near(parked), [])
})

test("hear: impacts then honks since the last frame, as happenings with the struck vehicle's model and zone, each heard once", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const coasting = { ...lanePoint(lane, 30, laneSide(BATTISTI, "truck")), angle: ON_BATTISTI.angle }
  const { runtime, run, frames } = listen([], door(ON_BATTISTI), {
    cars: [rolling("truck", coasting, 5, 0)],
  })
  run(1)
  const truck = frames[0]!.vehicles.find((v) => v.model === "truck")!
  // 3 m behind the truck's centre, and an impact of a vehicle gone since.
  const behind = { x: truck.x - 3 * Math.cos(truck.angle), y: truck.y - 3 * Math.sin(truck.angle) }
  runtime.send(Honk, { car: 7, model: "ape", x: 1, y: 2 })
  runtime.send(Impact, { hit: "wall", ...behind, speed: 5, mass: 26, car: truck.id })
  runtime.send(Impact, { hit: "wall", x: 3, y: 4, speed: 5, mass: 1, car: 9999 })
  run(2)
  assert.deepEqual(
    frames.slice(1).map((f) => f.happenings),
    [
      [
        {
          kind: "impact",
          hit: "wall",
          ...behind,
          speed: 5,
          mass: 26,
          car: truck.id,
          body: { model: "truck", zone: "rear" },
        },
        { kind: "honk", car: 7, model: "ape", x: 1, y: 2 },
      ],
      [],
    ],
  )
})

test("hear: a ground hit lands on the face that struck: the roof and a side on the side, the nose on the front, the wheels under", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const at = { ...lanePoint(lane, 30, laneSide(BATTISTI, "panda")), angle: ON_BATTISTI.angle }
  const { runtime, hear, frames } = listen([], door(ON_BATTISTI), {
    cars: [rolling("panda", at, 5, 0)],
  })
  hear()
  const car = frames[0]!.vehicles.find((v) => v.model === "panda")!.id
  for (const face of ["roof", "side", "front", "rear", "under"] as const)
    runtime.send(Impact, { hit: "ground", x: at.x, y: at.y, speed: 6, mass: 1.015, car, face })
  hear()
  const zones = frames[1]!.happenings.map((h) => (h.kind === "impact" ? h.body?.zone : undefined))
  assert.deepEqual(zones, ["side", "side", "front", "rear", "under"])
})

test("hear: a vehicle's revs and load are the drivetrain's, from its chassis's gear, its forward speed and its pedal", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const at = { ...lanePoint(lane, 30, laneSide(BATTISTI, "panda")), angle: ON_BATTISTI.angle }
  const { spawn, body } = staged("panda", at, 12, 1)
  const { hear, frames } = listen([], door(ON_BATTISTI), { cars: [spawn] })
  hear()
  const heard = frames[0]!.vehicles.find((v) => v.model === "panda")!,
    revs = engineRevs(VEHICLES.panda, body, 12, 1, 0, NEW_ENGINE)
  assert.ok(
    body.gear > 0 && revs.load === 1 && revs.rpm > VEHICLES.panda.engine.idle,
    `gear ${body.gear}, ${revs.rpm} rpm`,
  )
  assert.ok(
    Math.abs(heard.rpm - revs.rpm) < 1e-6 && heard.load === revs.load,
    `${heard.rpm} rpm, load ${heard.load}`,
  )
})

test("hear: a destroyed car is dead and burns: the player at its wheel runs it no more, and a wreck nobody drives is heard however still it lies", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const parked = { ...lanePoint(lane, 30, laneSide(BATTISTI, "panda")), angle: ON_BATTISTI.angle }
  const { runtime, run, hear, frames } = listen(press(1, "action"), door(ON_BATTISTI), {
    cars: [parkedCar("panda", 0xb8312b, ON_BATTISTI), parkedCar("panda", 0x3d6155, parked)],
  })
  run(3)
  const seated = frames.at(-1)!
  assert.deepEqual(
    seated.vehicles.map((v) => [v.mine, v.running, v.damage]),
    [[true, true, 0]],
    "the parked car, still and intact, is silent",
  )
  assert.ok(runtime.tick(wear(1)).ok)
  hear()
  const [mine, wreck] = [true, false].map((own) =>
    frames.at(-1)!.vehicles.find((v) => v.mine === own),
  )
  assert.deepEqual(
    [mine?.running, mine?.damage, mine?.rpm, mine?.load, mine?.misfire, mine?.burning],
    [false, 1, 0, 0, false, true],
  )
  assert.ok(
    wreck !== undefined &&
      Vec2.distance(wreck, parked) < 0.5 &&
      !wreck.running &&
      wreck.damage === 1 &&
      wreck.burning,
  )
})

test("hear: a wreck burns until it blows up, its Explosion passed on once; the charred shell is heard only while it moves", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward),
    side = laneSide(BATTISTI, "panda")
  const pose = (metres: number) => ({ ...lanePoint(lane, metres, side), angle: ON_BATTISTI.angle })
  // A shell that blew up earlier lies still 25 m on, out of the blast's reach.
  const shell = staged("panda", pose(55), 0, 0, {}, { ...UNDAMAGED, amount: 1, exploded: true })
  const { run, frames } = listen([], door(ON_BATTISTI), {
    cars: [burning("panda", pose(30), 10), shell.spawn],
  })
  run(16)
  const id = frames[0]!.vehicles.find((v) => Vec2.distance(v, pose(30)) < 0.5)!.id,
    of = (frame: Heard) => frame.vehicles.find((v) => v.id === id)
  const blasts = frames.flatMap((f) => f.happenings.filter((h) => h.kind === "explosion"))
  assert.equal(blasts.length, 1, "once")
  const blew = frames.findIndex((f) => f.happenings.some((h) => h.kind === "explosion")),
    [blast] = blasts
  // At its centre of mass, as high as it was heard the frame before.
  assert.ok(
    blast?.car === id &&
      Vec2.distance(blast, pose(30)) < 0.1 &&
      Math.abs(blast.z - of(frames[blew - 1]!)!.z) < 1e-9,
    JSON.stringify(blast),
  )
  assert.ok(
    blew > 0 &&
      frames.slice(0, blew).every((f) => of(f)?.burning === true && of(f)?.running === false),
    "burning until the blast",
  )
  // It leaps and tumbles from the blast on: heard while it moves, burning no more.
  assert.ok(
    frames.slice(blew).every((f) => of(f) !== undefined && !of(f)!.burning),
    "a charred shell",
  )
  assert.ok(
    frames.every((f) => !f.vehicles.some((v) => Vec2.distance(v, pose(55)) < 0.5)),
    "the still shell is silent",
  )
})

test("hear: a worn engine misfires in the sim's windows for its seed, its load still the pedal's", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const at = { ...lanePoint(lane, 30, laneSide(BATTISTI, "panda")), angle: ON_BATTISTI.angle }
  const { spawn, body } = staged("panda", at, 12, 1)
  const rolling = listen([], door(ON_BATTISTI), { cars: [spawn] })
  assert.ok(rolling.runtime.tick(wear(0.95)).ok)
  rolling.hear()
  const worn = rolling.frames[0]!.vehicles.find((v) => v.model === "panda")!,
    revs = engineRevs(VEHICLES.panda, body, 12, 1, 0, { damage: 0.95, seed: worn.id })
  assert.deepEqual([worn.damage, worn.load, worn.misfire], [0.95, 1, revs.misfire])

  // Sitting 4 s in a worn car, idling: whole 0.25 s windows misfire, as the sim's `misfires` draws them for the car's id.
  const seated = listen(press(1, "action"), door(ON_BATTISTI), {
    cars: [parkedCar("panda", 0xb8312b, ON_BATTISTI)],
  })
  seated.run(3)
  assert.ok(seated.runtime.tick(wear(0.95)).ok)
  seated.run(240)
  const mine = seated.frames.slice(3).map((f) => f.vehicles.find((v) => v.mine)!)
  const id = mine[0]!.id,
    flags = mine.map((v) => v.misfire)
  assert.ok(
    flags.includes(true) && flags.includes(false) && mine.every((v) => v.load === 0),
    flags.map((f) => (f ? "X" : ".")).join(""),
  )
  assert.ok(
    Array.from({ length: 15 }, (_, s0) => s0).some((s0) =>
      flags.every((f, k) => f === misfires({ damage: 0.95, seed: id }, s0 + k)),
    ),
  )
})

test("hear: each vehicle's skids since the last frame, the hardest-sliding wheel's surface, the most it slid and how fast", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
  const at = { ...lanePoint(lane, 30, laneSide(BATTISTI, "panda")), angle: ON_BATTISTI.angle }
  const { runtime, hear, frames } = listen([], door(ON_BATTISTI), {
    cars: [rolling("panda", at, 5, 0)],
  })
  hear()
  const car = frames[0]!.vehicles.find((v) => v.model === "panda")!.id
  const skid = { car, x: at.x, y: at.y, z: 0, snow: 0, step: 0 }
  runtime.send(Skid, { ...skid, wheel: 0, slip: 9, amount: 0.4, surface: "asphalt" })
  runtime.send(Skid, { ...skid, wheel: 2, slip: 6, amount: 0.9, surface: "gravel" })
  hear()
  hear()
  const of = (frame: Heard) => frame.vehicles.find((v) => v.id === car)!.skid
  assert.deepEqual(
    [of(frames[0]!), of(frames[1]!), of(frames[2]!)],
    [undefined, { amount: 0.9, slip: 9, surface: "gravel" }, undefined],
  )
})

test("hear: a vehicle's wheels are down on its springs; in the air, on its side or on its roof they are not", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward),
    side = laneSide(BATTISTI, "panda")
  const pose = (metres: number) => ({ ...lanePoint(lane, metres, side), angle: ON_BATTISTI.angle })
  const cars = [
    staged("panda", pose(20), 8, 0),
    staged("panda", pose(30), 8, 0, { z: rollingChassis("panda", pose(30), 8).z + 1.2 }),
    staged("panda", pose(40), 8, 0, { roll: Math.PI / 2 }),
    staged("panda", pose(50), 8, 0, { roll: Math.PI }),
  ]
  const { hear, frames } = listen([], door(ON_BATTISTI), { cars: cars.map((c) => c.spawn) })
  hear()
  const down = [20, 30, 40, 50].map(
    (metres) => frames[0]!.vehicles.find((v) => Vec2.distance(v, pose(metres)) < 0.5)!.wheelsDown,
  )
  assert.deepEqual(down, [true, false, false, false])
  assert.equal(
    frames[0]!.vehicles.find((v) => Vec2.distance(v, pose(30)) < 0.5)!.z,
    cars[1]!.body.z,
  )
})

// Regression: the physics reports no ground hit for a body sliding along the ground, so a car on its roof slid in silence.
test("hear: a car sliding on its roof or its side has its body down on the ground; one on its wheels or in the air has not", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward),
    side = laneSide(BATTISTI, "panda"),
    { height, width, cg } = VEHICLES.panda
  const pose = (metres: number) => ({ ...lanePoint(lane, metres, side), angle: ON_BATTISTI.angle })
  const ground = (metres: number) => groundZ(pose(metres).x, pose(metres).y)
  const cars = [
    staged("panda", pose(10), 8, 0),
    staged("panda", pose(20), 8, 0, { z: ground(20) + 3 }),
    staged("panda", pose(30), 8, 0, { roll: Math.PI / 2, z: ground(30) + width / 2 }),
    staged("panda", pose(40), 8, 0, { roll: Math.PI, z: ground(40) + height - cg }),
  ]
  const { run, frames } = listen([], door(ON_BATTISTI), { cars: cars.map((c) => c.spawn) })
  run(10)
  const at = (metres: number) =>
    frames.at(-1)!.vehicles.find((v) => Vec2.distance(v, pose(metres)) < 3)!
  assert.deepEqual(
    [10, 20, 30, 40].map((metres) => at(metres).hullDown),
    [false, false, true, true],
  )
  for (const metres of [30, 40])
    assert.ok(Math.hypot(at(metres).vx, at(metres).vy) > 2, `${metres} m: still sliding`)
})

// Regression: only planar motion counted, so a car nobody drives rolling over on the spot dropped out and its scrape could not be held.
test("hear: a vehicle nobody drives is heard while it rolls, pitches or bounces, though it has stopped on the ground", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward),
    side = laneSide(BATTISTI, "panda")
  const pose = (metres: number) => ({ ...lanePoint(lane, metres, side), angle: ON_BATTISTI.angle })
  const cars = [
    staged("panda", pose(20), 0, 0, { rollRate: 2 }),
    staged("panda", pose(30), 0, 0, { pitchRate: -1 }),
    staged("panda", pose(40), 0, 0, { vz: 3 }),
    staged("panda", pose(50), 0, 0),
  ]
  const { hear, frames } = listen([], door(ON_BATTISTI), { cars: cars.map((c) => c.spawn) })
  hear()
  assert.deepEqual(
    [20, 30, 40, 50].map((metres) =>
      frames[0]!.vehicles.some((v) => Vec2.distance(v, pose(metres)) < 0.5),
    ),
    [true, true, true, false],
  )
})

test("hear: an Ape rolling into a parked Panda hits it with its front on the Panda's rear", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward),
    side = laneSide(BATTISTI, "panda")
  const ahead = { ...lanePoint(lane, 15, side), angle: ON_BATTISTI.angle }
  const { run, frames } = listen([], door(ON_BATTISTI), {
    cars: [
      parkedCar("panda", 0x3d6155, ahead),
      rolling("ape", { ...lanePoint(lane, 5, side), angle: ON_BATTISTI.angle }, 8, 0),
    ],
  })
  run(120)
  const hits = frames
    .flatMap((f) => f.happenings)
    .flatMap((h) => (h.kind === "impact" && h.hit === "car" ? [h] : []))
  assert.ok(hits.length > 0)
  for (const hit of hits)
    assert.deepEqual(
      new Map([hit.body, hit.otherBody!].map((b) => [b.model, b.zone])),
      new Map([
        ["ape", "front"],
        ["panda", "rear"],
      ]),
    )
})

// Regression: zones split at 45° from the centre, so a hit on a long body's front door (0.9 m ahead of a Panda's centre) was its front.
test("hear: an Ape T-boning a parked Panda on its front door hits the Panda's side", () => {
  const fx = Math.cos(ON_BATTISTI.angle),
    fy = Math.sin(ON_BATTISTI.angle),
    gap = 0.825 + 1.45 + 0.6
  const ape = {
    x: ON_BATTISTI.x + 0.9 * fx - gap * fy,
    y: ON_BATTISTI.y + 0.9 * fy + gap * fx,
    angle: ON_BATTISTI.angle - Math.PI / 2,
  }
  const { run, frames } = listen(
    [],
    door({ x: ON_BATTISTI.x - 40 * fx, y: ON_BATTISTI.y - 40 * fy, angle: 0 }),
    { cars: [parkedCar("panda", 0x3d6155, ON_BATTISTI), rolling("ape", ape, 8, 0)] },
  )
  run(30)
  const hits = frames
    .flatMap((f) => f.happenings)
    .flatMap((h) => (h.kind === "impact" && h.hit === "car" ? [h] : []))
  assert.ok(hits.length > 0)
  for (const hit of hits)
    assert.deepEqual(
      new Map([hit.body, hit.otherBody!].map((b) => [b.model, b.zone])),
      new Map([
        ["ape", "front"],
        ["panda", "side"],
      ]),
    )
})

// Regression: an oblique wall hit's point lay on the wall normal through the centre, so anything 45° off square was a side.
test("hear: a Panda rolling 50° off square into a house wall hits it with its front", () => {
  const wall = { x: -433.525, y: 433.24, angle: 1.386 },
    turn = (50 * Math.PI) / 180,
    back = 18 - Math.cos(turn) * 1.025 - 0.825
  const car = {
    x: wall.x + back * Math.cos(wall.angle),
    y: wall.y + back * Math.sin(wall.angle),
    angle: wall.angle + turn,
  }
  const { run, frames } = listen([], door({ x: car.x - 30, y: car.y, angle: 0 }), {
    cars: [rolling("panda", car, 12, 0)],
  })
  run(40)
  const hits = frames
    .flatMap((f) => f.happenings)
    .flatMap((h) => (h.kind === "impact" && h.hit === "wall" ? [h] : []))
  assert.ok(
    hits.length > 0 && hits.every((h) => h.body.zone === "front"),
    hits.map((h) => h.body.zone).join(),
  )
})

test("hear: the game clock's day, time and sun, a copy of the weather, and each lightning flash since the last frame, once", () => {
  const { runtime, hear, run, frames } = listen([], door(ON_BATTISTI))
  hear()
  // 22 October 2026, 08:00 in Rome: the sun 2° up.
  assert.deepEqual(frames[0]!.sky, skyAt(DEFAULT_START))
  assert.deepEqual([frames[0]!.sky.hour, frames[0]!.sky.minute], [8, 0])
  assert.ok(frames[0]!.sky.sun > 0 && frames[0]!.sky.sun < 5, `${frames[0]!.sky.sun}°`)
  assert.deepEqual(frames[0]!.weather, runtime.inspect(SkyView).weather)
  runtime.send(SetClock, { seconds: DEFAULT_START + 15 * 3600 })
  const flash = { x: 100, y: 200, bolt: true, power: 0.8, seed: 42, step: 0 }
  runtime.send(Lightning, flash)
  run(1)
  hear()
  assert.deepEqual(
    [frames[1]!.sky.hour, frames[1]!.sky.day],
    [23, frames[0]!.sky.day],
    "the clock set to 23:00 the same day",
  )
  assert.deepEqual(
    frames.slice(1).map((f) => f.happenings.filter((h) => h.kind === "lightning")),
    [[{ kind: "lightning", x: 100, y: 200, bolt: true, power: 0.8, seed: 42 }], []],
  )
})
