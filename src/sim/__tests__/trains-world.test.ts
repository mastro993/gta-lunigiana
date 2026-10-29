import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Random } from "@typeonce/ritmo-math"

import { FAUNA, randomAnimal } from "../fauna.ts"
import { Game, Roam, Whistle } from "../index.ts"
import { atGrade, footZ, roadLevel } from "../map/ground.ts"
import { MAP } from "../map/index.ts"
import { grazing } from "../population/farms.ts"
import { LEVEL, onLevel } from "../rail/bodies.ts"
import { LINES, linesNear, pointAt, speedAt } from "../rail/lines.ts"
import { isHeld } from "../rail/models.ts"
import { trainDraft } from "../rail/service.ts"
import {
  aiTrain,
  DOWN_TO_BOX,
  MONZONE,
  OVER_ROAD,
  placeTrains,
  UNDERPASS_WAYS,
} from "../rail/testing.ts"
import {
  endNode,
  laneOf,
  lanePoint,
  laneSide,
  nextTrafficEdge,
  roadOf,
  trafficIndex,
  walkIndex,
  walkSide,
} from "../route.ts"
import { animal, pedestrian, trafficCar } from "../spawning.ts"
import { footingAt } from "../systems/footing.ts"
import { flood, LOOK, start, teleport } from "../testing.ts"
import { waterUnder } from "../water/rivers.ts"

const S = 60,
  line = LINES[MONZONE.line]!
/** The rivers in a spate (125 m³/s at the Soliera gauge), m³/s per km², as water.test.ts has them. */
const SPATE = 0.6

/** `bodies` as plain data without their entity ids (and their leaders'), which a train spawned before them shifts. */
const anonymous = (bodies: ReadonlyArray<object>) =>
  bodies.map((body) =>
    Object.fromEntries(Object.entries(body).filter(([key]) => key !== "id" && key !== "leader")),
  )

/** Which side of the line's centreline a point lies on (±1) and how far off it is, m, by the line's nearest point. */
const sideOf = (p: { readonly x: number; readonly y: number }) => {
  const near = linesNear(p.x, p.y, 60).find((n) => n.line === line.index)!,
    at = pointAt(line, near.s)
  const off = (p.x - at.x) * -Ops.sin(at.angle) + (p.y - at.y) * Ops.cos(at.angle)
  return { side: Math.sign(off), distance: near.distance }
}

/** A cow standing (idle a long while) at `pose`, at home there. */
const cow = (pose: { readonly x: number; readonly y: number }, until = 1e6) =>
  Game.Command.extend(
    animal(randomAnimal("cow", Random.make(3)), { x: pose.x, y: pose.y, angle: 0 }),
    [Roam, { mood: "idle", until, hx: pose.x, hy: pose.y, tx: pose.x, ty: pose.y }],
  )

/** The point `off` m to the left (+) of the line's centreline at s. */
const beside = (s: number, off: number) => {
  const at = pointAt(line, s)
  return { x: at.x - Ops.sin(at.angle) * off, y: at.y + Ops.cos(at.angle) * off, angle: at.angle }
}

/**
 * The two rail bridges nearest the player's start over traffic roads at least 4 m under them, found by geometry (by Monzone: an
 * underpass, the road in a tunnel under the embankment, and Via delle Cave): each one's s, the road's edge and how far along it
 * the bridge is.
 */
const BRIDGES = (() => {
  const start = MAP.spawns.player,
    best = new Map<number, { s: number; edge: number; along: number; far: number }>()
  for (let s = 0; s < line.length; s += 1) {
    const at = pointAt(line, s)
    if (!at.bridge) continue
    const edge = trafficIndex.nearest(at.x, at.y),
      lane = laneOf(edge, true),
      along = (at.x - lane.x) * lane.dx + (at.y - lane.y) * lane.dy
    const under = lanePoint(lane, along, 0)
    if (along < 0 || along > lane.length || Ops.hypot(under.x - at.x, under.y - at.y) > 3) continue
    if (at.z - roadLevel(roadOf(edge), at.x, at.y) < 4) continue
    const far = Ops.hypot(at.x - start.x, at.y - start.y)
    if (far < (best.get(edge)?.far ?? Number.MAX_VALUE)) best.set(edge, { s, edge, along, far })
  }
  return [...best.values()].sort((a, b) => a.far - b.far).slice(0, 2)
})()

