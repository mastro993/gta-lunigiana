import assert from "node:assert/strict"
import { test } from "node:test"

import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Determinism } from "@typeonce/ritmo-devtools"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { randomAnimal } from "../fauna.ts"
import {
  Animal,
  bindings,
  Dead,
  Down,
  Follows,
  Game,
  Honk,
  KeyboardInput,
  makeRuntime,
  Motion,
  Pedestrian,
  Pose,
  PrevPose,
  Roam,
  setup,
  update,
} from "../index.ts"
import { residentsNear } from "../population/density.ts"
import { farmsNear, pasture, RURAL, RURAL_REACH } from "../population/farms.ts"
import { noTrains } from "../rail/testing.ts"
import { laneOf, lanePoint, laneSide, roadOf, walkIndex, walkSide } from "../route.ts"
import { animal, pedestrian } from "../spawning.ts"
import { BATTISTI, jsonSave, LOOK, rolling, stage, start, type Timeline } from "../testing.ts"
import { beast, FARM, listening, MEADOW } from "./farms.ts"

test("the farm and meadow fixtures: a rural farm with no village near, a pasture clear of the roads", () => {
  assert.ok(residentsNear(FARM.x, FARM.y, RURAL_REACH) < RURAL)
  assert.ok(
    farmsNear(FARM.x, FARM.y, 250).filter((f) => f.rural).length >= 20,
    "a farming hamlet: herds and pigs to be had",
  )
  assert.ok(pasture(MEADOW.x, MEADOW.y))
})

test("a cat runs from the player walking by, and a free dog barks at him, at most every few seconds", () => {
  const timeline: Timeline = [
    { frame: 0, press: ["up"] },
    { frame: 20, release: ["up"] },
  ]
  const game = listening(timeline, [
    MEADOW,
    { animals: [beast("cat", MEADOW, 1.5, 0, 10_000), beast("dog", MEADOW, -8, 0, 0)] },
  ])
  const [cat, dog] = game.world().animals
  let fled = false
  game.run(1200, () => {
    const now = game.world().animals.find((a) => a.id === cat!.id)!
    fled ||= now.mood === "flee"
  })
  assert.ok(fled, "the cat fled")
  assert.ok(
    Vec2.distance(
      game.world().animals.find((a) => a.id === cat!.id)!,
      cat!,
    ) > 5,
    "and got away",
  )
  const barks = game.cries.filter((c) => c.who === dog!.id && c.feeling === "anger")
  assert.ok(barks.length > 0, "the dog barked")
  assert.ok(
    barks.every((b, i) => i === 0 || b.frame - barks[i - 1]!.frame >= 8 * 60),
    `barks at frames ${barks.map((b) => b.frame)}`,
  )
})

test("a cow runs from a horn sounded 8 m away, away from it", () => {
  const game = listening([], [MEADOW, { animals: [beast("cow", MEADOW, 20, 0, 10_000)] }])
  const [cow] = game.world().animals
  game.run(1)
  game.runtime.send(Honk, { car: 0, model: "panda", x: cow!.x - 8, y: cow!.y })
  game.run(60)
  const now = game.world().animals[0]!
  assert.equal(now.mood, "flee")
  assert.ok(now.x - cow!.x > 2, `ran ${(now.x - cow!.x).toFixed(1)} m away from the horn`)
})

test("a dog on a lead keeps by its walker; when the walker is killed it lets go and stays by the body", () => {
  const route = { edge: walkIndex.nearest(MEADOW.x, MEADOW.y), forward: true, side: 0 }
  const walker = pedestrian(LOOK, { ...MEADOW, angle: 0 }, route, {
    mood: "chat",
    until: 1_000_000,
    fx: MEADOW.x + 1,
    fy: MEADOW.y,
  })
  const game = listening([], [MEADOW, { peds: [walker] }])
  const leash = Game.Schedule(
    Game.System(
      "Test/Leash",
      {
        queries: {
          peds: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Pedestrian] }),
        },
        commands: Game.System.commands(
          Game.System.spawns(Animal, Roam, Pose, PrevPose, Motion, Follows),
        ),
      },
      ({ queries, commands }) => {
        for (const { entity, data } of queries.peds.each()) {
          const at = data.pose.get()
          commands.spawn(
            Game.Command.extend(
              animal(randomAnimal("dog", Random.make(5)), { x: at.x - 3, y: at.y + 2, angle: 0 }),
              [
                Follows,
                { leader: Game.Entity.handle(entity.id, Pedestrian), side: 0.5, back: 0.9 },
              ],
            ),
          )
        }
      },
    ),
    Game.Schedule.applyDeferred(),
  )
  assert.ok(game.runtime.tick(leash).ok)
  game.run(120)
  // Its place is 0.5 m to the walker's right and 0.9 m behind (the walker has given up chatting alone and walks on).
  const dog = game.world().animals[0]!,
    owner = game.world().peds[0]!
  const place = {
    x: owner.x + 0.5 * Ops.sin(owner.angle) - 0.9 * Ops.cos(owner.angle),
    y: owner.y - 0.5 * Ops.cos(owner.angle) - 0.9 * Ops.sin(owner.angle),
  }
  assert.ok(
    Vec2.distance(dog, place) < 0.3,
    `the dog ${Vec2.distance(dog, place).toFixed(2)} m off its place`,
  )
  const kill = Game.Schedule(
    Game.System(
      "Test/Kill",
      {
        queries: {
          peds: Game.Query({ selection: { pose: Game.Query.read(Pose) }, with: [Pedestrian] }),
        },
        commands: Game.System.commands(Game.System.inserts(Down, Dead)),
      },
      ({ queries, commands }) => {
        for (const { entity } of queries.peds.each())
          commands.insert(entity, [Down, { until: 0 }], [Dead, { since: 0 }])
      },
    ),
    Game.Schedule.applyDeferred(),
  )
  assert.ok(game.runtime.tick(kill).ok)
  // Regression: once the dead were down too, the dog took its dead owner for one knocked down and rested where it stood, then
  // wandered off. It lies by the body (60 s) all through these 30 s.
  let wandered = 0
  game.run(1800, () => {
    const now = game.world().animals[0]!
    if (now.leader === undefined && now.mood !== "idle") wandered++
  })
  const after = game.world().animals[0]!,
    body = game.world().peds[0]!
  assert.equal(wandered, 0, "it never leaves the body")
  assert.equal(after.leader, undefined, "let go")
  assert.ok(
    Vec2.distance(after, body) < 2,
    `the dog stays by the body: ${Vec2.distance(after, body).toFixed(1)} m`,
  )
})

