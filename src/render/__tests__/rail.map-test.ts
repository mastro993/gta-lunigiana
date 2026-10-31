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

// Map checks (pnpm test:map): every piece and chunk, crossing and tunnel mouth of the map;
// rail.test.ts checks those by Monzone station.
const ALL = railwayNear()

test("rail, stations, roads and rivers, lamps and buildings: a chunk build keeps exactly its cut of the whole-map build", () => {
  for (const list of [pieces, stationPieces(), lines, lampPieces(), buildingPieces()]) {
    const built = assertChunkCut(list)
    assert.ok(built >= 5, `${built} chunks hold some`)
  }
})

test("rail: nothing 3D stands in any crossing's carriageway, and the ballast bed stops a metre short of it", () => {
  checkCarriageways(ALL)
})

test("rail: at every crossing the panel, its rails and the stop lines lie over the road ribbon drawn there", () => {
  checkPanelsOverRoads(ALL)
})

test("rail: no road's centre dash lies under any crossing's panels", () => {
  checkDashes(ALL)
})

test("rail: the longest straight of the map's running track drawn at reading widths", () => {
  checkReadingWidths(ALL)
})

test("rail: the bed's top stands 0.15 m or less over the terrain on 90 % of the map's line at grade", () => {
  checkBed(ALL, 10_000)
})

test("rail: a portal at every tunnel mouth inside the map, its dark mouth facing out of the hill", () => {
  checkPortals(ALL, 2)
})

test("crossings: at every crossing each arm hinged on its housing's face and the road light's plate behind its lens, all clear of the trains", () => {
  checkArms(ALL, 2)
})
