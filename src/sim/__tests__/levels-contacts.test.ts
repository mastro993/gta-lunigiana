import assert from "node:assert/strict"
import { test } from "node:test"

import { Ops, Vec2 } from "@typeonce/ritmo-math"

import type { PoseValue } from "../index.ts"
import { LEVEL } from "../rail/bodies.ts"
import { animal, parkedCar, pedestrian } from "../spawning.ts"
import { LOOK, rolling, type stage, start } from "../testing.ts"
import { KNOCK_SPEED, PERSON_RADIUS } from "../tuning.ts"
import { VEHICLES } from "../vehicles.ts"
import {
  AWAY,
  BELOW,
  BENEATH,
  DECK_LANE,
  DECK_Z,
  OVER,
  overDeck,
  ROAD_Z,
  staged,
  standingOn,
  STEEP,
} from "./viaduct.ts"

/** The player standing right under the deck's lane at OVER, or over it on the deck. */
const HERE: PoseValue = { ...OVER, angle: 0 }

/** Someone standing at `at` looking 20 m east, on the way `route`, whose road gives their first footing. */
const standing = (at: PoseValue, route: typeof DECK_LANE) =>
  pedestrian(LOOK, at, route, { mood: "look", until: 100_000, fx: at.x + 20, fy: at.y })

/**
 * The Panda rolling over the deck (`overDeck`) for 4 s, the player at `at` on `z` and `cast` round them: its place and speed step
 * by step, how near it came to OVER, and the game.
 */
const rollOver = (
  at: PoseValue,
  z: number,
  cast: NonNullable<Parameters<typeof stage>[1]> = {},
) => {
  const game = staged(at, z, { ...cast, cars: [...(cast.cars ?? []), overDeck()] }, [])
  const id = game.world().vehicles.find((v) => Ops.hypot(v.vx, v.vy) > 5)!.id,
    way: Array<readonly [number, number, number]> = []
  let least = Infinity
  game.run(240, () => {
    const it = game.world().vehicles.find((v) => v.id === id)!
    least = Math.min(least, Vec2.distance(it, OVER))
    way.push([it.x, it.y, Ops.hypot(it.vx, it.vy)])
  })
  return { way, least, id, game }
}

// Regression (#86): a car on a bridge knocked down the player standing on the road under it, and hit a car parked there.
test("contacts: a Panda rolling along the SR445's viaduct passes over the player, a passer-by, a parked Panda and a dead dog on the road under it as over nobody, and strikes the player and a Panda standing in its way on the deck", () => {
  const clear = rollOver(AWAY.pose, AWAY.z)
  assert.ok(clear.least < 0.5, "it passes over OVER")
  assert.deepEqual(clear.game.heard.impacts, [])

  const below = { edge: BELOW, forward: true, side: 0 },
    parked = parkedCar("panda", 0xb8312b, BENEATH, standingOn("panda", BENEATH, ROAD_Z)),
    dog = animal({ species: "dog", coat: 0x1c1a19, patch: 0x1c1a19, size: 1 }, HERE)
  const player = rollOver(HERE, ROAD_Z),
    walker = rollOver(AWAY.pose, AWAY.z, { peds: [standing(HERE, below)] }),
    car = rollOver(AWAY.pose, AWAY.z, { cars: [parked] }),
    carcass = rollOver(AWAY.pose, AWAY.z, { carcasses: [dog] })
  for (const [what, under] of [
    ["the player", player],
    ["a passer-by", walker],
    ["a parked Panda", car],
    ["a dead dog", carcass],
  ] as const) {
    assert.deepEqual(under.way, clear.way, `${what} under the deck`)
    assert.deepEqual(under.game.heard.impacts, [], `${what} untouched`)
  }
  assert.deepEqual(player.game.view()?.pose, HERE, "the player stands where he stood")
  assert.equal(player.game.view()?.mode, "foot")
  assert.equal(walker.game.world().peds[0]!.down, false, "the passer-by on their feet")
  const still = car.game.world().vehicles.find((v) => v.id !== car.id)!
  assert.deepEqual([still.x, still.y], [BENEATH.x, BENEATH.y], "the parked Panda where it stood")
  const lying = carcass.game.world().animals[0]!
  assert.deepEqual([lying.x, lying.y], [HERE.x, HERE.y], "the dead dog where it lay")

  // On the deck the same Panda strikes them.
  const struck = rollOver(HERE, DECK_Z)
  const blow = struck.game.heard.impacts.find((i) => i.hit === "person")
  assert.ok(blow !== undefined && blow.speed > KNOCK_SPEED, "the player struck on the deck")
  const hit = rollOver(AWAY.pose, AWAY.z, {
    cars: [parkedCar("panda", 0xb8312b, OVER, standingOn("panda", OVER, DECK_Z))],
  }).game.heard.impacts.find((i) => i.hit === "car")
  assert.ok(
    hit !== undefined && hit.speed > 10,
    "a Panda standing on the deck hit at 10 m/s or more",
  )
})

test("contacts: the player under the SR445's viaduct and a passer-by standing over them on its deck do not step apart; on one level they do", () => {
  const walker = standing(HERE, DECK_LANE)
  const apart = staged(HERE, ROAD_Z, { peds: [walker] }, [])
  apart.run(60)
  assert.deepEqual(apart.view()?.pose, HERE, "the player not shoved")
  const above = apart.world().peds[0]!
  assert.deepEqual([above.x, above.y], [HERE.x, HERE.y], "the passer-by not shoved")

  const together = staged(HERE, DECK_Z, { peds: [walker] }, [])
  together.run(60)
  const pose = together.view()!.pose,
    other = together.world().peds[0]!
  assert.ok(
    Vec2.distance(pose, other) > 2 * PERSON_RADIUS - 0.01,
    `${Vec2.distance(pose, other).toFixed(2)} m apart on the deck`,
  )
})

// The level is read where they touch: bumper to bumper on a 30% lane, the ground under the two trucks' middles stands 2.5 m
// apart, and read there they ran 1.2 m into each other before they met (their middles 6.40 m apart).
test("contacts: on a 30% lane a truck rolling down into a truck standing below it hits it, though the ground under their middles stands more than 2 m apart", () => {
  const { length } = VEHICLES.truck,
    lower = STEEP.at(STEEP.lane.length - 0.5 - length / 2, "truck"),
    upper = STEEP.at(STEEP.lane.length - 0.5 - length / 2 - length - 0.5, "truck")
  assert.ok(
    STEEP.z(upper) - STEEP.z(lower) > LEVEL,
    `${(STEEP.z(upper) - STEEP.z(lower)).toFixed(2)} m between their middles' ground`,
  )
  const game = start(
    [],
    [
      { x: lower.x + 30, y: lower.y + 30, angle: 0 },
      { cars: [parkedCar("truck", 0xb8312b, lower), rolling("truck", upper, 2, 0)] },
    ],
    { alone: true },
  )
  let least = Infinity
  game.run(120, () => {
    const [a, b] = game.world().vehicles
    least = Math.min(least, Vec2.distance(a!, b!))
  })
  const hit = game.heard.impacts.find((i) => i.hit === "car")
  assert.ok(hit !== undefined && hit.speed > 2, "the truck below struck at 2 m/s or more")
  assert.ok(
    least > length - 0.1,
    `their middles ${least.toFixed(2)} m apart at the least: bumper to bumper`,
  )
})
