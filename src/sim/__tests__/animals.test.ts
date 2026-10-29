import assert from "node:assert/strict"
import { test } from "node:test"

import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Determinism } from "@typeonce/ritmo-devtools"
import { Ops, Random, Vec2 } from "@typeonce/ritmo-math"

import { clearOf } from "../body.ts"
import { distanceToEdge, edgeIndex } from "../edges.ts"
import { FAUNA, randomAnimal } from "../fauna.ts"
import {
  Animal,
  bindings,
  Cry,
  Dead,
  Down,
  type Feeling,
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
  type Species,
  update,
} from "../index.ts"
import { graph, MAP, wallsNear } from "../map/index.ts"
import { residentsNear } from "../population/density.ts"
import {
  farmsNear,
  grazing,
  indoors,
  openGround,
  pasture,
  RURAL,
  RURAL_REACH,
} from "../population/farms.ts"
import { noTrains } from "../rail/testing.ts"
import { laneOf, lanePoint, laneSide, roadOf, walkIndex, walkSide } from "../route.ts"
import { animal, pedestrian } from "../spawning.ts"
import { ANIMALS } from "../systems/populate-animals.ts"
import { BATTISTI, jsonSave, LOOK, rolling, stage, start, type Timeline } from "../testing.ts"

/** Gragnola's centre, Fivizzano's busiest village street (the density calibration's spot). */
const GRAGNOLA = { x: -1751, y: 3360, angle: 0 }
/** The SR445 between villages, with no house within 140 m (the density calibration's rural spot). */
const RURAL_ROAD = { x: -279, y: 3736, angle: 0 }

/**
 * A farm out in the country, found by geometry: a rural farm with a pen (a barn, shed or farmyard) and no village or hamlet
 * within 300 m, the one with the most rural farms around it (where herds and pigs are likeliest).
 */
const FARM = (() => {
  const places = MAP.pois.filter((p) => p.kind === "place=village" || p.kind === "place=hamlet")
  const { x0, y0, cols, rows, cell } = MAP.heightmap
  // Every farm on the map: those within the disc that covers it.
  const all = farmsNear(
    x0 + (cols * cell) / 2,
    y0 + (rows * cell) / 2,
    (Math.sqrt(cols * cols + rows * rows) * cell) / 2,
  )
  const lonely = all.filter(
    (f) =>
      f.rural &&
      f.pen &&
      residentsNear(f.x, f.y, RURAL_REACH) < RURAL &&
      places.every((p) => (p.x - f.x) ** 2 + (p.y - f.y) ** 2 > 300 ** 2),
  )
  const around = (f: { readonly x: number; readonly y: number }) =>
    farmsNear(f.x, f.y, 250).filter((g) => g.rural).length
  const best = lonely.reduce((a, b) => (around(b) > around(a) ? b : a))
  return { x: best.x, y: best.y, angle: 0 }
})()

/**
 * A pasture by the farm at least 60 m from any traffic road, where a passing car scares nothing, with no stream within a cow's
 * home range (wading slows a walk past its time), and the ground the herd test puts its animals on, 15–27 m east of it, open and
 * 3 m clear of walk walls (a pig penned in a passage between two walls is blocked on every walk and never rests; one off open
 * ground finds nowhere to walk): found by geometry.
 */
/** Every metre of the herd test's ground east of the meadow, m. */
const HERD = Array.from({ length: 13 }, (_, k) => 15 + k)
const MEADOW = (() => {
  const roads = edgeIndex(graph.trafficEdges)
  for (let r = 20; r < 400; r += 10)
    for (let a = 0; a < 32; a++) {
      const x = FARM.x + r * Ops.cos((a / 32) * 2 * Math.PI),
        y = FARM.y + r * Ops.sin((a / 32) * 2 * Math.PI)
      const road = roads.nearest(x, y)
      if (
        pasture(x, y) &&
        distanceToEdge(road, x, y) - roadOf(road).w / 2 > 60 &&
        !MAP.water.some((w) =>
          w.pts.some(
            (v, k) => k % 2 === 0 && Ops.hypot(v - x, w.pts[k + 1]! - y) < FAUNA.cow.home + 10,
          ),
        ) &&
        HERD.every(
          (dx) =>
            openGround(x + dx, y) &&
            clearOf(wallsNear("walk", x + dx - 3, y - 3, x + dx + 3, y + 3), x + dx, y, 3),
        )
      )
        return { x, y, angle: 0 }
    }
  throw new Error("no meadow by the farm")
})()

/** An animal of `species` at `at` plus (dx, dy), resting until step `until`. */
const beast = (
  species: Species,
  at: { readonly x: number; readonly y: number },
  dx: number,
  dy: number,
  until = 0,
) => {
  const pose = { x: at.x + dx, y: at.y + dy, angle: 0 }
  return Game.Command.extend(animal(randomAnimal(species, Random.make(3)), pose), [
    Roam,
    { mood: "idle", until, hx: pose.x, hy: pose.y, tx: pose.x, ty: pose.y },
  ])
}

