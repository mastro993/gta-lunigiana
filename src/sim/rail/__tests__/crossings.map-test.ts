import { test } from "node:test"

import {
  checkBoxes,
  checkBoxLines,
  checkLevels,
  checkPairs,
  railwayAround,
} from "./railway-checks.ts"

// Map checks (pnpm test:map): every level crossing of the map; crossings.test.ts checks those by
// Monzone station.
const ALL = railwayAround()

test("crossings: every box holds every line crossing it at grade, at the map's s, its carriageway's reach and its strike-in", () => {
  checkBoxLines(ALL.boxes)
})

test("crossings: a line on a bridge over a road crosses nothing there; at every box's nodes the line it crosses is at grade", () => {
  checkLevels(ALL)
})

test("crossings: every box's stop lines, arms and approaches, every foot crossing armless", () => {
  checkBoxes(ALL.boxes, 8)
})

test("crossings: with two boxes along one road, each traffic step leads into the box it reaches first, for every box", () => {
  checkPairs(ALL.boxes)
})
