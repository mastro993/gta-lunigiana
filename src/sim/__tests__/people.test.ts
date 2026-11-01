import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { ringBox } from "../../tools/geometry.ts"
import { pointInRing } from "../collide.ts"
import { type Look } from "../index.ts"
import { buildingsIn, graph, MAP } from "../map/index.ts"
import { EDGE_REACH } from "../population/density.ts"
import {
  alongLane,
  facesForward,
  laneOf,
  lanePoint,
  laneSide,
  roadOf,
  walkIndex,
  walkSide,
} from "../route.ts"
import { animal, parkedCar, pedestrian } from "../spawning.ts"
import { deathChance, halfOf } from "../systems/contacts.ts"
import { paceOf } from "../systems/pedestrians.ts"
import { PEDESTRIANS } from "../systems/populate.ts"
import {
  BATTISTI,
  door,
  LOOK,
  ON_BATTISTI,
  press,
  rolling,
  start,
  straightOn,
  type Timeline,
} from "../testing.ts"
import { KNOCK_SPEED } from "../tuning.ts"
import { VEHICLES } from "../vehicles.ts"

const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
const HEADING = Ops.atan2(lane.dy, lane.dx)
const VERGE = walkSide(roadOf(BATTISTI.edge))
const LANE = laneSide(BATTISTI, "panda")
/** A pose `at` m along the BATTISTI lane, `side` m right of its centreline, heading along it (or back, when `back`). */
const spot = (at: number, side: number, back = false) => ({
  ...lanePoint(lane, at, side),
  angle: HEADING + (back ? Math.PI : 0),
})
/** The player out of the way: 100 m east of the street. */
const away = { x: lanePoint(lane, 20, 0).x + 100, y: lanePoint(lane, 20, 0).y, angle: 0 }
const KID: Look = { ...LOOK, age: "kid", height: 1.1, outfit: "shorts" }

test("knockdown: a fast car knocks a pedestrian down or kills them (one person Impact), and scores for the player", () => {
  // The pedestrian walks away from the car down its lane line, 25 m ahead on the next edge: it hears the car too late to get away.
  const next = straightOn(BATTISTI)
  const side = laneSide(next, "panda")
  const at = { ...lanePoint(laneOf(next.edge, next.forward), 5, side), angle: ON_BATTISTI.angle }
  const walker = pedestrian(LOOK, at, { ...next, side }, { mood: "walk", until: 0, fx: 0, fy: 0 })
  const timeline: Timeline = [
    ...press(0, "action"),
    { frame: 2, press: ["up"] },
    { frame: 300, release: ["up"] },
  ]
  const { run, world, heard } = start(timeline, [
    door(ON_BATTISTI),
    { cars: [parkedCar("panda", 0xb8312b, ON_BATTISTI)], peds: [walker] },
  ])
  const {
    vehicles: [car],
    peds: [person],
  } = world()
  let knockedAt = -1
  run(300, (frame) => {
    // Regression: this read `.down` alone, so it passed only while the seed's death roll (about 1 in 5 at this speed) spared them.
    const now = world().peds[0]!
    if (knockedAt < 0 && (now.down || now.dead !== undefined)) knockedAt = frame
  })
  assert.ok(knockedAt > 0, "knocked down")
  assert.equal(world().score.knocked, 1)
  const hits = heard.impacts.filter((i) => i.hit === "person")
  assert.deepEqual(
    hits.map((i) => [i.car, i.other, i.mass, i.fatal]),
    [[car!.id, person!.id, VEHICLES.panda.mass / 1000, world().peds[0]!.dead !== undefined]],
  )
  assert.ok(hits[0]!.speed > KNOCK_SPEED, `hit at ${hits[0]!.speed} m/s`)
})

