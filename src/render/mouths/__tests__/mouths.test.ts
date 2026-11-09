import assert from "node:assert/strict"
import { test } from "node:test"

import { terrainZ } from "../../../sim/map/ground.ts"
import { type Building, MAP, type Road } from "../../../sim/map/index.ts"
import type { Vectors } from "../../testing.ts"
import { bakeMouths } from "../index.ts"
import {
  checkClear,
  checkHeadWallStands,
  checkPortalStands,
  checkStoodBack,
  endsOf,
  type Mouth,
  whyOpen,
} from "./mouth-checks.ts"
import { aroundTunnels, bakedAt, PATH, PIEVE, SR445, TRACK, tunnelAt } from "./tunnels.ts"

// Where road tunnels' mouths are and what stands at them, found by geometry: the SR445's tunnel by
// Groppoli, the 196 m track's, the 87 m path's under the line at Equi Terme and Pieve San Lorenzo's
// underpass (tunnels.ts); the tunnels map tests check every road tunnel's mouth of each built region.

test("both mouths of the SR445's tunnel by Groppoli and of the 196 m track's: a portal at its end, crowned over the road's clear height, on no other road", () => {
  for (const at of [SR445, TRACK]) {
    const [road, id] = tunnelAt(at)
    for (const mouth of endsOf(road, id)) {
      const baked = bakedAt(mouth, id)
      assert.equal(baked.back, 0, `the portal at (${mouth.x}, ${mouth.y}) stands at its end`)
      checkPortalStands(road, baked)
      checkClear(aroundTunnels().roads, mouth, mouth)
    }
  }
})

test("the 87 m path under the line at Equi Terme: its portals stand clear of the tertiary road its south mouth opens onto and of the track over its north throat", () => {
  const [road, id] = tunnelAt(PATH)
  assert.equal(road.cls, "path")
  for (const end of endsOf(road, id)) {
    const at = bakedAt(end, id)
    checkPortalStands(road, at)
    checkClear(aroundTunnels().roads, end, at)
    // The south mouth is a vertex of the tertiary road, which crosses it: the portal stands back.
    if (end.y < PATH.y) assert.ok(at.back >= 5, `stood back ${at.back} m`)
    if (at.back > 0) checkStoodBack(road, end, at, at.back)
  }
})

test("Pieve San Lorenzo's underpass under the station: a head wall at its south mouth, under Via della Stazione, its top under the bank its box meets; its north mouth, the bank over it lower than a head wall, open", () => {
  const [road, id] = tunnelAt(PIEVE)
  assert.equal(road.cls, "residential")
  const [south, north] = endsOf(road, id).sort((a, b) => a.y - b.y) as [Mouth, Mouth],
    wall = bakedAt(south, id)
  checkHeadWallStands(road, wall)
  checkClear(aroundTunnels().roads, south, south)
  const open = MAP.derived.mouths.find(
    (mouth) => mouth.road === id && mouth.x === north.x && mouth.y === north.y,
  )
  assert.ok(open !== undefined && "open" in open, "the north mouth open")
  assert.equal(whyOpen(aroundTunnels(), north), "low")
})

test("Pieve San Lorenzo's underpass split into two ways 2 m from its south mouth, on the same line: the same head wall, the ground over its end read on along the second way", () => {
  const { roads, buildings } = aroundTunnels(),
    [road, id] = tunnelAt(PIEVE),
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
  const k = roads.ids.indexOf(id),
    split = {
      ids: [...roads.ids, Number.MAX_SAFE_INTEGER],
      items: [
        ...roads.items.map((other, j) => (j === k ? way([...line.slice(0, i + 1), cut]) : other)),
        way([cut, ...line.slice(i + 1)]),
      ],
    }
  const wall = bakeMouths(split, buildings.items).find(
    (mouth) => mouth.road === id && mouth.x === south.x && mouth.y === south.y,
  )
  assert.ok(wall !== undefined && "head" in wall, "a head wall at the split way's south mouth")
  assert.equal(wall.throat, bakedAt(south, id).throat)
  // Nor does `whyOpen` find the ground over its end too low to leave it open.
  assert.throws(() => whyOpen({ ...aroundTunnels(), roads: split }, south), /is open, though/)
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
const withHouse = (house: Building): Vectors => {
  const around = aroundTunnels()
  return {
    ...around,
    buildings: {
      ids: [...around.buildings.ids, Number.MAX_SAFE_INTEGER],
      items: [...around.buildings.items, house],
    },
  }
}

test("a house over the SR445's tunnel by its east mouth opens it only standing at the road's level, a covered way: on the hill over the bore, its portal stays", () => {
  const { roads, buildings } = aroundTunnels(),
    [road, id] = tunnelAt(SR445),
    east = endsOf(road, id).reduce((a, b) => (b.x > a.x ? b : a)),
    ux = Math.cos(east.angle),
    uy = Math.sin(east.angle),
    floor = road.pts[0] === east.x && road.pts[1] === east.y ? road.z[0]! : road.z.at(-1)!
  const bakedWith = (houses: ReadonlyArray<Building>) =>
    bakeMouths(roads, houses).find(
      (mouth) => mouth.road === id && mouth.x === east.x && mouth.y === east.y,
    )
  const portal = bakedWith(buildings.items)
  assert.ok(portal !== undefined && "crown" in portal, "a portal at the SR445's east mouth")
  // On the ground 20 m into the hill, some 16 m over the road.
  const [hx, hy] = [east.x - ux * 20, east.y - uy * 20],
    hill = houseAt(hx, hy, terrainZ(hx, hy))
  assert.ok(
    hill.z0 - floor > 10,
    `the house on the hill ${(hill.z0 - floor).toFixed(1)} m over the road`,
  )
  assert.deepEqual(bakedWith([...buildings.items, hill]), portal)
  assert.throws(() => whyOpen(withHouse(hill), east), /is open, though/)
  // At the road's level over its first metres.
  const level = houseAt(east.x - ux * 3, east.y - uy * 3, floor)
  assert.ok("open" in bakedWith([...buildings.items, level])!, "a covered way's mouth open")
  assert.equal(whyOpen(withHouse(level), east), "housed")
})

/** As the map file holds it: JSON keeps no −0 and no undefined. */
const saved = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

// The whole map's mouths are bake.map-test.ts's: a mouth's tunnel, and the roads round it, can reach
// past the tiles round it.
test("the SR445's, the track's, the path's and Pieve San Lorenzo's underpass's mouths are baked as the game's code bakes them now: six portals, a head wall and an open mouth (run pnpm map when this fails)", () => {
  const { roads, buildings } = aroundTunnels(),
    ids = new Set([SR445, TRACK, PATH, PIEVE].map((at) => tunnelAt(at)[1])),
    fresh = bakeMouths(roads, buildings.items).filter((mouth) => ids.has(mouth.road))
  assert.deepEqual(
    ["crown", "head", "open"].map((kind) => fresh.filter((mouth) => kind in mouth).length),
    [6, 1, 1],
  )
  assert.deepEqual(saved(fresh), saved(MAP.derived.mouths.filter((mouth) => ids.has(mouth.road))))
})