/** A car driving under `BRIDGE` and a walker on its verge there as a train crosses over, against the same with no train. */
const underBridge = (BRIDGE: (typeof BRIDGES)[number]) => {
  const lane = laneOf(BRIDGE.edge, true),
    side = laneSide({ edge: BRIDGE.edge, forward: true }, "panda"),
    verge = walkSide(roadOf(BRIDGE.edge))
  const car = trafficCar(
    "panda",
    0x8b8170,
    { ...lanePoint(lane, BRIDGE.along - 12, side), angle: Ops.atan2(lane.dy, lane.dx) },
    6,
    { edge: BRIDGE.edge, forward: true, side },
    nextTrafficEdge(endNode(BRIDGE.edge, true), BRIDGE.edge, "panda", Random.make(1)),
  )
  const walker = pedestrian(
    LOOK,
    { ...lanePoint(lane, BRIDGE.along - 3, -verge), angle: Ops.atan2(-lane.dy, -lane.dx) },
    { edge: BRIDGE.edge, forward: false, side: verge },
    { mood: "walk", until: 0, fx: 0, fy: 0 },
  )
  const over = pointAt(line, BRIDGE.s)
  const watch = { x: over.x + 40, y: over.y + 40, angle: 0 }
  // The train's front car over the road already, at line speed: its whole length crosses over them in the next 3 s.
  const s = BRIDGE.s + 10
  const scene = (trains: boolean) => {
    const game = start(
      [],
      [
        watch,
        {
          traffic: [car],
          peds: [walker],
          trains: trains ? [aiTrain(s, 1, speedAt(line, s))] : [],
        },
      ],
      { trains: true, alone: true },
    )
    const seen: Array<unknown> = []
    game.run(5 * S, () => {
      const { vehicles, peds } = game.world()
      seen.push([anonymous(vehicles), anonymous(peds)])
    })
    return { game, seen }
  }
  const crossed = scene(true),
    clear = scene(false)
  assert.deepEqual(crossed.seen, clear.seen, "the car and the walker as with no train")
  assert.deepEqual(crossed.game.heard.whistles, [], "no alarm")
  assert.ok(
    !crossed.game.heard.impacts.some((i) => i.hit === "train" || i.hit === "person"),
    "nothing struck",
  )
  assert.ok(crossed.game.world().trains[0]!.run!.state === "run", "and the driver saw nothing")
}

test("trains: under the rail bridges by Monzone a car and a walker go on as if no train crossed overhead", () => {
  assert.equal(BRIDGES.length, 2)
  for (const BRIDGE of BRIDGES) underBridge(BRIDGE)
})

/**
 * The point of the line on a bridge nearest the player's start with water 1.5 m deep or more under it in a spate, out of a
 * swimmer's depth (on the Aulella's bridge at Gragnola, 9 m over its bed), found by geometry: its s and where it is.
 */
const OVER_RIVER = (() => {
  const start = MAP.spawns.player
  let best: { s: number; x: number; y: number; far: number } | undefined
  for (let s = 0; s < line.length; s += 1) {
    const at = pointAt(line, s)
    if (!at.bridge) continue
    const water = waterUnder(at.x, at.y, true, SPATE)
    if (water === undefined || water.depth < 1.5) continue
    const far = Ops.hypot(at.x - start.x, at.y - start.y)
    if (far < (best?.far ?? Number.MAX_VALUE)) best = { s, x: at.x, y: at.y, far }
  }
  assert.ok(best !== undefined)
  return best
})()

