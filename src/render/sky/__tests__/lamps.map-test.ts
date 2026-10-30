import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../../sim/map/index.ts"
import { placeLamps, streetLamps } from "../lamps.ts"
import { assertLanternsWhole, assertOnLitStreets, assertOnWalls, litOf } from "./lamp-checks.ts"

// Map checks (pnpm test:map): every lamp of the map; lamps.test.ts checks those by Monzone.
const lamps = streetLamps()
/** The lanterns on house walls (the rest stand on platform poles). */
const walls = lamps.filter((lamp) => lamp.kind === "wall")

test("street lamps: the same every time, hundreds over the valley", () => {
  // The map file keeps each lantern's height in m a.s.l. (`bakeLamps`): back in render y it is the placed one within rounding.
  const placed = placeLamps()
  assert.equal(placed.length, walls.length)
  for (const [k, lamp] of placed.entries()) {
    const kept = walls[k]!
    // The file's JSON keeps −0 as 0, which `===` holds equal.
    for (const field of ["x", "y", "nx", "ny", "kind"] as const)
      assert.ok(lamp[field] === kept[field], `lamp ${k}: ${field}`)
    assert.ok(Math.abs(lamp.h - kept.h) < 1e-9, `lamp ${k}: ${lamp.h} placed, ${kept.h} kept`)
  }
  assert.ok(walls.length > 300 && walls.length < 1500, `${walls.length} lamps`)
})

test("street lamps: each hangs 0.6 m out from a house wall between its windows, 4.2 m or less over the street, under the eaves, outside every house, all over the map", () => {
  assertOnWalls(walls)
})

test("street lamps: on lit streets in villages, never two within 18 m, all over the map", () => {
  assertOnLitStreets(walls, litOf(MAP.roads))
})

// Regression: the lantern's body was only its glass, which is not drawn by day: a cap, a 0.36 m gap and a floating foot.
test("street lamps: a lantern is whole by day, solid from its foot to its cap on its axis, all of it inside the glass lit at night, all over the map", () => {
  assertLanternsWhole(lamps.keys())
})
