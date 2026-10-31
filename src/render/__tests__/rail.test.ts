import assert from "node:assert/strict"
import { test } from "node:test"

import { buildingPieces } from "../buildings.ts"
import { lampPieces } from "../sky/lamps.ts"
import { stationPieces } from "../stations.ts"
import { assertChunkCut } from "./chunk-cut.ts"
import {
  checkArms,
  checkBed,
  checkCarriageways,
  checkDashes,
  checkPanelsOverRoads,
  checkPortals,
  checkReadingWidths,
  lines,
  pieces,
  railwayNear,
} from "./rail-checks.ts"

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }
/**
 * The railway within 4 km of Monzone station: Monzone's, Gragnola's and Equi Terme's crossings,
 * and the tunnel mouths either side; rail.map-test.ts checks the whole map's.
 */
const HERE = railwayNear(STATION, 4000)

// rail.map-test.ts checks every chunk of the map.
test("rail, stations, roads and rivers, lamps and buildings: a chunk build by Monzone station keeps exactly its cut of the whole build", () => {
  const station = { minX: -1000, minY: -100, maxX: 0, maxY: 900 }
  for (const list of [pieces, stationPieces(), lines, lampPieces(), buildingPieces()]) {
    const built = assertChunkCut(list, station)
    // Monzone's two platforms are the fewest.
    assert.ok(built >= 2, `${built} chunks hold some`)
  }
})

test("rail, by Monzone station: nothing 3D stands in a crossing's carriageway (0.3 m in from its edges, which bend), and the ballast bed stops a metre short of it", () => {
  assert.ok(HERE.crossings.length >= 4, `${HERE.crossings.length} crossings`)
  checkCarriageways(HERE)
})

test("rail, by Monzone station: at each crossing the panel, its rails and the stop lines lie over the road ribbon drawn there", () => {
  checkPanelsOverRoads(HERE)
})

// Regression: a tertiary road's centre dashes lay as high as the panels, so they cut through them.
test("rail, by Monzone station: no road's centre dash lies under a crossing's panels", () => {
  checkDashes(HERE)
})

test("rail, by Monzone station: drawn at reading widths, a 0.6 m sleeper every 1.2 m and 0.24 m rails on the bed", () => {
  checkReadingWidths(HERE)
})

test("rail, by Monzone station: people walk over the bed: its top stands 0.15 m or less over the terrain on 90 % of the line at grade", () => {
  checkBed(HERE, 10_000)
})

test("rail, by Monzone station: a portal at every tunnel mouth, its dark mouth facing out of the hill", () => {
  checkPortals(HERE, 2)
})

test("crossings, by Monzone station: each arm hinged on its housing's face, the road light's black plate behind its lens, all clear of the trains", () => {
  checkArms(HERE, 2)
})
