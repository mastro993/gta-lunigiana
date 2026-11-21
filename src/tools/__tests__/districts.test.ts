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

test("a village's disc covers 90% of its buildings within 600 m, clamped to 600 m; a town's as far as its buildings within 1200 m; a neighbourhood's as a village's", () => {
  // In Aulla's part, far from Monzone's hand-placed discs: a town with a house every 100 m north of
  // its node out to 1000 m and one more at 1300 m; 3 km east a village with ten 50 m further out; 3 km
  // further east a neighbourhood (OSM's Albiano Magra, issue #20) with ten houses 595 m round it.
  const town = { x: -16500, y: 7500 },
    village = { x: -13500, y: 7500 },
    neighbourhood = { x: -10500, y: 7500 }
  const osm: Osm = { nodes: new Map(), ways: new Map(), relations: new Map() }
  for (const [id, p, place] of [
    ["1", town, "town"],
    ["2", village, "village"],
    ["3", neighbourhood, "neighbourhood"],
  ] as const) {
    const [lat, lon] = fromLocal(p.x, p.y)
    osm.nodes.set(id, { id, lat, lon, tags: { place, name: place } })
  }
  const buildings = [town, village].flatMap((p, k) =>
    Array.from({ length: 10 }, (_, d) => house(100 * k + d, p.x, p.y + 100 * (d + 1) + 50 * k)),
  )
  buildings.push(house(300, town.x, town.y + 1300))
  for (let k = 0; k < 10; k++) {
    const a = (2 * Math.PI * k) / 10
    buildings.push(
      house(400 + k, neighbourhood.x + 595 * Math.cos(a), neighbourhood.y + 595 * Math.sin(a)),
    )
  }
  const disc = (name: string) => fitDistricts(osm, buildings).find((d) => d.name === name)!
  // The village takes the five houses within 600 m: 90% of them is its fourth, at 450 m, plus 10 m.
  assert.equal(disc("village").r, 460)
  // The town all ten within 1200 m, but not the one at 1300 m: 90% of them is its ninth, at 900 m.
  assert.equal(disc("town").r, 910)
  // The neighbourhood's ring, 595 m out, plus 10 m: clamped to 600 m.
  assert.equal(disc("neighbourhood").r, 600)
})

test("a region's district discs hold the landmarks its inputs reach: Lunigiana's the mountains', none of the coast's", () => {
  const names = new Set(
    fitDistricts({ nodes: new Map(), ways: new Map(), relations: new Map() }, []).map(
      (d) => d.name,
    ),
  )
  for (const name of ["Monzone Alto", "Monte Sagro", "Cima Belfiore", "Monte Grugola"])
    assert.ok(names.has(name), name)
  for (const name of ["Foce del Magra", "Punta Bianca"]) assert.ok(!names.has(name), name)
})
