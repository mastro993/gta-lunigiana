// Cesena's roads and river as built (cesena.test.ts, in pnpm test, checks its landmarks and its
// start): the clearance under every road bridge, the Secante, the region's one trunk road, with its
// slip roads: driven by traffic but no Ape, and nobody walking them or parked by them; and every
// piece of the Savio. The vectors live in the tiles: these checks read the map whole, joined.
import assert from "node:assert/strict"
import { test } from "node:test"

import { overpassShortfalls } from "../../sim/map/__tests__/overpass-checks.ts"
import { isMotorRoad } from "../../sim/map/kinds.ts"
import { segDist2 } from "../geometry.ts"
import { wholeMap } from "../map-file.ts"

const map = wholeMap("cesena")
const roadOf = (edge: number) => map.roads[map.graph.edges[3 * edge + 2]!]!

// A road without its line would pass every check below unchecked.
test("Cesena: every road has its line", () => {
  assert.ok(map.roads.length > 0, "no roads")
  for (const r of map.roads)
    assert.ok(r.pts.length >= 4 && r.z.length * 2 === r.pts.length, `road ${r.id} has no line`)
})

test("the Savio uses its mapped riverbanks rather than the mountain-stream default", () => {
  const savio = map.water.filter((water) => water.name?.includes("Savio"))
  assert.ok(savio.length > 0)
  assert.ok(savio.every((water) => water.w > 8 && water.w <= 120))
})

test("Cesena: every road under a road bridge keeps its clearance", () => {
  assert.ok(
    map.roads.some((r) => r.bridge === true),
    "no road bridge to check",
  )
  assert.deepEqual(overpassShortfalls(map.roads), [])
})

// Regression: the Secante's slip roads, primary by class, were walked and parked by, and Apes drove the trunk road.
test("Cesena: the Secante (SS726) is trunk and its slip roads ramps; traffic drives them, no Ape, and nobody walks or parks there", () => {
  const motor = map.roads.filter(isMotorRoad)
  assert.ok(motor.some((r) => r.ref === "SS726" && r.cls === "trunk"))
  assert.ok(motor.some((r) => r.ramp === true && r.cls === "primary"))
  assert.ok(map.graph.traffic.some((e) => roadOf(e).cls === "trunk"))
  assert.ok(map.graph.walk.every((e) => !isMotorRoad(roadOf(e))))
  // An Ape's lanes (b → a, a → b per traffic edge) are −1 on every motor road.
  map.graph.traffic.forEach((e, k) => {
    if (isMotorRoad(roadOf(e)))
      assert.ok(
        map.lanes.ape[2 * k]! < 0 && map.lanes.ape[2 * k + 1]! < 0,
        `an Ape lane on edge ${e}`,
      )
  })
  // A parked car stands w/2 + 1 m off its road's centreline: none that near a motor road's.
  assert.ok(map.spawns.parked.length > 0, "no parked spots")
  for (const s of map.spawns.parked)
    for (const r of motor)
      for (let i = 0; i + 3 < r.pts.length; i += 2)
        assert.ok(
          segDist2(s.x, s.y, r.pts[i]!, r.pts[i + 1]!, r.pts[i + 2]!, r.pts[i + 3]!).d2 >
            (r.w / 2 + 1.5) ** 2,
          `a car parked at (${s.x}, ${s.y}) by ${r.cls} ${r.id}`,
        )
})