const walkabout: Timeline = [
  { frame: 0, press: ["up"] },
  { frame: 120, release: ["up"], press: ["right", "sprint"] },
  { frame: 260, release: ["right", "sprint"] },
  { frame: 300, press: ["down"] },
  { frame: 420, release: ["down"] },
]

test("determinism: a walk about the farm with its animals replays bit for bit", () => {
  const result = Determinism.check(
    ({ hostClock }) => {
      const made = makeRuntime({
        seed: 11,
        services: Game.Runtime.services(
          Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, walkabout)),
        ),
        debug: { hostClock },
      })
      if (!made.ok) throw new Error(JSON.stringify(made.error))
      const ready = made.value.tick(
        noTrains,
        setup,
        stage(FARM, { animals: [beast("cat", FARM, 2, 0), beast("cow", FARM, 30, 0)] }),
      )
      if (!ready.ok) throw new Error(JSON.stringify(ready.error))
      return { runtime: made.value, schedules: { update } }
    },
    { schedule: "update", frames: 600, hostClock: HostClock.test() },
  )
  assert.deepEqual(result, { ok: true, frames: 600 })
})

test("saves: animals mid-roam restore through JSON and roam on identically", () => {
  const a = start(walkabout, [FARM])
  a.run(450)
  assert.ok(a.world().animals.length >= 3, `${a.world().animals.length} animals`)
  const b = start()
  assert.ok(b.runtime.restore(jsonSave(a.runtime)).ok)
  assert.deepEqual(b.world().animals, a.world().animals)
  a.run(300)
  b.run(300)
  assert.deepEqual(b.world().animals, a.world().animals)
})

// Regression: Animals read the crashes and struck bodies a step late, from events a save drops, so a game saved the step a body
// was struck no longer scared the cat by it, and played on differently.
test("saves: a save taken the step a car strikes a dog, the cat by it scared in that step, restores and plays on identically", () => {
  const lane = laneOf(BATTISTI.edge, BATTISTI.forward),
    heading = Ops.atan2(lane.dy, lane.dx),
    side = laneSide(BATTISTI, "panda")
  const spot = (at: number, off: number) => ({ ...lanePoint(lane, at, off), angle: heading })
  const away = { x: lanePoint(lane, 20, 0).x + 100, y: lanePoint(lane, 20, 0).y, angle: 0 }
  // A car coasting at 4.5 m/s into a dog lying in its lane 5 m ahead; a cat resting on the far verge 10 m on.
  const a = start(
    [],
    [
      away,
      {
        cars: [rolling("panda", spot(0, side), 4.5, 0)],
        animals: [
          beast("dog", spot(5, side), 0, 0, 100_000),
          beast("cat", spot(15, -walkSide(roadOf(BATTISTI.edge)) - 0.6), 0, 0, 100_000),
        ],
      },
    ],
  )
  for (let frame = 0; !a.heard.impacts.some((i) => i.hit === "animal"); frame++) {
    assert.ok(frame < 120, "the car reached the dog")
    a.run(1)
  }
  assert.equal(
    a.world().animals.find((x) => x.species === "cat")!.mood,
    "flee",
    "the cat ran from the struck dog in that step",
  )
  const b = start()
  assert.ok(b.runtime.restore(jsonSave(a.runtime)).ok)
  for (let frame = 0; frame < 120; frame++) {
    a.run(1)
    b.run(1)
    assert.deepEqual(b.world(), a.world(), `frame ${frame} after the save`)
  }
})
