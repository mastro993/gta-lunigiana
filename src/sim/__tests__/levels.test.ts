import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Vec2 } from "@typeonce/ritmo-math"

import type { PoseValue } from "../index.ts"
import { footZ, roadLevel } from "../map/ground.ts"
import { graph, MAP } from "../map/index.ts"
import { tileKey, ONE_LEVEL } from "../map/kinds.ts"
import { setTileSource, tileFromDisk } from "../map/source.ts"
import { dropTile, provideTile, STEP_REACH, tilesOver } from "../map/tiles.ts"
import { linesNear, pointAt, speedAt } from "../rail/lines.ts"
import { aiTrain } from "../rail/testing.ts"
import { alongLane, edgeIndex, laneOf, lanePoint, laneSide } from "../route.ts"
import { animal, parkedCar, pedestrian, trafficCar } from "../spawning.ts"
import { BACK_GAP } from "../systems/traffic.ts"
import { door, LOOK, type stage, start } from "../testing.ts"
import { ENTER_GAP, PERSON_RADIUS } from "../tuning.ts"
import { VEHICLES } from "../vehicles.ts"
import { line } from "./railway.ts"
import {
  AWAY,
  BELOW,
  BENEATH,
  comingTo,
  DECK_LANE,
  DECK_Z,
  lanesThrough,
  OVER,
  PlayerFooting,
  ROAD_Z,
  roadById,
  onto,
  FROM_EAST,
  staged,
  standingOn,
  trafficPanda,
} from "./viaduct.ts"

// Regression (#84): standing under a bridge, the player stole a traffic car on the deck right over them.
test("enter: under the SR445's viaduct the player cannot take a car on the deck over them, and the HUD offers none", () => {
  const car = trafficCar("panda", 0xd4a85e, OVER, 0, DECK_LANE, { ...DECK_LANE, forward: false })
  const { run, runtime, view, world } = staged({ ...OVER, angle: 0 }, ROAD_Z, { traffic: [car] })
  const wheels = world().vehicles[0]!.chassis.z - VEHICLES.panda.cg
  assert.ok(Math.abs(wheels - DECK_Z) < 0.1, `the car on the deck, its wheels at ${wheels}`)
  assert.equal(view()?.nearby, undefined)
  run(10)
  assert.ok(Math.abs(runtime.inspect(PlayerFooting)! - ROAD_Z) < 0.1, "still on the road below")
  assert.equal(view()?.mode, "foot")
  assert.deepEqual(
    world().vehicles.map((v) => [v.traffic, v.stolen]),
    [[true, false]],
  )
  assert.equal(world().score.stolen, 0)
})

test("enter: on the viaduct's deck the player cannot take a car on the road under them, and takes one beside them on the deck", () => {
  assert.ok(Vec2.distance(BENEATH, OVER) < ENTER_GAP, "the car below within reach in plan")
  const under = staged(OVER, DECK_Z, {
    cars: [parkedCar("panda", 0xb8312b, BENEATH, standingOn("panda", BENEATH, ROAD_Z))],
  })
  assert.equal(under.view()?.nearby, undefined)
  under.run(10)
  assert.equal(under.view()?.mode, "foot")
  assert.equal(under.world().score.stolen, 0)

  const beside = door(OVER),
    on = staged(beside, footZ(beside.x, beside.y, DECK_Z), {
      cars: [parkedCar("panda", 0xb8312b, OVER, standingOn("panda", OVER, DECK_Z))],
    })
  assert.deepEqual(on.view()?.nearby, { label: "Fiat Panda", occupied: false, stolen: false })
  on.run(10)
  assert.equal(on.view()?.mode, "driving")
  assert.equal(on.world().score.stolen, 1)
})

/**
 * The traffic Panda `car` coming toward `mark` for 10 s, the player at `at` on `z` and `cast` round them: its place and speed step
 * by step, how near it came to `mark` in plan and its speed there, its speed at the end, and the game.
 */
const coming = (
  car: ReturnType<typeof trafficCar>,
  mark: { readonly x: number; readonly y: number },
  at: PoseValue,
  z: number,
  cast: Parameters<typeof stage>[1] = {},
) => {
  const game = staged(at, z, { ...cast, traffic: [car] }, [])
  const id = game.world().vehicles.find((v) => v.traffic)!.id,
    way: Array<readonly [number, number, number]> = []
  let least = Infinity,
    there = 0
  game.run(600, () => {
    const it = game.world().vehicles.find((v) => v.id === id)!,
      speed = Ops.hypot(it.vx, it.vy)
    if (Vec2.distance(it, mark) < least) [least, there] = [Vec2.distance(it, mark), speed]
    way.push([it.x, it.y, speed])
  })
  return { way, least, there, speed: way.at(-1)![2], game }
}

