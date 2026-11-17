import assert from "node:assert/strict"
import { test } from "node:test"

import { fitDistricts } from "../districts.ts"
import type { BuildingF } from "../features.ts"
import { fromLocal } from "../geometry.ts"
import type { Osm } from "../osm.ts"

/** A 10 m square house centred on (x, y). */
const house = (id: number, x: number, y: number): BuildingF => ({
  id,
  kind: "house",
  h: 6,
  style: "plaster",
  tint: 0,
  outer: [x - 5, y - 5, x + 5, y - 5, x + 5, y + 5, x - 5, y + 5],
})

test("a village's disc covers 90% of its buildings within 600 m, clamped to 400 m; a town's as far as its buildings within 1200 m", () => {
  // In Aulla's part, far from Monzone's hand-placed discs: a town and, 3 km east, a village, each
  // with a house every 100 m north of its node out to 1000 m, and the town one more at 1300 m.
  const town = { x: -16500, y: 7500 },
    village = { x: -13500, y: 7500 }
  const osm: Osm = { nodes: new Map(), ways: new Map(), relations: new Map() }
  for (const [id, p, place] of [
    ["1", town, "town"],
    ["2", village, "village"],
  ] as const) {
    const [lat, lon] = fromLocal(p.x, p.y)
    osm.nodes.set(id, { id, lat, lon, tags: { place, name: place } })
  }
  const buildings = [town, village].flatMap((p, k) =>
    Array.from({ length: 10 }, (_, d) => house(100 * k + d, p.x, p.y + 100 * (d + 1))),
  )
  buildings.push(house(300, town.x, town.y + 1300))
  const disc = (name: string) => fitDistricts(osm, buildings).find((d) => d.name === name)!
  // The village takes the five houses within 600 m: 90% of them is its fourth, at 400 m, plus 10 m.
  assert.equal(disc("village").r, 400)
  // The town all ten within 1200 m, but not the one at 1300 m: 90% of them is its ninth, at 900 m.
  assert.equal(disc("town").r, 910)
})
