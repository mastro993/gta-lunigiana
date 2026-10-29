import assert from "node:assert/strict"
import { test } from "node:test"

import type { RailF, RoadF, WaterF } from "../features.ts"
import type { V } from "../geometry.ts"
import { railLevels } from "../rail-levels.ts"
import type { Profile } from "../terrain.ts"

const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })
const road = (id: number, pts: ReadonlyArray<V>, more: Partial<RoadF> = {}): RoadF => ({
  id,
  cls: "residential",
  w: 6,
  surface: "asphalt",
  private: false,
  pts,
  ...more,
})
const stream = (id: number, w: number, x: number): WaterF => ({
  id,
  kind: "stream",
  w,
  bed: w,
  depth: 1,
  pts: [v(x, -50), v(x, 50)],
})
// The rail along y 0: at grade to x 100, a bridge over x 100–300, at grade on. Ground is flat at
// 100 m; the rail stands at 110 m wherever a road's bound reads it.
const atGrade: RailF = { id: 1, pts: [v(0, 0), v(50, 0, "lc"), v(100, 0, "b0")] }
const bridge: RailF = { id: 2, bridge: true, pts: [v(100, 0, "b0"), v(300, 0, "b1")] }
const beyond: RailF = { id: 3, pts: [v(300, 0, "b1"), v(400, 0)] }
const roads = [
  road(10, [v(50, -20), v(50, 0, "lc"), v(50, 20)]), // a level crossing
  road(11, [v(150, -20), v(150, 20)], { maxheight: 3.2 }), // a tagged underpass
  road(12, [v(200, -20), v(200, 20)]), // an untagged one
  road(13, [v(350, -20), v(350, 20)], { bridge: true }), // a road bridge over the track
]
const water = [stream(20, 2, 250), stream(21, 8, 270)]
const wp: Array<Profile> = water.map(() => ({
  x: [0, 0],
  y: [-50, 50],
  s: [0, 100],
  z: Float64Array.from([99, 99]),
  vertexSample: [0, 1],
}))
const levels = railLevels({
  allRail: [atGrade, bridge, beyond],
  roads,
  water,
  wp,
  ground: () => 100,
  zAt: () => 110,
})
const rail = [atGrade, bridge, beyond].map((item) => ({ item }))
const at = (x: number) => levels.railBounds(rail).filter((b) => b.x === x)

// Regression: an exact pin over a tagged underpass held the line 2.7 m low, the Equi Terme overpass left the train's roof
// 0.46 m in its deck, and level crossings pinned the rail to each road's natural level, a V of up to 5 %.
test("railLevels bounds the rail over a tagged underpass from below, under a road bridge from above, and never pins it at a level crossing", () => {
  // A maxheight sign gives the least clearance: the rail at least 3.2 + 1.5 m over the road's
  // level, the road at least that far under the rail (an exact pin held the line 2.7 m low).
  assert.deepEqual(at(150), [{ x: 150, y: 0, z: 104.7, kind: "min" }])
  assert.deepEqual(levels.roadBounds([{ item: roads[1]! }]), [
    { x: 150, y: 0, z: 105.3, kind: "max" },
  ])
  // An untagged underpass bounds only its road, 4 + 1.5 m under the rail.
  assert.deepEqual(at(200), [])
  assert.deepEqual(levels.roadBounds([{ item: roads[2]! }]), [
    { x: 200, y: 0, z: 104.5, kind: "max" },
  ])
  // Under a road bridge the train clears the deck: the rail 5.5 m under the deck's ground-level
  // line, the road 5.5 m over the rail (the Equi Terme overpass left the roof 0.46 m in the deck).
  assert.deepEqual(at(350), [{ x: 350, y: 0, z: 94.5, kind: "max" }])
  assert.deepEqual(levels.roadBounds([{ item: roads[3]! }]), [
    { x: 350, y: 0, z: 115.5, kind: "min" },
  ])
  // The level crossing pins nothing on the rail: the road meets it there (a V of up to 5% before).
  assert.deepEqual(at(50), [])
  assert.equal(levels.levels.length, 1)
  // Over the 8 m river the rail keeps 3 m; over the 2 m stream the line keeps its level.
  assert.deepEqual(at(270), [{ x: 270, y: 0, z: 102, kind: "min" }])
  assert.deepEqual(at(250), [])
})