/** What the car of a `coming` run hit, where and how hard (the ids left out: the cast's spawn order sets them). */
const felt = (run: ReturnType<typeof coming>) =>
  run.game.heard.impacts.map((i) => [i.hit, i.x, i.y, i.speed] as const)

/** It stopped short of `mark` by a Panda's half-length, a person's radius and a metre more, and stands there, no one struck. */
const stoppedShort = (run: ReturnType<typeof coming>) => {
  assert.ok(
    run.least > VEHICLES.panda.length / 2 + PERSON_RADIUS + 1,
    `stopped ${run.least.toFixed(2)} m from them`,
  )
  assert.ok(run.speed < 0.1, `standing: ${run.speed.toFixed(2)} m/s`)
  assert.deepEqual(
    run.game.heard.impacts.filter((i) => i.hit === "person"),
    [],
  )
}

// Regression (#85): a car on a bridge stopped over the player standing on the road under it, and waited there.
test("traffic: a car on the SR445's viaduct comes over the player, a car and a dead dog on the road under it as over nobody, at 15 m/s, and stops for the player standing in its lane on the deck", () => {
  const car = () => comingTo(DECK_LANE.edge, 10),
    here = { ...OVER, angle: 0 }
  const clear = coming(car(), OVER, AWAY.pose, AWAY.z)
  assert.ok(clear.least < 0.5, "its lane passes over OVER")
  assert.ok(clear.there > 15, `at ${clear.there.toFixed(2)} m/s`)
  const dog = animal({ species: "dog", coat: 0x1c1a19, patch: 0x1c1a19, size: 1 }, BENEATH)
  for (const [what, under] of [
    ["the player", coming(car(), OVER, here, ROAD_Z)],
    [
      "a parked car",
      coming(car(), OVER, AWAY.pose, AWAY.z, {
        cars: [parkedCar("panda", 0xb8312b, BENEATH, standingOn("panda", BENEATH, ROAD_Z))],
      }),
    ],
    ["a dead dog", coming(car(), OVER, AWAY.pose, AWAY.z, { carcasses: [dog] })],
  ] as const) {
    assert.deepEqual(under.way, clear.way, `${what} under the deck`)
    assert.deepEqual(felt(under), felt(clear), `${what} untouched`)
  }
  stoppedShort(coming(car(), OVER, here, DECK_Z))
})

test("traffic: a car on the road under the viaduct passes under the player and a passer-by standing on the deck as under nobody, and stops for the player standing in its lane", () => {
  const car = () => comingTo(BELOW, 5),
    mark = BENEATH,
    here = { ...OVER, angle: 0 }
  // It passes under OVER, where the player and the passer-by stand, near enough to strike someone standing there on its level: its
  // centre within a Panda's half-width and a person's radius (1.18 m) of OVER, 0.57 m off it. Its line under the deck moves with
  // the walls and the ground built there (1.21 m off its lane's point BENEATH), so it is read against OVER itself.
  const clear = coming(car(), OVER, AWAY.pose, AWAY.z)
  assert.ok(
    clear.least < VEHICLES.panda.width / 2 + PERSON_RADIUS,
    `it passes ${clear.least.toFixed(2)} m from OVER`,
  )
  const walker = pedestrian(LOOK, here, DECK_LANE, {
    mood: "chat",
    until: 100_000,
    fx: here.x + 1,
    fy: here.y,
  })
  for (const [what, over] of [
    ["the player", coming(car(), mark, here, DECK_Z)],
    ["a passer-by", coming(car(), mark, AWAY.pose, AWAY.z, { peds: [walker] })],
  ] as const) {
    assert.deepEqual(over.way, clear.way, `${what} on the deck`)
    assert.deepEqual(felt(over), felt(clear), `${what} untouched`)
  }
  stoppedShort(coming(car(), mark, { ...mark, angle: 0 }, ROAD_Z))
})