test("trains: a swimmer swept under a rail bridge over the river in a spate is not on the track: a train crossing over leaves them as with no train", () => {
  const at = pointAt(line, OVER_RIVER.s)
  assert.ok(at.z - atGrade(at.x, at.y) > LEVEL, "the deck stands over the river's bed")
  const swimmer = pedestrian(
    LOOK,
    { x: OVER_RIVER.x, y: OVER_RIVER.y, angle: 0 },
    { edge: walkIndex.nearest(OVER_RIVER.x, OVER_RIVER.y), forward: true, side: 0 },
    { mood: "walk", until: 0, fx: 0, fy: 0 },
  )
  // The train's front car over the river already, at line speed: its whole length crosses over them in the next 3 s.
  const s = OVER_RIVER.s + 10
  const scene = (trains: boolean) => {
    const game = start(
      [],
      [
        { x: OVER_RIVER.x + 40, y: OVER_RIVER.y + 40, angle: 0 },
        { peds: [swimmer], trains: trains ? [aiTrain(s, 1, speedAt(line, s))] : [] },
      ],
      { trains: true, alone: true },
    )
    assert.ok(game.runtime.tick(flood(SPATE)).ok)
    const seen: Array<unknown> = []
    game.run(5 * S, () => seen.push(anonymous(game.world().peds)))
    return { game, seen }
  }
  const crossed = scene(true),
    clear = scene(false)
  assert.ok(
    clear.game.world().peds.every((p) => p.wet?.swimming === true),
    "swimming under the bridge",
  )
  assert.deepEqual(crossed.seen, clear.seen, "the swimmer as with no train")
  assert.deepEqual(crossed.game.heard.whistles, [], "no alarm")
  assert.ok(!crossed.game.heard.impacts.some((i) => i.hit === "person"), "nothing struck")
  assert.equal(crossed.game.world().trains[0]!.run!.state, "run", "and the driver saw nothing")
})

test("trains: someone on the track over a road tunnel is on the train's level: the player there is struck, and an AI driver holds for a man there", () => {
  const at = pointAt(line, OVER_ROAD)
  assert.ok(at.z - footZ(at.x, at.y) > 2, "the tunnel's floor lies under the track there")
  // The player on the track, a driverless train 25 m off at 30 m/s.
  const runaway = trainDraft("atr220", { line: line.index, s: OVER_ROAD - 25, facing: 1, v: 30 })
  const struck = start([], [{ x: at.x, y: at.y, angle: 0 }, { trains: [runaway] }], {
    trains: true,
    alone: true,
  })
  struck.run(2 * S)
  assert.ok(
    struck.heard.impacts.some((i) => i.hit === "person"),
    "the player is struck",
  )
  // A man standing there, an AI train 300 m back at line speed: held for him, the alarm sounding, and he is not struck.
  const edge = trafficIndex.nearest(at.x, at.y)
  const man = pedestrian(
    LOOK,
    { x: at.x, y: at.y, angle: 0 },
    { edge, forward: true, side: 0 },
    { mood: "look", until: 100 * S, fx: at.x + 20, fy: at.y },
  )
  const s = OVER_ROAD - 300
  const held = start(
    [],
    [
      { x: at.x + 30, y: at.y + 30, angle: 0 },
      { peds: [man], trains: [aiTrain(s, 1, speedAt(line, s))] },
    ],
    { trains: true, alone: true },
  )
  let stopped = false
  held.run(20 * S, () => {
    stopped ||= isHeld(held.world().trains[0]!.run!.state)
  })
  assert.ok(stopped, "the driver holds")
  assert.ok(
    held.heard.whistles.some((w) => w.urgent),
    "and sounds the alarm",
  )
})

