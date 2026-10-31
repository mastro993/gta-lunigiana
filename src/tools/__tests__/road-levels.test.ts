import assert from "node:assert/strict"
import { test } from "node:test"

import type { RoadF } from "../features.ts"
import type { V } from "../geometry.ts"
import type { Linear } from "../profiles.ts"
import { passesOver, roadLevels } from "../road-levels.ts"

const v = (x: number, y: number, id?: string): V => (id === undefined ? { x, y } : { x, y, id })
const road = (
  id: number,
  cls: RoadF["cls"],
  pts: ReadonlyArray<V>,
  more: Partial<RoadF> = {},
): RoadF => ({
  id,
  cls,
  w: 6,
  surface: "asphalt",
  private: false,
  pts,
  ...more,
})
// Ground flat at 100 m. A motorway bridge along y 0 over x 0–200 crosses three local roads at
// x 50, 100 and 150; a trunk tunnel along y 50 runs under a residential street at x 100; a service
// road at grade crosses a service tunnel (a car park's ramp) at x 300.
const motorway = road(1, "motorway", [v(0, 0), v(200, 0)], { bridge: true })
const under = road(2, "residential", [v(50, -30), v(50, 30)])
const tagged = road(3, "residential", [v(100, -30), v(100, 30)], { maxheight: 3.2 })
const path = road(4, "path", [v(150, -30), v(150, 30)])
const trunk = road(5, "trunk", [v(0, 50), v(200, 50)], { tunnel: true })
const street = road(6, "residential", [v(100, 20), v(100, 80)])
const square = road(7, "service", [v(300, -30), v(300, 30)])
const ramp = road(8, "service", [v(270, 0), v(330, 0)], { tunnel: true })
const roads = [motorway, under, tagged, path, trunk, street, square, ramp]
const make = (fitted: ReadonlyArray<RoadF>) =>
  roadLevels({
    roads,
    ground: () => 100,
    fitted: (l: Linear) => fitted.includes(l as RoadF),
    zAt: () => 110,
  })
const zs = (bounds: ReadonlyArray<{ readonly z: number; readonly kind?: string }>) => [
  ...new Set(bounds.map((b) => `${b.kind} ${b.z.toFixed(1)}`)),
]

test("passesOver: a bridge or a road over a tunnel, on a higher OSM level", () => {
  assert.equal(passesOver({ bridge: true }, {}), true)
  assert.equal(passesOver({}, { tunnel: true }), true)
  assert.equal(passesOver({ bridge: true, layer: 1 }, { bridge: true, layer: 2 }), false)
  assert.equal(passesOver({}, {}), false)
})

// Regression: Cesena's roads crossed under its bridges with 1.25 m to spare, and a service road ran 1.6 m under a slip road
// whose bridge the junction under it held down.
test("roadLevels: a road under a bridge keeps maxheight (4 m untagged) plus a 1.5 m deck; a bridge or tunnel in an earlier pass keeps it from the other's natural level", () => {
  // Paths follow the terrain: no overpass over one.
  assert.deepEqual(
    make([]).over.map((o) => [o.up.id, o.down.id, o.clear]),
    [
      [1, 2, 5.5],
      [1, 3, 4.7],
      [6, 5, 5.5],
      [7, 8, 5.5],
    ],
  )
  // The motorway, fitted first, rises 5.5 m (4.7 m over the tagged road) and 0.3 m of slack over the
  // local roads' natural level, at the crossing and 2 m either side; its own tunnel dips as far under
  // the street's.
  assert.deepEqual(zs(make([]).bounds([{ item: motorway }])), ["min 105.8", "min 105.0"])
  assert.equal(make([]).bounds([{ item: motorway }]).length, 6)
  assert.deepEqual(zs(make([]).bounds([{ item: trunk }])), ["max 94.2"])
  // A local road fitted after it dips under the fitted deck, and the street under the trunk's...
  assert.deepEqual(zs(make([motorway]).bounds([{ item: under }])), ["max 104.5"])
  assert.deepEqual(zs(make([motorway]).bounds([{ item: tagged }])), ["max 105.3"])
  // ...but a road at grade never rises over a tunnel, and one pass fits the square and its ramp
  // in either order: the ramp dips under the square only once the square is fitted.
  assert.deepEqual(make([trunk]).bounds([{ item: street }]), [])
  assert.deepEqual(make([ramp]).bounds([{ item: square }]), [])
  assert.deepEqual(make([]).bounds([{ item: ramp }]), [])
  assert.deepEqual(zs(make([square]).bounds([{ item: ramp }])), ["max 104.5"])
})