// Backing up, a driver held for what stood behind it on any level: a car on the deck for the player on the road under it.
test("traffic: a car backing up on the SR445's viaduct backs over the player on the road under it as over nobody, and stops short of them standing behind it on the deck", () => {
  const lane = laneOf(DECK_LANE.edge, true),
    over = alongLane(lane, OVER.x, OVER.y),
    on = (d: number) => ({ ...lanePoint(lane, over + d, DECK_LANE.side), angle: OVER.angle }),
    [, after] = lanesThrough(DECK_LANE.edge, 0, 1) as [number, number]
  /** A traffic Panda 4 m past OVER behind a Panda parked 6.5 m ahead of it, the player at `at` on `z`: stuck 3 s, it backs up toward OVER. */
  const backing = (at: PoseValue, z: number) => {
    const game = staged(
      at,
      z,
      {
        traffic: [
          trafficPanda(
            on(4),
            0,
            { edge: DECK_LANE.edge, forward: true },
            { edge: after, forward: true },
          ),
        ],
        cars: [parkedCar("panda", 0xb8312b, on(10.5), standingOn("panda", on(10.5), DECK_Z))],
      },
      [],
    )
    const id = game.world().vehicles.find((v) => v.traffic)!.id,
      way: Array<readonly [number, number, number]> = []
    let least = Infinity
    game.run(330, () => {
      const it = game.world().vehicles.find((v) => v.id === id)!
      least = Math.min(least, Vec2.distance(it, OVER))
      way.push([it.x, it.y, Ops.hypot(it.vx, it.vy)])
    })
    return { way, least, game }
  }
  const clear = backing(AWAY.pose, AWAY.z),
    here = { ...OVER, angle: 0 }
  assert.ok(clear.least < 1.5, `backed to ${clear.least.toFixed(2)} m from OVER`)
  assert.deepEqual(backing(here, ROAD_Z).way, clear.way, "the player under the deck")
  const behind = backing(here, DECK_Z)
  assert.ok(
    behind.least > VEHICLES.panda.length / 2 + PERSON_RADIUS + BACK_GAP,
    `stopped ${behind.least.toFixed(2)} m from them`,
  )
  assert.deepEqual(
    behind.game.heard.impacts.filter((i) => i.hit === "person"),
    [],
  )
})

// Review of #98: backing up, a driver asked the level of every vehicle in the strip behind it, however far, reading the ground all
// the way there: in a browser, past the tiles in memory, "map tile i_j not loaded" stopped the game.
test("traffic: a car backing up on the SR445's viaduct reads no ground past the tiles round the player for a car parked a kilometre behind it", () => {
  const lane = laneOf(DECK_LANE.edge, true),
    over = alongLane(lane, OVER.x, OVER.y),
    on = (d: number) => ({ ...lanePoint(lane, over + d, DECK_LANE.side), angle: OVER.angle }),
    [, after] = lanesThrough(DECK_LANE.edge, 0, 1) as [number, number],
    far = {
      x: OVER.x - Ops.cos(OVER.angle) * 1000,
      y: OVER.y - Ops.sin(OVER.angle) * 1000,
      angle: OVER.angle,
    }
  const near = tilesOver(
    AWAY.pose.x - STEP_REACH,
    AWAY.pose.y - STEP_REACH,
    AWAY.pose.x + STEP_REACH,
    AWAY.pose.y + STEP_REACH,
  )
  const there = tilesOver(far.x, far.y, far.x, far.y)
  assert.ok(
    there.length === 1 && !near.includes(there[0]!),
    "the parked car stands on a tile of the map off the tiles round the player",
  )
  const game = staged(
    AWAY.pose,
    AWAY.z,
    {
      traffic: [
        trafficPanda(
          on(4),
          0,
          { edge: DECK_LANE.edge, forward: true },
          { edge: after, forward: true },
        ),
      ],
      cars: [
        parkedCar("panda", 0xb8312b, on(10.5), standingOn("panda", on(10.5), DECK_Z)),
        parkedCar("panda", 0x2b5fb8, far, standingOn("panda", far, DECK_Z)),
      ],
    },
    [],
  )
  const id = game.world().vehicles.find((v) => v.traffic)!.id
  let least = Infinity
  try {
    for (const key of near) provideTile(tileFromDisk(key))
    setTileSource(undefined)
    for (const { i, j } of MAP.tiles) if (!near.includes(tileKey(i, j))) dropTile(tileKey(i, j))
    game.run(330, () => {
      least = Math.min(
        least,
        Vec2.distance(
          game.world().vehicles.find((v) => v.id === id)!,
          OVER,
        ),
      )
    })
  } finally {
    setTileSource(tileFromDisk)
  }
  assert.ok(least < 1.5, `backed to ${least.toFixed(2)} m from OVER`)
})

/**
 * The SR445's dip 500 m east of the viaduct (OSM way 552592649): westward 15% down into it and 15% up out of it, eastward the
 * other way round. `at(d, west)`: d m along the lane past the dip's lowest point (before it, negative), going west or east, at a
 * Panda's side: where, heading along the lane, its step and the next. Found by the way's OSM id and its traffic edge nearest
 * (-2228, 4362), then the lowest point along its lanes, so the fixture survives a map rebuild.
 */
