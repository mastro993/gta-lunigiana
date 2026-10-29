import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops } from "@typeonce/ritmo-math"

import { settle } from "../chassis.ts"
import { SetPlayer } from "../index.ts"
import { MAP } from "../map/index.ts"
import { tileKey } from "../map/kinds.ts"
import { readMapFile, tileUrl } from "../map/packed.ts"
import {
  dropTile,
  FROZEN_BEYOND,
  provideTile,
  setTileSource,
  STEP_REACH,
  tilesOver,
} from "../map/tiles.ts"
import { parkedCar } from "../spawning.ts"
import { inReach } from "../systems/reach.ts"
import { battistiTraffic, door, ON_BATTISTI, press, rolling, start, wear } from "../testing.ts"

const fromDisk = (key: string) => readMapFile(tileUrl(MAP.name, key))
const START = MAP.spawns.player
/** How far `p` is from the start along its farther axis, m. */
const off = (p: { readonly x: number; readonly y: number }) =>
  Math.max(Math.abs(p.x - START.x), Math.abs(p.y - START.y))
/** The parked spot farthest from the start, found by geometry so the test survives a map rebuild: its tiles lie off the start's. */
const FAR_SPOT = MAP.spawns.parked.reduce((a, b) => (off(b) > off(a) ? b : a))
const AWAY = { x: FAR_SPOT.x, y: FAR_SPOT.y, angle: FAR_SPOT.angle }
/** A point `m` metres along `pose`'s heading. */
const ahead = (pose: typeof AWAY, m: number) => ({
  ...pose,
  x: pose.x + Ops.cos(pose.angle) * m,
  y: pose.y + Ops.sin(pose.angle) * m,
})

test("reach: within FROZEN_BEYOND along both axes (Chebyshev), and everywhere with no player", () => {
  const p = { x: 100, y: -200 }
  assert.ok(inReach({ x: 100 + FROZEN_BEYOND, y: -200 - FROZEN_BEYOND }, p))
  assert.ok(!inReach({ x: 100 + FROZEN_BEYOND + 0.01, y: -200 }, p))
  assert.ok(!inReach({ x: 100, y: -200 - FROZEN_BEYOND - 0.01 }, p))
  assert.ok(inReach({ x: 1e6, y: 1e6 }, undefined))
})

test("freeze: cars past FROZEN_BEYOND keep their state bit for bit and read no tile, rolling and touching; within reach they move again", () => {
  assert.ok(off(AWAY) > 2 * STEP_REACH, `the far spot ${off(AWAY)} m out`)
  // Rolling on at 5 m/s with its throttle on, its tail in a parked car's nose: awake, it would drive off and the two be shoved apart.
  const game = start(
    [],
    [
      { ...START },
      { cars: [rolling("panda", AWAY, 5, 0.3), parkedCar("panda", 0x3d6155, ahead(AWAY, -3))] },
    ],
  )
  const cars = () => game.world().vehicles.filter((v) => off(v) > FROZEN_BEYOND)
  const before = cars()
  assert.equal(before.length, 2)
  // The host's residency: the start's square in memory, the far cars' tiles gone, and no source to fetch them from.
  const near = tilesOver(
    START.x - STEP_REACH,
    START.y - STEP_REACH,
    START.x + STEP_REACH,
    START.y + STEP_REACH,
  )
  const gone = tilesOver(AWAY.x - 50, AWAY.y - 50, AWAY.x + 50, AWAY.y + 50).filter(
    (key) => !near.includes(key),
  )
  assert.ok(gone.includes(tilesOver(AWAY.x, AWAY.y, AWAY.x, AWAY.y)[0]!), `${gone} hold the cars`)
  try {
    for (const key of near) provideTile(fromDisk(key))
    setTileSource(undefined)
    for (const key of gone) dropTile(key)
    game.run(120)
    assert.deepEqual(cars(), before)
  } finally {
    setTileSource(fromDisk)
  }
  // The player comes within reach: they roll on and the parked car is shoved.
  game.runtime.send(SetPlayer, { ...ahead(AWAY, -(FROZEN_BEYOND - 50)), angle: 0 })
  game.run(30)
  const now = (throttle: number) => {
    const { id } = before.find((v) => v.input.throttle === throttle)!
    return game.world().vehicles.find((v) => v.id === id)!
  }
  const rolled = now(0.3),
    shoved = now(0)
  assert.ok(Ops.hypot(rolled.x - AWAY.x, rolled.y - AWAY.y) > 1, "the rolling car moved on")
  assert.ok(
    Ops.hypot(shoved.x - ahead(AWAY, -3).x, shoved.y - ahead(AWAY, -3).y) > 0.1,
    "and shoved the parked one",
  )
})