test("trains: walking into a road underpass along the road, someone stays on its floor under the track, the bank the terrain smears over its mouths no matter: the player there is not struck by a train passing over", () => {
  assert.ok(UNDERPASS_WAYS.length >= 4, `${UNDERPASS_WAYS.length} ways in`)
  for (const { road, walk, s } of UNDERPASS_WAYS) {
    let z = footingAt(undefined, walk[0]!.x, walk[0]!.y)
    for (const p of walk.slice(1)) z = footZ(p.x, p.y, z)
    const end = walk.at(-1)!
    assert.ok(
      Math.abs(z - roadLevel(road, end.x, end.y)) < 0.5 && !onLevel(z, pointAt(line, s).z),
      `${road.id} from ${walk[0]!.x.toFixed(0)}, ${walk[0]!.y.toFixed(0)}: ${z.toFixed(2)} under the track`,
    )
  }
  // The player walks in along the first tunnel's ways, stands under the track, and a driverless train passes over at 25 m/s.
  for (const { road, walk, s } of UNDERPASS_WAYS.filter(
    (way) => way.road === UNDERPASS_WAYS[0]!.road,
  )) {
    const game = start([], [{ ...walk[0]!, angle: 0 }, {}], { trains: true, alone: true })
    for (const p of walk) {
      assert.ok(game.runtime.tick(Game.Schedule(teleport({ ...p, angle: 0 }))).ok)
      game.run(1)
    }
    assert.ok(
      game.runtime.tick(
        placeTrains([trainDraft("atr220", { line: line.index, s: s - 60, facing: 1, v: 25 })]),
      ).ok,
    )
    game.run(6 * S)
    assert.equal(
      game.view()!.mode,
      "foot",
      `${road.id} from ${walk[0]!.x.toFixed(0)}, ${walk[0]!.y.toFixed(0)}`,
    )
    assert.ok(!game.heard.impacts.some((i) => i.hit === "person"), "nobody struck")
  }
})

// Regression: nothing tested that a footing follows its body, so one frozen at its first value passed every test, and someone
// who walked down a road onto a crossing kept the level they came from: a train passed through them.
test("trains: walking down a road onto a level crossing, someone comes onto the rail's level, and a train passing over strikes them", () => {
  const { way, s } = DOWN_TO_BOX,
    fall = footingAt(undefined, way[0]!.x, way[0]!.y) - pointAt(line, s).z
  assert.ok(fall > 2 * LEVEL, `the road ${fall.toFixed(1)} m over the rail 50 m out`)
  const game = start([], [{ ...way[0]!, angle: 0 }, {}], { trains: true, alone: true })
  for (const p of way) {
    assert.ok(game.runtime.tick(Game.Schedule(teleport({ ...p, angle: 0 }))).ok)
    game.run(1)
  }
  assert.ok(
    game.runtime.tick(
      placeTrains([trainDraft("atr220", { line: line.index, s: s - 60, facing: 1, v: 20 })]),
    ).ok,
  )
  game.run(6 * S)
  assert.ok(
    game.heard.impacts.some((i) => i.hit === "person"),
    "the train strikes them on its track",
  )
})

// Regression: animals were brought out with no regard to the railway, so an AI train braked hard and sounded its alarm for a cow
// that had come out on its track.
test("trains: animals brought out anywhere along the line come out off its track at grade, 3 m or more off any centreline", () => {
  const on: Array<string> = []
  let brought = 0
  for (let s = 250; s < line.length; s += 250)
    for (const off of [45, -45]) {
      if (pointAt(line, s).tunnel) continue
      const game = start([], [{ ...beside(s, off), angle: 0 }, {}])
      const seen = new Set<number>()
      game.run(S, () => {
        for (const a of game.world().animals) {
          if (seen.has(a.id)) continue
          seen.add(a.id)
          for (const near of linesNear(a.x, a.y, 3)) {
            const at = pointAt(LINES[near.line]!, near.s)
            if (!at.bridge && !at.tunnel)
              on.push(`a ${a.species} ${near.distance.toFixed(2)} m off s ${near.s.toFixed(0)}`)
          }
        }
      })
      brought += seen.size
    }
  assert.ok(brought > 200, `${brought} brought out`)
  assert.deepEqual(on, [])
})

