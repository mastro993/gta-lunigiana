import assert from "node:assert/strict"
import { test } from "node:test"

import type { BuildingF, RoadF } from "../features.ts"
import { clearance, parkedSpots } from "../spawns.ts"

// A street along y 0 (5 m wide, so the right kerb's spots stand at y −3.5) with 80 houses north of
// it, and a track along y = `track` south of it.
const street: RoadF = {
  id: 1,
  cls: "residential",
  w: 5,
  surface: "asphalt",
  private: false,
  pts: [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
  ],
}
const houses: Array<BuildingF> = Array.from({ length: 80 }, (_, i) => {
  const x = 5 * i,
    y = 15
  return {
    id: i,
    kind: "house",
    h: 6,
    style: "plaster",
    tint: 0,
    outer: [x, y, x + 4, y, x + 4, y + 4, x, y + 4],
  }
})
const open = clearance([], [])
const spots = (
  rail: ReadonlyArray<{ readonly pts: ReadonlyArray<number>; readonly running: boolean }>,
  crossings: ReadonlyArray<readonly [number, number]> = [],
) =>
  parkedSpots({
    roads: [street],
    buildings: houses,
    areas: [],
    junctions: [],
    walk: open,
    drive: open,
    avoid: { x: -100, y: -100 },
    station: { x: -1000, y: -1000 },
    police: { x: 200, y: -3.5 },
    rail,
    crossings,
  })

// Regression: the rule measured the car's centre, so a car 2.87 m from Gragnola's
// through track had its side 2.02 m from it.
test("parkedSpots keeps a car's box 2.8 m from running track, 1.94 m from a siding, and 20 m from a level crossing", () => {
  assert.equal(spots([]).length, 10, "80 houses: one spot per 8")
  // The car's side is at y −4.35: a track at y −6.5 passes 2.15 m from it.
  const beside = [0, -6.5, 400, -6.5]
  assert.equal(spots([{ pts: beside, running: true }]).length, 0)
  assert.equal(spots([{ pts: beside, running: false }]).length, 10)
  assert.equal(spots([{ pts: [0, -7.2, 400, -7.2], running: true }]).length, 10)
  // A level crossing at x 200: no spot within 20 m of it.
  const near = spots([], [[200, 0]])
  assert.ok(near.length > 0 && near.every((p) => Math.abs(p.x - 200) >= 20))
})
