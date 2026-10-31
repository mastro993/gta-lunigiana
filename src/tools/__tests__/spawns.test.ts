import assert from "node:assert/strict"
import { test } from "node:test"

import type { Area, Poi, Spawn } from "../../sim/map/index.ts"
import type { BuildingF, RoadF } from "../features.ts"
import { clearance, parkedSpots, playerSpawn, regionPoi, startNear } from "../spawns.ts"
import { inWater } from "../water-areas.ts"

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
/** The street's input to `parkedSpots`: no rail, the station far off, the Carabinieri at its middle. */
const STREET = {
  roads: [street],
  buildings: houses,
  areas: [],
  junctions: [],
  walk: open,
  drive: open,
  avoid: { x: -100, y: -100 },
  station: { x: -1000, y: -1000 },
  police: { x: 200, y: -3.5 },
  rail: [],
  crossings: [],
}
const spots = (
  rail: ReadonlyArray<{ readonly pts: ReadonlyArray<number>; readonly running: boolean }>,
  crossings: ReadonlyArray<readonly [number, number]> = [],
) => parkedSpots({ ...STREET, rail, crossings })

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

// A car park south of the street, x 180…220 by y −40…−20.
const LOT: Area = { kind: "parking", rings: [[180, -40, 220, -40, 220, -20, 180, -20]] }

test("parkedSpots without the station and Carabinieri, which a test region may leave out of play, keeps the street's share and fills no car park", () => {
  const all = parkedSpots({ ...STREET, areas: [LOT], station: { x: 200, y: -30 } })
  const inLot = (p: { readonly y: number }) => p.y < -15
  assert.equal(all.filter((p) => !inLot(p)).length, 10)
  assert.equal(all.filter(inLot).length, 6, "the station's car park")
  // first the two nearest the Carabinieri (x 200), 9 m apart, then the rest in hash order
  assert.deepEqual(
    all.slice(0, 2).map((p) => p.x),
    [201, 210],
  )
  const none = parkedSpots({ ...STREET, areas: [LOT], station: undefined, police: undefined })
  assert.equal(none.length, 10, "80 houses: one spot per 8, none in the car park")
  assert.ok(!none.some(inLot))
  assert.deepEqual(none.slice(0, 8), all.slice(2, 10), "hash order, no pair kept first")
})

// A lake along the right kerb, x 100…300, its shore at y −4: past a kerb spot's centre (y −3.5)
// but inside its car's grown box (to y −4.65).
const KERB_LAKE: Area = { kind: "lake", level: 0, rings: [[100, -40, 300, -40, 300, -4, 100, -4]] }

/** Centre and corners of a parked car's box grown by the gap kept round it, as `parkedSpots` builds it. */
const grownBox = ({ x, y, angle }: Spawn) => {
  const l = 3.7 / 2 + 0.3,
    w = 1.7 / 2 + 0.3,
    c = Math.cos(angle),
    s = Math.sin(angle)
  const pts: Array<readonly [number, number]> = [[x, y]]
  for (const [u, v] of [
    [l, w],
    [l, -w],
    [-l, w],
    [-l, -w],
  ] as const)
    pts.push([x + c * u - s * v, y + s * u + c * v])
  return pts
}

test("parkedSpots parks no car with its box's centre or a corner of its grown box in a lake, and keeps the kerb's spots clear of it", () => {
  const wet = inWater([KERB_LAKE])
  const dry = spots([])
  assert.ok(
    dry.some((p) => grownBox(p).some(([x, y]) => wet(x, y))),
    "without the lake, cars park where it lies",
  )
  const kept = parkedSpots({ ...STREET, areas: [KERB_LAKE] })
  assert.equal(kept.length, 10, "80 houses: one spot per 8, all beyond the lake")
  for (const p of kept)
    assert.ok(
      grownBox(p).every(([x, y]) => !wet(x, y)),
      `the car at (${p.x}, ${p.y}) stands in the lake`,
    )
})

// A 100 m street along y 0 (5 m wide, so its sidewalk spots stand at y ±3.5), the player sought
// north of its middle.
const LANE: RoadF = { ...street, id: 2, pts: [street.pts[0]!, { x: 100, y: 0 }] }
const TARGET = { x: 50, y: 10 }
const pond = (x0: number, y0: number, x1: number, y1: number): Area => ({
  kind: "lake",
  level: 0,
  rings: [[x0, y0, x1, y0, x1, y1, x0, y1]],
})
const spawnBeside = (areas: ReadonlyArray<Area>) =>
  playerSpawn([LANE], open, open, TARGET, [], inWater(areas), LANE)

test("playerSpawn passes over a sidewalk spot in the water for the next clear one: across the street, then along it", () => {
  assert.deepEqual(
    spawnBeside([]),
    { x: 50, y: 3.5, angle: 0 },
    "the nearest spot, toward the target",
  )
  assert.deepEqual(
    spawnBeside([pond(40, 3, 60, 30)]),
    { x: 50, y: -3.5, angle: 0 },
    "a pond on the target's side: across the street",
  )
  // Ponds on both sides of x 45…55: the spots at 50, 48.5, 51.5, 47, 53, 45.5 and 54.5 are wet,
  // and 44 m along the street, toward the target, is the first dry one.
  assert.deepEqual(spawnBeside([pond(45, 3, 55, 30), pond(45, -30, 55, -3)]), {
    x: 44,
    y: 3.5,
    angle: 0,
  })
})

const poi = (id: number): Poi => ({ id, kind: "amenity:police", x: 1, y: 2 })

test("regionPoi finds a POI by id, and only in a test region passes over a missing one", () => {
  assert.deepEqual(regionPoi([poi(5), poi(7)], 7, { test: false }), poi(7))
  assert.equal(regionPoi([poi(5)], 7, { test: true }), undefined)
  assert.throws(() => regionPoi([poi(5)], 7, { test: false }), /poi 7 missing/)
})

// Three nodes on two traffic edges (roads 1 and 2), and the node nearest the origin on a road
// traffic leaves out (road 0).
const GRAPH = {
  xy: [500, 0, 30, 40, 100, 0, -20, 10],
  edges: [0, 2, 1, 1, 2, 2, 3, 0, 0],
  traffic: [0, 1],
}
const ROADS: Array<RoadF> = [0, 1, 2].map((id) => ({ ...street, id }))

test("startNear starts by the Carabinieri, and without them by the traffic node nearest the origin, on its road", () => {
  assert.deepEqual(startNear(GRAPH, ROADS, { x: 7, y: 8 }), { at: { x: 7, y: 8 } })
  assert.deepEqual(startNear(GRAPH, ROADS, undefined), { at: { x: 30, y: 40 }, road: ROADS[2] })
  assert.equal(startNear({ ...GRAPH, traffic: [] }, ROADS, undefined), undefined)
})
