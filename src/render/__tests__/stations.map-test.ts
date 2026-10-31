import { test } from "node:test"

import {
  checkBoards,
  checkCanopies,
  checkNoStationNamed,
  checkPlatformLamps,
  checkTops,
  checkTrainsClear,
  checkYellowLines,
  stationsNear,
} from "./station-checks.ts"

// Map checks (pnpm test:map): every platform and station of the map; stations.test.ts checks those
// by Monzone station.
const ALL = stationsNear()

test("platforms: every platform's top follows the rail profile, within 2 cm of the map's platform top all along", () => {
  checkTops(ALL)
})

test("platforms: a yellow line beside running track or a loop on every platform people wait on, and on no walkway", () => {
  checkYellowLines(ALL)
})

test("stations: nothing any of them draws stands in a train's way", () => {
  checkTrainsClear(ALL)
})

test("name boards: one RFI-blue board on every platform people wait on", () => {
  checkBoards(ALL)
})

test("platform lamps: poles on every platform people wait on, every one lit, Equi Terme's too", () => {
  checkPlatformLamps(ALL)
})

test("canopies: one along a station building's track side wherever a platform runs along it (Gragnola's), none elsewhere on the map", () => {
  checkCanopies(ALL)
})

test("no render code names any of the map's stations", () => {
  checkNoStationNamed(ALL)
})
