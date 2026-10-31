import assert from "node:assert/strict"
import { test } from "node:test"

import { Vec2 } from "@typeonce/ritmo-math"

import { MAP_URL, provideMap, readMapFile } from "../map/packed.ts"

// This process loads Cesena: the global file goes in before anything decodes the map.
provideMap(readMapFile(new URL("cesena.bin", MAP_URL)))
const { MAP } = await import("../map/index.ts")
const { CARABINIERI } = await import("../population/parked.ts")

// Regression: the game parked them by the first police POI, the Commissariato di Cesena (539513054), 1.9 km from the
// Compagnia whose two kerb spots the build had kept for them.
test("Cesena's Carabinieri park by the station the build chose, their Compagnia (POI 806564311), on the spots kept for them", () => {
  assert.equal(MAP.name, "cesena")
  const compagnia = MAP.pois.find((p) => p.id === 806564311)!
  assert.deepEqual(MAP.spawns.police, { x: compagnia.x, y: compagnia.y })
  assert.deepEqual(
    [...CARABINIERI].sort((a, b) => a - b),
    [0, 1],
  )
  for (const i of CARABINIERI) assert.ok(Vec2.distance(MAP.spawns.parked[i]!, compagnia) < 100)
})