test("trains: a cow over the tunnel does not hear a train go by beneath it; one beside the track at grade runs from its body, and from its whistle", () => {
  const tunnel = line.tunnels.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a)),
    mid = (tunnel.from + tunnel.to) / 2,
    above = beside(mid, 0)
  assert.ok(footZ(above.x, above.y) - pointAt(line, mid).z > LEVEL, "fields far over the rail")
  // Beside the track at grade on pasture both sides, 6 m off the centreline: its body passes 4.6 m away.
  // (Away from the tunnels' mouths, where the train whistles.)
  const portals = line.tunnels.flatMap((t) => [t.from, t.to])
  const grass = (() => {
    for (let s = 0; s < line.length; s += 25) {
      const at = pointAt(line, s)
      if (at.bridge || at.tunnel || portals.some((p) => Math.abs(p - s) < 300)) continue
      if ([-6, 6].every((d) => grazing(beside(s, d).x, beside(s, d).y))) return s
    }
    return -1
  })()
  assert.ok(grass >= 0)
  const run = (at: number, off: number) => {
    const spot = beside(at, off)
    const game = start(
      [],
      [{ x: spot.x + 50, y: spot.y + 50, angle: 0 }, { animals: [cow(spot)] }],
      { trains: true, alone: true },
    )
    const s = at - 80
    assert.ok(game.runtime.tick(placeTrains([aiTrain(s, 1, speedAt(line, s))])).ok)
    let fled = false,
      held = false
    game.run(8 * S, () => {
      const world = game.world()
      fled ||= world.animals[0]!.mood === "flee"
      held ||= isHeld(world.trains[0]!.run!.state)
    })
    return { fled, held, whistles: game.heard.whistles.filter((w) => w.urgent).length }
  }
  assert.deepEqual(run(mid, 0), { fled: false, held: false, whistles: 0 }, "over the tunnel")
  assert.equal(run(grass, 6).fled, true, "beside the track")
  // A whistle 35 m off (a cow's whistle range is 40 m) sends one standing far from any track running.
  const far = beside(grass, 60)
  const game = start([], [{ x: far.x + 50, y: far.y, angle: 0 }, { animals: [cow(far)] }], {
    alone: true,
  })
  game.runtime.send(Whistle, { train: 0, x: far.x + 35, y: far.y, urgent: false })
  game.run(1)
  assert.equal(game.world().animals[0]!.mood, "flee", "the whistle")
})

test("trains: an animal never walks onto the track or over it: a cow at home 6 m from it grazes on its side for 3 minutes", () => {
  // At grade on pasture, home 6 m off the centreline: half its 35 m home range lies over the track.
  const s = (() => {
    for (let at = 0; at < line.length; at += 25) {
      const p = pointAt(line, at)
      if (p.bridge || p.tunnel) continue
      if ([-20, -6, 6, 20].every((d) => grazing(beside(at, d).x, beside(at, d).y))) return at
    }
    return -1
  })()
  const home = beside(s, 6)
  const game = start(
    [],
    [{ x: home.x + 60, y: home.y + 60, angle: 0 }, { animals: [cow(home, 0)] }],
    { alone: true },
  )
  let nearest = Number.MAX_VALUE,
    walked = 0
  const was = sideOf(home).side
  game.run(180 * S, () => {
    const beast = game.world().animals[0]!,
      { side, distance } = sideOf(beast)
    assert.equal(side, was, "on its side")
    nearest = Math.min(nearest, distance)
    if (beast.mood === "walk") walked++
  })
  assert.ok(walked > 0, "it walked about")
  assert.ok(nearest > 3 - FAUNA.cow.radius, `kept ${nearest.toFixed(2)} m off the centreline`)
})

test("trains: with a train far off, traffic, people, animals and the world's draws are the same as with none", () => {
  // The train in the Ugliancaldo tunnel, kilometres from the player at Monzone.
  const tunnel = line.tunnels.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a)),
    s = (tunnel.from + tunnel.to) / 2
  const withTrain = start([], undefined, { trains: true })
  assert.ok(withTrain.runtime.tick(placeTrains([aiTrain(s, 1, speedAt(line, s))])).ok)
  const without = start()
  withTrain.run(20 * S)
  without.run(20 * S)
  const a = withTrain.world(),
    b = without.world()
  assert.ok(a.vehicles.some((v) => v.traffic) && a.peds.length > 0 && a.trains.length === 1)
  // Each train spawned shifts the ids of everything spawned after it; nothing else differs.
  assert.deepEqual(anonymous(a.vehicles), anonymous(b.vehicles))
  assert.deepEqual(anonymous(a.peds), anonymous(b.peds))
  assert.deepEqual(anonymous(a.animals), anonymous(b.animals))
  assert.equal(a.rng, b.rng)
})