const DIP = (() => {
  const road = roadById(552592649),
    near = edgeIndex(graph.trafficEdges.filter((e) => graph.edges[e]!.road === road)).nearest(
      -2228,
      4362,
    ),
    chain = lanesThrough(near, 3, 3),
    starts = chain.map((_, k) =>
      chain.slice(0, k).reduce((sum, e) => sum + laneOf(e, true).length, 0),
    )
  /** Where the lanes are `s` m along the chain westward, travelled west or east, `side` m right of them; its step and the next. */
  const point = (s: number, west: boolean, side = 0) => {
    const k = starts.findLastIndex((start) => start <= s)
    assert.ok(k >= 1 && k + 1 < chain.length, `${s} m along the dip's lanes`)
    const lane = laneOf(chain[k]!, west),
      along = west ? s - starts[k]! : lane.length - (s - starts[k]!)
    return {
      ...lanePoint(lane, along, side),
      angle: Ops.atan2(lane.dy, lane.dx),
      step: { edge: chain[k]!, forward: west },
      next: { edge: chain[k + (west ? 1 : -1)]!, forward: west },
    }
  }
  const z = (s: number) => {
    const p = point(s, true)
    return roadLevel(graph.edges[p.step.edge]!.road, p.x, p.y)!
  }
  let low = starts[1]!
  for (let s = low; s < starts.at(-1)!; s += 0.5) if (z(s) < z(low)) low = s
  return {
    at: (d: number, west: boolean) => {
      const s = west ? low + d : low - d
      return point(s, west, laneSide(point(s, west).step, "panda"))
    },
  }
})()

// A driver reads its level where what is ahead stands. Read under its own middle, a car at the dip's foot ran into the Panda
// standing 40 m up the climb (at 0.83 m/s); carried along its pitch from there, a car 25 m down the descent ran into the one
// 15 m past the foot (at 5.68 m/s). Rolled there, it stops 6.7 m short of either.
test("traffic: through the SR445's dip a car at 16 m/s stops for a Panda standing in its lane 40 m ahead, from the dip's foot up the climb and from the descent across the dip", () => {
  const foot = DIP.at(0, true),
    player = {
      x: foot.x + Ops.sin(foot.angle) * 40,
      y: foot.y - Ops.cos(foot.angle) * 40,
      angle: 0,
    }
  for (const [label, from, west, off] of [
    ["from the foot", 0, false, (ground: number, _: number, there: number) => there - ground],
    [
      "from the descent",
      -25,
      true,
      (ground: number, carried: number, there: number) => there - ground - carried,
    ],
  ] as const) {
    const a = DIP.at(from, west),
      b = DIP.at(from + 40, west),
      level = (p: typeof a) => roadLevel(graph.edges[p.step.edge]!.road, p.x, p.y)!,
      mine = standingOn("panda", a, level(a)),
      its = standingOn("panda", b, level(b))
    const ahead = (b.x - a.x) * Ops.cos(a.angle) + (b.y - a.y) * Ops.sin(a.angle),
      gap = off(mine.z, ahead * Ops.tan(mine.pitch), its.z)
    assert.ok(Math.abs(gap) > ONE_LEVEL, `${label}: the Panda ahead ${gap.toFixed(2)} m off`)
    const game = start(
      [],
      [
        player,
        {
          traffic: [trafficPanda(a, 16, a.step, a.next)],
          cars: [parkedCar("panda", 0xb8312b, b, its)],
        },
      ],
      { alone: true },
    )
    const id = game.world().vehicles.find((v) => v.traffic)!.id,
      car = () => game.world().vehicles.find((v) => v.id === id)!
    let least = Infinity
    game.run(600, () => (least = Math.min(least, Vec2.distance(car(), b))))
    assert.deepEqual(
      game.heard.impacts.filter((i) => i.hit === "car"),
      [],
      label,
    )
    assert.ok(least > VEHICLES.panda.length + 1, `${label}: stopped ${least.toFixed(2)} m from it`)
  }
})

