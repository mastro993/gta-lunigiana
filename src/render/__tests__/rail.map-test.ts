import assert from "node:assert/strict"
import { test } from "node:test"

import { buildingPieces } from "../buildings.ts"
import { linePieces } from "../lines.ts"
import { railPieces } from "../rail.ts"
import { lampPieces } from "../sky/lamps.ts"
import { stationPieces } from "../stations.ts"
import { assertChunkCut } from "./chunk-cut.ts"

// Map check (pnpm test:map): every piece and chunk of the map; rail.test.ts checks those by Monzone station.
test("rail, stations, roads and rivers, lamps and buildings: a chunk build keeps exactly its cut of the whole-map build", () => {
  const lines = linePieces()
  for (const list of [railPieces(lines), stationPieces(), lines, lampPieces(), buildingPieces()]) {
    const built = assertChunkCut(list)
    assert.ok(built >= 5, `${built} chunks hold some`)
  }
})
