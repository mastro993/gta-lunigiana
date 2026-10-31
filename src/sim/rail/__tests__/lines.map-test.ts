import { test } from "node:test"

import {
  checkAtTheirS,
  checkLinesNear,
  checkNoSharedTrack,
  checkStops,
  checkTerminals,
  railwayAround,
} from "./railway-checks.ts"

// Map checks (pnpm test:map): every line, level crossing and station of the map; lines.test.ts
// checks those by Monzone station.
const ALL = railwayAround()

test("lines: every line runs its pieces terminal to terminal from s 0, then its run-out straight on past each, level", () => {
  checkTerminals(ALL.lines)
})

test("lines: every crossing and station lies at its s, the rail head RAIL_LIFT over the bed, and a box's road meets the rail at its level", () => {
  checkAtTheirS(ALL)
})

test("lines: linesNear finds every line's s and the distance off it, and nothing out of reach", () => {
  checkLinesNear(ALL.lines)
})

test("lines: on every line a train stops centred on the platforms and calls next at the first station ahead", () => {
  checkStops(ALL.lines)
})

test("lines: no two of the map's lines share track today", () => {
  checkNoSharedTrack(ALL.lines)
})