// Regression (review of #85): reading its way's level from the ground under its middle carried along its pitch, a car coming down
// through a sag onto a bridge took the ground under the deck for it, and ran into a Panda standing on the deck: at 9.5 m/s onto the
// SR445's viaduct, at 11.7 m/s onto OSM way 237828927, where before the levels it stopped 6.2–6.4 m short. Rolled along its way it
// keeps to the deck.
test("traffic: coming down through a sag onto a bridge, a car stops for a Panda standing in its lane on the deck", () => {
  const primary = onto(1362959047, 237828927)
  for (const [label, sag, from, speed, ahead] of [
    ["onto the SR445's viaduct from 30.5 m at 12 m/s", FROM_EAST, -18.5, 12, 12],
    ["onto the SR445's viaduct from 30.5 m at 15 m/s", FROM_EAST, -18.5, 15, 12],
    ["onto the SR445's viaduct from 25.5 m at 15 m/s", FROM_EAST, -13.5, 15, 12],
    ["onto OSM way 237828927, one 6.5 m onto it", primary, primary.from, 16, 6.5],
    ["onto OSM way 237828927, one 8 m onto it", primary, primary.from, 16, 8],
  ] as const) {
    const a = sag.at(from),
      b = sag.at(ahead)
    const game = start(
      [],
      [
        { x: a.x + 80, y: a.y + 80, angle: 0 },
        {
          traffic: [trafficPanda(a, speed, a.step, a.next)],
          cars: [parkedCar("panda", 0xb8312b, b, standingOn("panda", b, sag.z(b)))],
        },
      ],
      { alone: true },
    )
    const id = game.world().vehicles.find((v) => v.traffic)!.id,
      car = () => game.world().vehicles.find((v) => v.id === id)!
    let least = Infinity
    game.run(600, () => (least = Math.min(least, Vec2.distance(car(), b))))
    assert.deepEqual(
      game.heard.impacts.filter((i) => i.hit === "car"),
      [],
      label,
    )
    assert.ok(least > VEHICLES.panda.length + 1, `${label}: stopped ${least.toFixed(2)} m from it`)
  }
})

/**
 * The SR445's deck over Monzone's line east of the dip (OSM way 552592643, a bridge): its traffic edge whose middle lies nearest
 * the line, and the line's s nearest there, found by the way's OSM id and geometry.
 */
const OVERPASS = (() => {
  const road = roadById(552592643),
    [best] = graph.trafficEdges
      .filter((e) => graph.edges[e]!.road === road)
      .flatMap((edge) => {
        const lane = laneOf(edge, true),
          middle = lanePoint(lane, lane.length / 2, 0)
        return linesNear(middle.x, middle.y, lane.length / 2)
          .filter((near) => near.line === line.index)
          .map((near) => ({ edge, s: near.s, distance: near.distance }))
      })
      .sort((a, b) => a.distance - b.distance)
  assert.ok(best !== undefined, "the SR445's deck crosses the line")
  return best
})()

// Rolled to a train's middle, its level would be the ground beside the deck, not the deck: a car on the SR445's deck changed
// its way for a train passing under it at 16 of 26 timings (60 m before the deck to 60 m past it every 10 m, both ways).
test("traffic: a car on the SR445's deck over the railway goes on as if no train passed under it", () => {
  const under = pointAt(line, OVERPASS.s),
    deck = roadLevel(graph.edges[OVERPASS.edge]!.road, under.x, under.y)!,
    player = { x: under.x + 40, y: under.y + 40, angle: 0 }
  assert.ok(
    deck - under.z > 2 * ONE_LEVEL,
    `the deck ${(deck - under.z).toFixed(2)} m over the rail`,
  )
  /** The car's place and speed step by step over 6 s, coming at 16 m/s from two edges back, with `trains` round it. */
  const drive = (trains: ReadonlyArray<ReturnType<typeof aiTrain>>) => {
    const game = start([], [player, { traffic: [comingTo(OVERPASS.edge, 16)], trains }], {
      trains: true,
      alone: true,
    })
    const id = game.world().vehicles.find((v) => v.traffic)!.id,
      way: Array<readonly [number, number, number]> = []
    game.run(360, () => {
      const it = game.world().vehicles.find((v) => v.id === id)!
      way.push([it.x, it.y, Ops.hypot(it.vx, it.vy)])
    })
    return way
  }
  const clear = drive([])
  assert.ok(
    clear.some(([x, y]) => Ops.hypot(x - under.x, y - under.y) < 3),
    "it crosses over the line",
  )
  for (const [dir, off] of [
    [1, -25],
    [1, 0],
    [-1, 50],
    [-1, 75],
  ] as const)
    assert.deepEqual(
      drive([aiTrain(OVERPASS.s + off, dir, speedAt(line, OVERPASS.s + off))]),
      clear,
      `a train from ${off} m along the line, heading ${dir > 0 ? "up" : "down"} it`,
    )
})
