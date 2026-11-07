import assert from "node:assert/strict"
import { test } from "node:test"

import { nameFromAddresses } from "../addresses.ts"
import { extractRoads, type RoadF } from "../features.ts"
import { fromLocal, type V } from "../geometry.ts"
import type { Osm, Tags } from "../osm.ts"

/** An empty OSM extract, `line`, which adds a way through points with tags, and `address`, a node with `addr:street`. */
const extract = () => {
  const osm: Osm = { nodes: new Map(), ways: new Map(), relations: new Map() }
  const node = (id: string, x: number, y: number, tags: Tags = {}) => {
    const [lat, lon] = fromLocal(x, y)
    osm.nodes.set(id, { id, lat, lon, tags })
  }
  const line = (id: string, pts: ReadonlyArray<readonly [number, number]>, tags: Tags = {}) => {
    pts.forEach(([x, y], k) => node(`${id}:${k}`, x, y))
    osm.ways.set(id, {
      id,
      nds: pts.map((_, k) => `${id}:${k}`),
      tags: { highway: "service", ...tags },
    })
  }
  const address = (id: string, x: number, y: number, street: string) =>
    node(id, x, y, { "addr:street": street })
  return { osm, line, address }
}
/** No clip: each way whole. */
const whole = (pts: ReadonlyArray<V>) => [{ pts: [...pts], from: 0 }]
const names = (roads: ReadonlyArray<RoadF>) => roads.map((r) => [r.id, r.name])

test("nameFromAddresses: an address names the unnamed play-area road it stands by", () => {
  const { osm, line, address } = extract()
  line("1", [
    [0, 0],
    [50, 0],
  ])
  address("a", 20, 8, "Roma")
  address("b", 30, -6, "Via Roma")
  address("c", 40, 6, "Via Roma")
  const roads = extractRoads(osm, whole)
  nameFromAddresses(osm, roads)
  // The street with the most votes; a name without "Via" gets it.
  assert.deepEqual(names(roads), [[1, "Via Roma"]])
})

// Regression: Fosdinovo's extract holds a farm shop with addr:street=SS63 (node 7013677166) in the
// notch, 48 m from the SS63 (way 140771655) and 11 m from a driveway beyond the play area: it named
// the play area's nearest road, tertiary 693993316, 604 m off, "Via SS63". By fosdinovo's west edge
// an address of Via Canepari (10149225937) 14 m from an unnamed road beyond it (698929403) named
// service road 698929404 in play, 20 m off; the L took names from addresses 3-8 km away.
test("nameFromAddresses: an address by a road beyond the play area, or out of reach, names no road in it", () => {
  const { osm, line, address } = extract()
  line("1", [
    [0, 0],
    [100, 0],
  ]) // in play
  line("2", [
    [0, 30],
    [100, 30],
  ]) // beyond the play area, 7 m from the address, which stands 25 m from way 1
  line("3", [
    [1000, 0],
    [1100, 0],
  ]) // in play, 150 m from the other address
  address("a", 95, 25, "SS63")
  address("b", 1050, 150, "Vallecchia")
  const roads = extractRoads(osm, whole).filter((r) => r.id !== 2)
  nameFromAddresses(osm, roads)
  assert.deepEqual(names(roads), [
    [1, undefined],
    [3, undefined],
  ])
})

test("nameFromAddresses: an address by the piece of a way beyond the play area names its pieces in play; by a named road, none", () => {
  const { osm, line, address } = extract()
  // Way 1 runs out of the play area at x 100: its piece beyond it lies by the address.
  line("1", [
    [0, 0],
    [100, 0],
    [200, 0],
  ])
  line("2", [
    [0, 40],
    [200, 40],
  ])
  line(
    "3",
    [
      [0, 80],
      [200, 80],
    ],
    { name: "Via Dante" },
  )
  address("a", 195, 5, "Via Garibaldi")
  address("b", 5, 75, "Via Mazzini") // by Via Dante, which OSM names: no vote, so way 2 stays unnamed
  const roads = extractRoads(osm, whole).map((r) =>
    r.id === 1 ? { ...r, pts: r.pts.slice(0, 2) } : r,
  )
  nameFromAddresses(osm, roads)
  assert.deepEqual(names(roads), [
    [1, "Via Garibaldi"],
    [2, undefined],
    [3, "Via Dante"],
  ])
})

// Cesena's way 23562742 is Via Fiorenzuola's by 19 of its addresses, and the 4 of Via Emilia Levante
// beyond the play area's east edge vote for it too: the street seen first took it.
test("nameFromAddresses: a way two streets vote for takes the one with more votes for it", () => {
  const { osm, line, address } = extract()
  line("1", [
    [0, 0],
    [100, 0],
  ])
  address("a", 10, 5, "Via Emilia Levante")
  for (const [k, x] of [20, 40, 60].entries()) address(`f${k}`, x, 5, "Via Fiorenzuola")
  const roads = extractRoads(osm, whole)
  nameFromAddresses(osm, roads)
  assert.deepEqual(names(roads), [[1, "Via Fiorenzuola"]])
})