test("knockdown: a pedestrian hit too slowly to die lies down 2.5 s, then gets up and runs", () => {
  // Standing in the lane 4 m ahead of a car coasting at 4.5 m/s, which reaches them before they can step out of its way.
  const walker = pedestrian(
    LOOK,
    spot(4, LANE, true),
    { ...BATTISTI, forward: !BATTISTI.forward, side: -VERGE },
    { mood: "chat", until: 100_000, fx: 0, fy: 0 },
  )
  const { run, world, heard } = start(
    [],
    [away, { cars: [rolling("panda", spot(0, LANE), 4.5, 0)], peds: [walker] }],
    { alone: true },
  )
  let downAt = -1,
    upAt = -1
  run(300, (frame) => {
    const now = world().peds[0]!
    if (downAt < 0 && now.down) downAt = frame
    if (downAt >= 0 && upAt < 0 && !now.down) upAt = frame
  })
  const hit = heard.impacts.find((i) => i.hit === "person")
  assert.ok(
    hit !== undefined && hit.speed > KNOCK_SPEED && deathChance(hit.speed, halfOf("adult")) === 0,
    `hit at ${hit?.speed} m/s`,
  )
  assert.ok(downAt >= 0, "knocked down")
  assert.ok(Math.abs((upAt - downAt) / 60 - 2.5) < 0.05, `down from frame ${downAt} to ${upAt}`)
  const [ped] = world().peds
  assert.equal(ped!.dead, undefined)
  assert.equal(ped!.mood, "flee")
})

/**
 * At Vinca, a verge that skirts a house corner on its right, found by geometry: the walk edge nearest (2233.8, -2553.8), walked
 * south-west, from 4 m before that point. Whoever walks on the leader's right meets the corner, and the leader walks on round it.
 */
const CORNER = (() => {
  const from = { x: 2233.8, y: -2553.8 }
  const edge = walkIndex.nearest(from.x, from.y),
    forward = facesForward(edge, -2.82),
    lane = laneOf(edge, forward)
  const route = { edge, forward, side: walkSide(roadOf(edge)) }
  return {
    route,
    pose: {
      ...lanePoint(lane, alongLane(lane, from.x, from.y) - 4, route.side),
      angle: Ops.atan2(lane.dy, lane.dx),
    },
  }
})()

// Regression: a follower made straight for its place, or for the leader beyond 3 m, so a wall between them pinned it while the
// leader walked on 20 m and more.
test("parties: a kid and a dog on the right of a grown-up walking round a house corner keep up with them", () => {
  const { route, pose } = CORNER
  const place = (side: number, back: number) => ({
    x: pose.x + side * Ops.sin(pose.angle) - back * Ops.cos(pose.angle),
    y: pose.y - side * Ops.cos(pose.angle) - back * Ops.sin(pose.angle),
    angle: pose.angle,
  })
  const walking = { mood: "walk", until: 1_000_000, fx: 0, fy: 0 } as const
  const { run, world } = start(
    [],
    [
      { x: 2273, y: -2620, angle: 0 },
      {
        parties: [
          {
            leader: pedestrian(LOOK, pose, route, walking),
            people: [
              { draft: pedestrian(KID, place(0.5, 0.4), route, walking), side: 0.5, back: 0.4 },
            ],
            animals: [
              {
                draft: animal(
                  { species: "dog", coat: 0x5a3a22, patch: 0x5a3a22, size: 1 },
                  place(0.5, 0.9),
                ),
                side: 0.5,
                back: 0.9,
              },
            ],
          },
        ],
      },
    ],
    { alone: true },
  )
  const leaderId = world().peds.find((p) => p.leader === undefined)!.id
  let kid = 0,
    dog = 0
  run(60 * 30, () => {
    const { peds, animals } = world()
    const leader = peds.find((p) => p.id === leaderId)!
    kid = Math.max(
      kid,
      Vec2.distance(
        peds.find((p) => p.id !== leaderId)!,
        leader,
      ),
    )
    dog = Math.max(dog, Vec2.distance(animals[0]!, leader))
  })
  assert.ok(
    Vec2.distance(
      world().peds.find((p) => p.id === leaderId)!,
      pose,
    ) > 20,
    "the grown-up walked on",
  )
  assert.ok(kid < 3, `the kid fell ${kid.toFixed(1)} m behind`)
  assert.ok(dog < 3, `the dog fell ${dog.toFixed(1)} m behind`)
})

