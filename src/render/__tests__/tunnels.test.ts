import assert from "node:assert/strict"
import { test } from "node:test"

import { segDist2 } from "../../sim/collide.ts"
import { terrainZ } from "../../sim/map/ground.ts"
import { type Building, MAP, type Road } from "../../sim/map/index.ts"
import { PALETTE } from "../palette.ts"
import { bakeMouths } from "../portals.ts"
import { type Vectors, vectorsAround } from "../testing.ts"
import {
  checkClear,
  checkHeadWall,
  checkNoPortal,
  checkPortal,
  checkStoodBack,
  endsOf,
  type Mouth,
  whyOpen,
} from "./mouth-checks.ts"
import { checkBore, checkRibbon, SR445 } from "./tunnel-checks.ts"

// Road tunnels as drawn, found by geometry: the SR445's 172 m tunnel by Groppoli, west of Gragnola,
// the 196 m track tunnel south-east of Equi Terme, the 87 m path under the line at Equi Terme, Pieve
// San Lorenzo's 29 m underpass under the station and Via Casola's building passage in Casola; the
// tunnels map tests check every road tunnel of each built region.

/** Inside each: the track's tunnel, the path's, Pieve San Lorenzo's underpass and Via Casola's passage (the SR445's: `SR445`). */
const TRACK = { x: 2855, y: 65 },
  PATH = { x: 1969, y: 920 },
  PIEVE = { x: 5040, y: 3620 },
  CASOLA = { x: 3577, y: 4152 }
/** The roads and buildings of the tiles round them (every one within 300 m). */
const AROUND = vectorsAround([SR445, TRACK, PATH, PIEVE, CASOLA], 300),
  { roads: ROADS, buildings: HOUSES } = AROUND

/** The road in a tunnel whose line passes nearest `at`, within 20 m, and its index in the whole map's roads. */
const tunnelAt = (at: { readonly x: number; readonly y: number }): readonly [Road, number] => {
  let best = 20 ** 2,
    found: readonly [Road, number] | undefined
  ROADS.items.forEach((road, k) => {
    if (road.tunnel !== true) return
    for (let i = 0; i + 3 < road.pts.length; i += 2) {
      const { d2 } = segDist2(
        at.x,
        at.y,
        road.pts[i]!,
        road.pts[i + 1]!,
        road.pts[i + 2]!,
        road.pts[i + 3]!,
      )
      if (d2 < best) [best, found] = [d2, [road, ROADS.ids[k]!]]
    }
  })
  assert.ok(found !== undefined, `a road in a tunnel by (${at.x}, ${at.y})`)
  return found
}

test("the SR445's tunnel by Groppoli: its road drawn through the hill at its floor, between dark walls that never stand out of it", () => {
  const [road] = tunnelAt(SR445)
  assert.equal(road.cls, "primary")
  assert.ok(checkRibbon(road) > 80)
  const walls = checkBore(road)
  assert.ok(walls > 100, `${walls} wall triangles`)
})

test("both mouths of the SR445's tunnel by Groppoli: a concrete portal, its dark mouth facing out of the hill, on no other road", () => {
  const [road, id] = tunnelAt(SR445)
  for (const mouth of endsOf(road, id)) {
    checkPortal(road, mouth, PALETTE.plasterGrey)
    checkClear(ROADS, mouth, mouth)
  }
})

test("both mouths of the 196 m track's tunnel: an old stone portal, its dark mouth facing out of the hill, on no other road", () => {
  const [road, id] = tunnelAt(TRACK)
  assert.equal(road.cls, "track")
  for (const mouth of endsOf(road, id)) {
    checkPortal(road, mouth, PALETTE.stoneMid)
    checkClear(ROADS, mouth, mouth)
  }
})

/** Where the build stood the portal or head wall at road `id`'s mouth `end`, and how far back into the tunnel. */
const bakedAt = (end: { readonly x: number; readonly y: number }, id: number) => {
  const baked = MAP.derived.mouths.find(
    (mouth) =>
      mouth.road === id && !("open" in mouth) && Math.hypot(mouth.x - end.x, mouth.y - end.y) < 45,
  )
  assert.ok(
    baked !== undefined && !("open" in baked),
    `a portal or head wall at road ${id}'s mouth (${end.x}, ${end.y})`,
  )
  return baked
}

