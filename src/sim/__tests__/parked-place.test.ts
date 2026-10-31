// A parked spot's car is its place's, not its index's (issue #7): Lunigiana with its parked spots
// listed twice, first all but the first, each one index down (a spot dropped before it), then all of
// them again, each `own` - 1 up (every other spot added before it), and without its Carabinieri
// station, whose two nearest spots (0 and 1 on the map) would claim one listing of a spot and not
// the other.
import assert from "node:assert/strict"
import { test } from "node:test"

import { editMap } from "../map/__tests__/edit-map.ts"

let own = 0
editMap((json) => {
  const spots = json.spawns.parked
  own = spots.length
  return {
    ...json,
    spawns: { ...json.spawns, parked: [...spots.slice(1), ...spots], police: undefined },
  }
})
const { MAP } = await import("../map/index.ts")
const { carOn, PARKING, spotsWithin } = await import("../population/parked.ts")

test("a parked spot round the start holds the same car on seeds 1–6 whatever its index, with a spot dropped or every spot added before it", () => {
  const spots = MAP.spawns.parked
  assert.equal(spots.length, 2 * own - 1)
  // The map's spot i (from 1) is listed at own - 1 + i and at i - 1: k and k - own.
  const twice = spotsWithin(MAP.spawns.player, PARKING.fill[1]).filter((k) => k >= own)
  assert.ok(twice.length > 0)
  for (const k of twice) assert.deepEqual(spots[k], spots[k - own])
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    for (const k of twice)
      assert.deepEqual(carOn(seed, k), carOn(seed, k - own), `seed ${seed}, spot ${k - own + 1}`)
    assert.ok(
      twice.some((k) => carOn(seed, k) !== undefined),
      `seed ${seed} parks a car round the start`,
    )
  }
})
