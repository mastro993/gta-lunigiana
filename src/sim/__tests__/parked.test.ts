import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { Damage, Game, Pose, type PoseValue, PrevPose, SetPlayer, Vehicle } from "../index.ts"
import { MAP } from "../map/index.ts"
import { CARABINIERI, carOn, PARKED, PARKING, pristine, spotsWithin } from "../population/parked.ts"
import { parkedCar } from "../spawning.ts"
import { TRAFFIC } from "../systems/populate.ts"
import { door, press, start } from "../testing.ts"
import { VIEW_REACH } from "../view.ts"

const START = MAP.spawns.player
const spotPose = (index: number): PoseValue => {
  const { x, y, angle } = MAP.spawns.parked[index]!
  return { x, y, angle }
}
/** The spot nearest the start that seed 1 parks a Panda on. */
const FIRST = spotsWithin(START, PARKING.fill[1])
  .filter((i) => carOn(1, i)?.model === "panda")
  .reduce((a, b) =>
    Vec2.distanceSquared(spotPose(b), START) < Vec2.distanceSquared(spotPose(a), START) ? b : a,
  )
/** The point `m` m from `to` toward `from`, facing `to`. */
const outFrom = (to: Vec2.Vec2, from: Vec2.Vec2, m: number): PoseValue => {
  const d = Math.max(Vec2.distance(to, from), 1e-9),
    ux = (from.x - to.x) / d,
    uy = (from.y - to.y) / d
  return { x: to.x + ux * m, y: to.y + uy * m, angle: Ops.atan2(-uy, -ux) }
}
/** The point `m` m along `pose`'s heading. */
const along = (pose: PoseValue, m: number): PoseValue => ({
  ...pose,
  x: pose.x + Ops.cos(pose.angle) * m,
  y: pose.y + Ops.sin(pose.angle) * m,
})
type Run = ReturnType<typeof start>
/** Sends the player (and the car they drive) to `at` and runs `frames` frames. */
const go = (game: Run, at: PoseValue, frames: number, each?: () => void) => {
  game.runtime.send(SetPlayer, at)
  game.run(frames, each)
}
/** A game on seed 1 whose player has got into the Panda parked at `FIRST`. */
const inFirst = () => {
  const game = start(press(10, "action"))
  go(game, door(spotPose(FIRST)), 20)
  assert.equal(game.view()?.mode, "driving")
  return game
}
/** The parked cars `game` holds within 300 m of `at`: each spot's model and paint. */
const looks = (game: Run, at: Vec2.Vec2) =>
  new Map(
    game
      .world()
      .vehicles.filter((v) => v.parked !== undefined && Vec2.distance(v, at) <= PARKING.fill[1])
      .map((v) => [v.parked!, `${v.model} ${v.color.toString(16)}`] as const)
      .sort(([a], [b]) => a - b),
  )
/** Damages vehicle `id` by `amount` or moves it to `pose` (`runtime.tick` it). */
const touch = (id: number, change: { readonly amount?: number; readonly pose?: PoseValue }) =>
  Game.Schedule(
    Game.System(
      "Test/Touch",
      {
        queries: {
          cars: Game.Query({
            selection: {
              pose: Game.Query.write(Pose),
              prev: Game.Query.write(PrevPose),
              damage: Game.Query.write(Damage),
            },
            with: [Vehicle],
          }),
        },
      },
      ({ queries }) => {
        for (const { entity, data } of queries.cars.each()) {
          if (entity.id !== id) continue
          const { amount, pose } = change
          if (amount !== undefined) data.damage.update((damage) => ({ ...damage, amount }))
          if (pose !== undefined) {
            data.pose.set(pose)
            data.prev.set(pose)
          }
        }
      },
    ),
  )

/** The villages a drive across the map nears, by their HUD districts. */
const VILLAGES = [
  "Monzone (Stazione)",
  "Monzone Alto",
  "Equi Terme",
  "Gragnola",
  "Colognola",
  "Campiglione",
  "Viano",
  "Vinca",
  "Ugliancaldo",
  "Tenerano",
]