test("the 87 m path under the line at Equi Terme: its portals stand clear of the tertiary road its south mouth opens onto and of the track over its north throat", () => {
  const [road, id] = tunnelAt(PATH)
  assert.equal(road.cls, "path")
  for (const end of endsOf(road, id)) {
    const at = bakedAt(end, id)
    checkPortal(road, at, PALETTE.stoneMid)
    checkClear(ROADS, end, at)
    // The south mouth is a vertex of the tertiary road, which crosses it: the portal stands back.
    if (end.y < PATH.y) assert.ok(at.back >= 5, `stood back ${at.back} m`)
    if (at.back > 0) checkStoodBack(road, end, at, at.back)
  }
})

test("Pieve San Lorenzo's underpass under the station: an old stone head wall at its south mouth, under Via della Stazione, its opening at the road's clear height facing out of the bank; its north mouth, the bank over it lower than a head wall, open", () => {
  const [road, id] = tunnelAt(PIEVE)
  assert.equal(road.cls, "residential")
  const [south, north] = endsOf(road, id).sort((a, b) => a.y - b.y) as [Mouth, Mouth],
    wall = bakedAt(south, id)
  assert.ok("head" in wall, "a head wall, not a portal")
  checkHeadWall(road, south, PALETTE.stoneMid, wall.throat)
  checkClear(ROADS, south, south)
  checkNoPortal(north.x, north.y)
  assert.equal(whyOpen(AROUND, north), "low")
})

test("Pieve San Lorenzo's underpass split into two ways 2 m from its south mouth, on the same line: the same head wall, the ground over its end read on along the second way", () => {
  const [road, id] = tunnelAt(PIEVE),
    [south] = endsOf(road, id).sort((a, b) => a.y - b.y) as [Mouth, Mouth],
    first = road.pts[0] === south.x && road.pts[1] === south.y,
    n = road.z.length,
    // Its points from the south mouth in: x, y and the profile.
    line = Array.from({ length: n }, (_, i) => {
      const k = first ? i : n - 1 - i
      return [road.pts[2 * k]!, road.pts[2 * k + 1]!, road.z[k]!] as const
    })
  // The point 2 m in, on its line.
  let left = 2,
    i = 0
  for (; ; i++) {
    const l = Math.hypot(line[i + 1]![0] - line[i]![0], line[i + 1]![1] - line[i]![1])
    if (left <= l) break
    left -= l
  }
  const [a, b] = [line[i]!, line[i + 1]!],
    t = left / Math.hypot(b[0] - a[0], b[1] - a[1]),
    cut = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] as const
  const way = (points: ReadonlyArray<readonly [number, number, number]>): Road => ({
    ...road,
    pts: points.flatMap(([x, y]) => [x, y]),
    z: points.map(([, , z]) => z),
  })
  const k = ROADS.ids.indexOf(id),
    split = {
      ids: [...ROADS.ids, Number.MAX_SAFE_INTEGER],
      items: [
        ...ROADS.items.map((other, j) => (j === k ? way([...line.slice(0, i + 1), cut]) : other)),
        way([cut, ...line.slice(i + 1)]),
      ],
    }
  const wall = bakeMouths(split, HOUSES.items).find(
    (mouth) => mouth.road === id && mouth.x === south.x && mouth.y === south.y,
  )
  assert.ok(wall !== undefined && "head" in wall, "a head wall at the split way's south mouth")
  assert.equal(wall.throat, bakedAt(south, id).throat)
  // Nor does `whyOpen` find the ground over its end too low to leave it open.
  assert.throws(() => whyOpen({ ...AROUND, roads: split }, south), /is open, though/)
})

/** A house 7 m high on a 10 m square round map point (x, y), its lowest corner's ground `z0` m a.s.l. */
const houseAt = (x: number, y: number, z0: number): Building => ({
  id: 0,
  kind: "house",
  h: 7,
  z0,
  style: "house",
  tint: 0,
  outer: [x - 5, y - 5, x + 5, y - 5, x + 5, y + 5, x - 5, y + 5],
})

