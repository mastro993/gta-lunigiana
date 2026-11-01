import assert from "node:assert/strict"
import { test } from "node:test"

import { tileVectors } from "../../sim/map/tiles.ts"
import { chunkTiles } from "../chunk-tiles.ts"
import { Pieces } from "../pieces.ts"
import { assertChunkCut, wholeBuild, wholeVectors } from "./chunk-cut.ts"
import {
  checkArms,
  checkBed,
  checkCarriageways,
  checkDashes,
  checkPanelsOverRoads,
  checkPortals,
  checkReadingWidths,
  railwayNear,
} from "./rail-checks.ts"

// Map checks (pnpm test:map): every piece and chunk, crossing and tunnel mouth of the map;
// rail.test.ts checks those by Monzone station.
const ALL = railwayNear()

test("buildings, roads and rivers, rail, stations and lamps: every chunk built from the pieces of the tiles under it keeps exactly its cut of the whole-map build", () => {
  const plan = chunkTiles(),
    pieces = new Pieces(plan),
    whole = wholeBuild(wholeVectors())
  // The tiles in the reverse of their order (rail.test.ts tries both by Monzone).
  for (const t of plan.keys.keys().toArray().toReversed())
    pieces.provide(t, tileVectors(plan.keys[t]!))
  let drawn = 0
  // A tile's chunks at a time: the whole build's pieces near them drawn, then let go.
  for (const chunks of plan.owned) drawn += assertChunkCut(whole, pieces, chunks)
  assert.ok(drawn > 3000, `${drawn} chunks draw some`)
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
