import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../../sim/map/index.ts"
import { groundY } from "../../ground.ts"
import { platformLamps } from "../../stations.ts"
import { lampPieces, lampsIn, streetLamps } from "../lamps.ts"
import {
  assertLanternsWhole,
  assertOnLitStreets,
  assertOnWalls,
  boxesOf,
  drawnLamp,
  litOf,
} from "./lamp-checks.ts"

// lamps.map-test.ts (pnpm test:map) checks every lamp of the map; these, the lamps within 600 m of the start, by Monzone
// station.
const lamps = streetLamps()
/** The lanterns on house walls (the rest stand on platform poles). */
const walls = lamps.filter((lamp) => lamp.kind === "wall")
const { x: SX, y: SY } = MAP.spawns.player,
  REACH = 600
const near = (p: { readonly x: number; readonly y: number }) =>
  Math.hypot(p.x - SX, p.y - SY) < REACH

test("street lamps: a dozen and more along Monzone's streets, then the platforms' pole lamps", () => {
  assert.deepEqual(lamps.slice(0, walls.length), walls, "the wall lanterns first")
  assert.equal(lamps.length - walls.length, platformLamps().length)
  const monzone = walls.filter((l) => Math.hypot(l.x - SX, l.y - SY) < 300).length
  assert.ok(monzone >= 12, `${monzone} lamps within 300 m of the station`)
})

test("street lamps: each by Monzone hangs 0.6 m out from a house wall between its windows, 4.2 m or less over the street, under the eaves, outside every house", () => {
  const here = walls.filter(near)
  assert.ok(here.length >= 20, `${here.length} lamps`)
  assertOnWalls(here)
})

test("street lamps by Monzone: on lit streets in villages, never two within 18 m", () => {
  // The roads that come within 50 m of the lamps' disc: the nearest lit carriageway of each is among them.
  const roads = MAP.roads.filter((r) =>
    r.pts.some((v, k) => k % 2 === 0 && Math.hypot(v - SX, r.pts[k + 1]! - SY) < REACH + 50 + r.w),
  )
  assertOnLitStreets(walls.filter(near), litOf(roads))
})

test("lampsIn: finds every lamp in a box (a superset the caller tests exactly)", () => {
  for (const [x0, y0, x1, y1] of [
    [SX - 150, SY - 150, SX + 150, SY + 150],
    [SX - 20, SY - 400, SX + 600, SY + 30],
    [1e5, 1e5, 1e5 + 1, 1e5 + 1],
  ] as const) {
    const found = new Set<number>()
    lampsIn(x0, y0, x1, y1, (i) => found.add(i))
    const inside = lamps.flatMap((l, i) =>
      l.x >= x0 && l.x <= x1 && l.y >= y0 && l.y <= y1 ? [i] : [],
    )
    for (const i of inside) assert.ok(found.has(i), `lamp ${i} found`)
  }
})

// Regression: the lantern's body was only its glass, which is not drawn by day: a cap, a 0.36 m gap and a floating foot.
test("street lamps: a lantern by Monzone is whole by day, solid from its foot to its cap on its axis, all of it inside the glass lit at night", () => {
  const here = lamps.flatMap((lamp, i) => (near(lamp) ? [i] : []))
  assert.ok(here.length >= 20, `${here.length} lamps`)
  assertLanternsWhole(here)
})

test("platform lamps: a pole from the platform's top to the bracket, the lantern 0.6 m out from it toward the track", () => {
  const pieces = lampPieces()
  const poles = lamps.flatMap((lamp, i) => (lamp.kind === "pole" ? [i] : []))
  assert.ok(poles.length > 0)
  for (const i of poles) {
    const lamp = lamps[i]!,
      sink = drawnLamp(pieces, i)
    // In the lamp's frame (u out to the lantern), the pole is the box on u = -0.6 standing from the ground to the bracket.
    const pole = boxesOf(sink.solid, lamp).find(
      (b) => b.u[0] < -0.6 && b.u[1] > -0.6 && b.u[1] < -0.5,
    )
    assert.ok(pole !== undefined, `lamp ${i}: a pole 0.6 m behind the lantern`)
    const foot = groundY(lamp.x - lamp.nx * 0.6, lamp.y - lamp.ny * 0.6)
    assert.ok(Math.abs(pole.y[0] - foot) < 1e-6, "standing on the ground (the platform's top)")
    assert.ok(pole.y[1] >= lamp.h + 0.3, "up to the bracket")
  }
})
