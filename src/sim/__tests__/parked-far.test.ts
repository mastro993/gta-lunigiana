// The parked cars round the player do not grow with the map (issue #7): Lunigiana with three times
// its parked spots, its own and two copies of them 30 and 60 km east, appended so that no spot's
// index (and so no spot's dice, `carOn`) moves.
import assert from "node:assert/strict"
import { test } from "node:test"

import { editMap } from "../map/__tests__/edit-map.ts"

let own = 0
editMap((json) => {
  const spots = json.spawns.parked
  own = spots.length
  const far = (dx: number) => spots.map((s) => ({ ...s, x: s.x + dx }))
  return { ...json, spawns: { ...json.spawns, parked: [...spots, ...far(30_000), ...far(60_000)] } }
})
const { MAP } = await import("../map/index.ts")
const { carOn, PARKED, PARKING, spotsWithin } = await import("../population/parked.ts")
const { TRAFFIC } = await import("../systems/populate.ts")
const { start } = await import("../testing.ts")

test("with three times the parked spots, those far from the player, the cars round the start are the dice's on its own spots", () => {
  assert.equal(MAP.spawns.parked.length, 3 * own)
  for (const seed of [1, 2]) {
    const game = start([], undefined, { seed })
    game.run(600)
    const { vehicles } = game.world()
    const parked = vehicles.flatMap((v) => (v.parked === undefined ? [] : [v.parked]))
    const dice = spotsWithin(MAP.spawns.player, PARKING.fill[1]).filter(
      (i) => carOn(seed, i) !== undefined,
    )
    assert.ok(dice.length > 0 && dice.every((i) => i < own), `seed ${seed}: ${dice.join(",")}`)
    assert.deepEqual(
      parked.sort((a, b) => a - b),
      dice.sort((a, b) => a - b),
    )
    assert.ok(vehicles.length - vehicles.filter((v) => v.traffic).length <= PARKED)
    assert.ok(vehicles.filter((v) => v.traffic).length <= TRAFFIC.max)
  }
})