test("parking: driving across the map, every village has traffic and parked cars once the player nears it, new ones come out of view, and the vehicles stay within 200 parked and 10 traffic", () => {
  const game = inFirst()
  const seen = new Set(game.world().vehicles.map((v) => v.id))
  const check = () => {
    const me = game.view()!.pose,
      { vehicles } = game.world()
    const traffic = vehicles.filter((v) => v.traffic).length
    assert.ok(traffic <= TRAFFIC.max, `${traffic} traffic cars`)
    assert.ok(vehicles.length - traffic <= PARKED, `${vehicles.length - traffic} parked`)
    for (const v of vehicles) {
      if (seen.has(v.id)) continue
      seen.add(v.id)
      assert.ok(
        Vec2.distance(v, me) >= VIEW_REACH,
        `a ${v.model} came ${Vec2.distance(v, me).toFixed(1)} m from the player`,
      )
    }
  }
  let from: Vec2.Vec2 = START
  for (const name of VILLAGES) {
    const village = MAP.districts.find((d) => d.name === name)!
    // From 400 m out, 50 m every half second, on the way from the last village.
    for (let m = 400; m >= 0; m -= 50) go(game, outFrom(village, from, m), 30, check)
    game.run(60, check)
    const { vehicles } = game.world()
    assert.ok(
      vehicles.some((v) => v.parked !== undefined && Vec2.distance(v, village) <= PARKING.fill[1]),
      `parked cars in ${name}`,
    )
    assert.ok(
      vehicles.some((v) => v.traffic && Vec2.distance(v, village) <= TRAFFIC.despawn),
      `traffic in ${name}`,
    )
    assert.ok(
      vehicles
        .filter((v) => v.parked !== undefined && pristine(v.parked, v, v.damage))
        .every((v) => Vec2.distance(v, village) <= PARKING.despawn),
      `in ${name}, every untouched parked car is within ${PARKING.despawn} m`,
    )
    from = village
  }
  const carabinieri = game.world().vehicles.filter((v) => v.model === "carabinieri")
  assert.deepEqual(
    carabinieri.map((v) => [v.x, v.y]),
    CARABINIERI.map((i) => [spotPose(i).x, spotPose(i).y]),
    "the Carabinieri stay at their station",
  )
})

test("parking: entering a parked car frees its spot, which fills again with the same car once out of view, never in view", () => {
  const game = inFirst()
  const stolen = game.world().vehicles.find((v) => v.stolen)!
  assert.equal(stolen.parked, undefined, "entered, it is no longer its spot's")
  const spot = spotPose(FIRST)
  const onSpot = () => game.world().vehicles.filter((v) => v.parked === FIRST)
  // Driven 40 m down the street, the spot in view stays empty.
  go(game, along(spot, 40), 120)
  assert.deepEqual(onSpot(), [], "in view it stays empty")
  go(game, along(spot, 150), 40)
  const back = onSpot()
  assert.equal(back.length, 1, "out of view it fills again")
  assert.deepEqual(
    [back[0]!.x, back[0]!.y, back[0]!.angle, back[0]!.model, back[0]!.color, back[0]!.stolen],
    [spot.x, spot.y, spot.angle, stolen.model, stolen.color, false],
    "with the same car, on its spot",
  )
})

test("parking: beyond 400 m the untouched parked cars go; a damaged one, a moved one and the Carabinieri stay, and their spots get no second car", () => {
  const game = start()
  game.run(1)
  const parked = game.world().vehicles.filter((v) => v.parked !== undefined)
  assert.ok(parked.length >= 3, `${parked.length} parked at the start`)
  const [hit, shoved] = parked as [(typeof parked)[0], (typeof parked)[0]]
  assert.ok(game.runtime.tick(touch(hit.id, { amount: 0.2 })).ok)
  assert.ok(game.runtime.tick(touch(shoved.id, { pose: along(shoved, 2) })).ok)
  go(game, { x: START.x + 800, y: START.y, angle: 0 }, 60)
  const there = game.world().vehicles.filter((v) => Vec2.distance(v, START) <= PARKING.fill[1])
  assert.deepEqual(
    there
      .filter((v) => v.parked !== undefined)
      .map((v) => v.id)
      .sort((a, b) => a - b),
    [hit.id, shoved.id].sort((a, b) => a - b),
    "only the damaged and the moved car stay",
  )
  assert.equal(there.filter((v) => v.model === "carabinieri").length, 2, "and the Carabinieri")
  go(game, { x: START.x + 150, y: START.y, angle: Math.PI }, 60)
  const back = game.world().vehicles
  for (const car of [hit, shoved])
    assert.equal(back.filter((v) => v.parked === car.parked).length, 1, `one car on ${car.parked}`)
})

test("parking: with more than 200 vehicles that are not traffic standing, no parked car comes, and traffic only up to 210 vehicles in all", () => {
  // 205 cars 2 km south of the start (frozen there), the player at the start: parked spots and traffic edges all round.
  const cars = Array.from({ length: PARKED + 5 }, (_, i) =>
    parkedCar("panda", 0x8b8170, {
      x: START.x + 6 * (i % 15),
      y: START.y - 2000 + 6 * Math.floor(i / 15),
      angle: 0,
    }),
  )
  const game = start([], [START, { cars }])
  game.run(120)
  const { vehicles } = game.world()
  assert.equal(vehicles.length, PARKED + TRAFFIC.max)
  assert.equal(vehicles.filter((v) => v.traffic).length, TRAFFIC.max - 5)
  assert.ok(vehicles.every((v) => v.parked === undefined))
})

test("parking: a spot holds the same car each time the player comes back in one game, and another seed parks others", () => {
  const game = start()
  game.run(1)
  const first = looks(game, START)
  assert.ok(first.size >= 3)
  const away = { x: START.x + 900, y: START.y, angle: 0 }
  go(game, away, 60)
  assert.equal(looks(game, START).size, 0, "gone once the player is far")
  for (let m = 450; m >= 0; m -= 50) go(game, outFrom(START, away, m), 30)
  assert.deepEqual(looks(game, START), first, "the same cars on the same spots")
  const other = start([], undefined, { seed: 2 })
  other.run(1)
  assert.notDeepEqual(looks(other, START), first)
})