// Review of #64: CrashDamage abandoned every destroyed traffic car, and its fleeing driver read the walls there, frozen or not.
test("a traffic wreck beyond reach is abandoned only once the player comes within reach: no tile read there before", () => {
  const game = start([], [{ ...START }, { traffic: [battistiTraffic(0xd4a85e, AWAY)] }])
  const wreck = () => game.world().vehicles.find((v) => off(v) > FROZEN_BEYOND)
  const near = tilesOver(
    START.x - STEP_REACH,
    START.y - STEP_REACH,
    START.x + STEP_REACH,
    START.y + STEP_REACH,
  )
  try {
    for (const key of near) provideTile(fromDisk(key))
    setTileSource(undefined)
    for (const { i, j } of MAP.tiles) if (!near.includes(tileKey(i, j))) dropTile(tileKey(i, j))
    assert.ok(game.runtime.tick(wear(1)).ok)
    game.run(10)
    assert.equal(wreck()?.traffic, true, "frozen, still traffic")
  } finally {
    setTileSource(fromDisk)
  }
  game.runtime.send(SetPlayer, { ...ahead(AWAY, -(FROZEN_BEYOND - 50)), angle: 0 })
  game.run(2)
  assert.equal(wreck()?.traffic, false, "abandoned")
  assert.ok(
    game.world().peds.some((p) => p.mood === "flee" && Ops.hypot(p.x - AWAY.x, p.y - AWAY.y) < 15),
  )
})

// Regression: people and animals went only at Populate's half-second sweep, so after a jump those left behind read the map
// where the host keeps it no longer: "map tile i_j not loaded".
test("a jump: the people and animals left beyond reach go at once, and nothing reads the map at the old place", () => {
  const game = start()
  game.run(1)
  const { peds, animals } = game.world()
  assert.ok(
    peds.length > 0 && animals.length > 0,
    `${peds.length} people, ${animals.length} animals`,
  )
  game.runtime.send(SetPlayer, AWAY)
  game.run(1)
  const kept = (p: { readonly x: number; readonly y: number }) => inReach(p, AWAY)
  assert.ok(game.world().peds.every(kept) && game.world().animals.every(kept))
  const there = tilesOver(
    AWAY.x - STEP_REACH,
    AWAY.y - STEP_REACH,
    AWAY.x + STEP_REACH,
    AWAY.y + STEP_REACH,
  )
  try {
    for (const key of there) provideTile(fromDisk(key))
    setTileSource(undefined)
    for (const { i, j } of MAP.tiles) if (!there.includes(tileKey(i, j))) dropTile(tileKey(i, j))
    game.run(60)
  } finally {
    setTileSource(fromDisk)
  }
})

test("SetPlayer: on foot the player stands still at the pose; driving, the car is settled there; off the map or not a number, it is dropped", () => {
  const to = ahead(ON_BATTISTI, 40)
  const foot = start([], [door(ON_BATTISTI)])
  foot.runtime.send(SetPlayer, to)
  foot.run(1)
  assert.deepEqual(
    [foot.view()!.prev, foot.view()!.pose, foot.view()!.velocity],
    [to, to, { x: 0, y: 0 }],
  )
  for (const bad of [
    // oxlint-disable-next-line ritmo/no-infinity-in-simulation-data -- a request the sim must drop, never saved
    { ...to, x: Number.NaN },
    // oxlint-disable-next-line ritmo/no-infinity-in-simulation-data -- a request the sim must drop, never saved
    { ...to, angle: Number.POSITIVE_INFINITY },
    { ...to, x: MAP.bounds.maxX + 1 },
  ]) {
    foot.runtime.send(SetPlayer, bad)
    foot.run(1)
    assert.deepEqual(foot.view()!.pose, to, JSON.stringify(bad))
  }

  const car = start(press(0, "action"), [
    door(ON_BATTISTI),
    { cars: [parkedCar("panda", 0xb8312b, ON_BATTISTI)] },
  ])
  car.run(1)
  assert.equal(car.view()?.mode, "driving")
  const far = { x: FAR_SPOT.x, y: FAR_SPOT.y, angle: FAR_SPOT.angle + 0.3 }
  car.runtime.send(SetPlayer, far)
  car.run(1)
  const moved = car.world().vehicles.find((v) => v.stolen)!
  assert.equal(car.view()?.mode, "driving")
  assert.deepEqual({ x: moved.x, y: moved.y, angle: moved.angle }, far)
  assert.deepEqual([moved.vx, moved.vy, moved.spin], [0, 0, 0])
  assert.deepEqual(moved.chassis, settle("panda", far))
  assert.deepEqual([car.view()!.prev, car.view()!.pose], [far, far])
})