/** `start`, plus the cries heard each frame (`cries`). */
const listening = (timeline: Timeline = [], staging?: Parameters<typeof start>[1]) => {
  const game = start(timeline, staging)
  const cries = new Array<{
    readonly who: number
    readonly feeling: Feeling
    readonly frame: number
  }>()
  let frame = 0
  const listen = Game.Schedule(
    Game.System("Test/Cries", { events: { cries: Game.System.readEvent(Cry) } }, ({ events }) => {
      for (const c of events.cries.all()) cries.push({ who: c.who, feeling: c.feeling, frame })
    }),
  )
  const run = (frames: number, each: (frame: number) => void = () => {}) => {
    for (let i = 0; i < frames; i++, frame++) {
      assert.ok(game.runtime.tick(update, listen).ok)
      each(i)
    }
  }
  return { ...game, run, cries }
}

const count = (animals: ReadonlyArray<{ readonly species: Species }>) => {
  const by: Record<Species, number> = { cat: 0, dog: 0, cow: 0, pig: 0 }
  for (const a of animals) by[a.species]++
  return by
}

test("the farm and meadow fixtures: a rural farm with no village near, a pasture clear of the roads", () => {
  assert.ok(residentsNear(FARM.x, FARM.y, RURAL_REACH) < RURAL)
  assert.ok(
    farmsNear(FARM.x, FARM.y, 250).filter((f) => f.rural).length >= 20,
    "a farming hamlet: herds and pigs to be had",
  )
  assert.ok(pasture(MEADOW.x, MEADOW.y))
})

test("a village: cats on Gragnola's streets, never indoors; no cows or pigs", () => {
  const game = listening([], [GRAGNOLA])
  let most = 0
  game.run(1800, (frame) => {
    if (frame % 30 !== 0) return
    const { animals } = game.world()
    most = Math.max(most, animals.length)
    for (const a of animals)
      assert.ok(
        !indoors(a.x, a.y),
        `a ${a.species} indoors at ${a.x.toFixed(1)}, ${a.y.toFixed(1)}`,
      )
  })
  const by = count(game.world().animals)
  const cats = Math.round(
    residentsNear(GRAGNOLA.x, GRAGNOLA.y, ANIMALS.cat.reach) * ANIMALS.cat.perResident,
  )
  assert.equal(by.cat, Math.min(cats, ANIMALS.cat.max), JSON.stringify(by))
  assert.ok(by.cat >= 3, `${by.cat} cats`)
  assert.equal(by.cow + by.pig, 0, JSON.stringify(by))
})

test("a farm in the country: herds of cows on pasture and pigs by their pens, never indoors, within their caps", () => {
  const game = listening([], [FARM])
  game.run(1800, (frame) => {
    if (frame % 30 !== 0) return
    for (const a of game.world().animals)
      assert.ok(
        !indoors(a.x, a.y),
        `a ${a.species} indoors at ${a.x.toFixed(1)}, ${a.y.toFixed(1)}`,
      )
  })
  const { animals } = game.world()
  const by = count(animals)
  assert.ok(by.cow >= ANIMALS.cow.herd[0] && by.cow <= ANIMALS.cow.max, JSON.stringify(by))
  assert.ok(by.pig >= 1 && by.pig <= ANIMALS.pig.max, JSON.stringify(by))
  assert.ok(by.dog >= 1, JSON.stringify(by))
  for (const cow of animals.filter((a) => a.species === "cow"))
    assert.ok(
      grazing(cow.x, cow.y),
      `a cow off the grass at ${cow.x.toFixed(1)}, ${cow.y.toFixed(1)}`,
    )
})

test("a rural road with no house near: no animals over a minute", () => {
  const game = listening([], [RURAL_ROAD])
  game.run(3600, (frame) => {
    if (frame % 60 === 0) assert.deepEqual(game.world().animals, [])
  })
})

test("animals stay near home: each species idles and walks within its home range", () => {
  const cast = (["cat", "dog", "cow", "pig"] as const).map((s, i) =>
    beast(s, MEADOW, 15 + 4 * i, 0),
  )
  const game = listening([], [MEADOW, { animals: cast }])
  const homes = new Map(game.world().animals.map((a) => [a.id, a]))
  const moods = new Set<string>()
  game.run(3600, (frame) => {
    if (frame % 10 !== 0) return
    for (const a of game.world().animals) {
      const home = homes.get(a.id)
      if (home === undefined) continue
      moods.add(`${a.species} ${a.mood}`)
      assert.notEqual(a.mood, "flee", `nothing scares the ${a.species}`)
      assert.ok(
        Vec2.distance(a, { x: home.hx, y: home.hy }) <= FAUNA[a.species].home + 1,
        `the ${a.species} strayed to ${a.x.toFixed(1)}, ${a.y.toFixed(1)}`,
      )
    }
  })
  for (const s of ["cat", "dog", "cow", "pig"]) {
    assert.ok(
      moods.has(`${s} idle`) && moods.has(`${s} walk`),
      `the ${s} rests and walks: ${[...moods]}`,
    )
  }
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