// Regression: a fleeing leader ran at its own pace, so a tall father left a small kid 8 m behind.
test("parties: a grown-up running from danger runs at the pace of the kid it has with it", () => {
  for (const look of [
    { ...LOOK, height: 1.85 },
    { ...LOOK, female: true, height: 1.63 },
  ]) {
    const threat = lanePoint(lane, 40, 0)
    const back = { ...BATTISTI, forward: !BATTISTI.forward, side: -VERGE }
    const parent = pedestrian(look, spot(30, VERGE, true), back, {
      mood: "flee",
      until: 6 * 60,
      fx: threat.x,
      fy: threat.y,
    })
    const kid = pedestrian(KID, spot(30.4, VERGE - 0.5, true), back, {
      mood: "walk",
      until: 0,
      fx: 0,
      fy: 0,
    })
    const { run, world } = start(
      [],
      [away, { parties: [{ leader: parent, people: [{ draft: kid, side: 0.5, back: 0.4 }] }] }],
      { alone: true },
    )
    const [p, k] = [
      world().peds.find((q) => q.leader === undefined)!,
      world().peds.find((q) => q.leader !== undefined)!,
    ]
    let most = 0
    run(6 * 60, () => {
      const now = world().peds
      most = Math.max(
        most,
        Vec2.distance(
          now.find((q) => q.id === p.id)!,
          now.find((q) => q.id === k.id)!,
        ),
      )
    })
    const ran = Vec2.distance(
      world().peds.find((q) => q.id === p.id)!,
      p,
    )
    assert.ok(ran > 0.7 * paceOf(KID).run * 6, `${look.height} m: ran ${ran.toFixed(1)} m`)
    assert.ok(most < 2.5, `${look.height} m: the kid fell ${most.toFixed(1)} m behind`)
  }
})

// Regression: verges that run into houses spawned pedestrians inside them (stuck under the roof for good).
test("populate: pedestrians spawn in the villages, never inside a house, and none in the woods", () => {
  const indoors = (p: { readonly x: number; readonly y: number }) => {
    let inside = false
    buildingsIn(p.x, p.y, p.x, p.y, (i) => {
      const b = MAP.buildings[i]!
      inside ||=
        pointInRing(p.x, p.y, b.outer) && !(b.holes ?? []).some((h) => pointInRing(p.x, p.y, h))
    })
    return inside
  }
  // A walk node with walk edges in the spawn band but no building within EDGE_REACH of any of them: none has residents near.
  const lonely = (n: { readonly x: number; readonly y: number }) => {
    const reach = EDGE_REACH + PEDESTRIANS.spawn[1]
    let alone = true
    buildingsIn(n.x - reach, n.y - reach, n.x + reach, n.y + reach, (i) => {
      const [x0, y0, x1, y1] = ringBox(MAP.buildings[i]!.outer)
      alone &&= Ops.hypot(Math.max(x0 - n.x, 0, n.x - x1), Math.max(y0 - n.y, 0, n.y - y1)) > reach
    })
    return alone
  }
  const woods = graph.nodes.find(
    (n) => walkIndex.around(n.x, n.y, PEDESTRIANS.spawn).length > 0 && lonely(n),
  )!
  for (const [at, some] of [
    [{ x: -1751.2, y: 3360.4 }, true],
    [woods, false],
  ] as const) {
    // Gragnola's place node, then the woods
    // Staged there: the map cleared of the start's fill, so only what Populate brings counts.
    const { run, world } = start([], [{ ...at, angle: 0 }])
    const seen = new Set<number>()
    run(600, () => {
      for (const p of world().peds)
        if (!seen.has(p.id)) {
          seen.add(p.id)
          assert.ok(!indoors(p), `spawned inside a house at ${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        }
    })
    assert.ok(
      some ? seen.size >= 10 : seen.size === 0,
      `${seen.size} pedestrians around ${at.x},${at.y}`,
    )
  }
})