/** The roads and buildings round the tunnels, and `house` too. */
const withHouse = (house: Building): Vectors => ({
  ...AROUND,
  buildings: { ids: [...HOUSES.ids, Number.MAX_SAFE_INTEGER], items: [...HOUSES.items, house] },
})

test("a house over the SR445's tunnel by its east mouth opens it only standing at the road's level, a covered way: on the hill over the bore, its portal stays", () => {
  const [road, id] = tunnelAt(SR445),
    east = endsOf(road, id).reduce((a, b) => (b.x > a.x ? b : a)),
    ux = Math.cos(east.angle),
    uy = Math.sin(east.angle),
    floor = road.pts[0] === east.x && road.pts[1] === east.y ? road.z[0]! : road.z.at(-1)!
  const bakedWith = (houses: ReadonlyArray<Building>) =>
    bakeMouths(ROADS, houses).find(
      (mouth) => mouth.road === id && mouth.x === east.x && mouth.y === east.y,
    )
  const portal = bakedWith(HOUSES.items)
  assert.ok(portal !== undefined && "crown" in portal, "a portal at the SR445's east mouth")
  // On the ground 20 m into the hill, some 16 m over the road.
  const [hx, hy] = [east.x - ux * 20, east.y - uy * 20],
    hill = houseAt(hx, hy, terrainZ(hx, hy))
  assert.ok(
    hill.z0 - floor > 10,
    `the house on the hill ${(hill.z0 - floor).toFixed(1)} m over the road`,
  )
  assert.deepEqual(bakedWith([...HOUSES.items, hill]), portal)
  assert.throws(() => whyOpen(withHouse(hill), east), /is open, though/)
  // At the road's level over its first metres.
  const level = houseAt(east.x - ux * 3, east.y - uy * 3, floor)
  assert.ok("open" in bakedWith([...HOUSES.items, level])!, "a covered way's mouth open")
  assert.equal(whyOpen(withHouse(level), east), "housed")
})

test("Via Casola's building passage: its road drawn on under the house at its floor, with no walls and no portal", () => {
  const [road, id] = tunnelAt(CASOLA)
  assert.equal(road.name, "Via Casola")
  checkRibbon(road)
  assert.equal(checkBore(road), 0)
  for (const { x, y } of endsOf(road, id)) checkNoPortal(x, y)
})

/** As the map file holds it: JSON keeps no −0 and no undefined. */
const saved = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

// The whole map's mouths are bake.map-test.ts's: a mouth's tunnel, and the roads round it, can reach
// past the tiles round it.
test("the SR445's, the track's, the path's and Pieve San Lorenzo's underpass's mouths are baked as the game's code bakes them now: six portals, a head wall and an open mouth (run pnpm map when this fails)", () => {
  const roads = new Set([SR445, TRACK, PATH, PIEVE].map((at) => tunnelAt(at)[1])),
    fresh = bakeMouths(ROADS, HOUSES.items).filter((mouth) => roads.has(mouth.road))
  assert.deepEqual(
    ["crown", "head", "open"].map((kind) => fresh.filter((mouth) => kind in mouth).length),
    [6, 1, 1],
  )
  assert.deepEqual(saved(fresh), saved(MAP.derived.mouths.filter((mouth) => roads.has(mouth.road))))
})

// Regression: Giucano's path under its houses (OSM 1326730181), 12% down through an 85° turn, drew
// its ribbon 3 cm under its profile past the bend: a mitred section holds one height across a line
// that slopes along it, and a whole quad's two triangles there tilt off the profile.
const turning = (flag: "tunnel" | "bridge"): Road => ({
  id: 1,
  cls: "path",
  w: 1.5,
  surface: "unpaved",
  [flag]: true,
  pts: [0, 0, -2.1, 0.9, -2.9, -0.6],
  z: [309.1, 308.9, 308.7],
})

test("a ribbon on its profile (a tunnel's, a deck's) holds it along its line through a sharp bend on a slope", () => {
  assert.equal(checkRibbon(turning("tunnel")), 7)
  assert.equal(checkRibbon(turning("bridge")), 7)
})
