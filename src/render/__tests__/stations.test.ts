import assert from "node:assert/strict"
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

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }
/** The stations within 4 km of Monzone station (Monzone's, Gragnola's and Equi Terme's); stations.map-test.ts checks the whole map's. */
const HERE = stationsNear(STATION, 4000)

test("platforms, by Monzone station: the top follows the rail profile, within 2 cm of the map's platform top (the rail head + 0.25 m) all along", () => {
  assert.ok(HERE.stations.length >= 3, `${HERE.stations.length} stations`)
  checkTops(HERE)
})

test("platforms, by Monzone station: a yellow line along the edges beside running track or a loop, on every platform people wait on, and on no walkway", () => {
  checkYellowLines(HERE)
})

test("stations, by Monzone station: nothing they draw stands in a train's way: clear of its half width by 0.15 m from 0.3 m over the rail head to over its roof", () => {
  checkTrainsClear(HERE)
})

test("name boards, by Monzone station: one RFI-blue board per platform people wait on, standing on it, its words in white", () => {
  checkBoards(HERE)
})

test("platform lamps, by Monzone station: poles on the platforms people wait on, every platform lit, Equi Terme's too (no street lamp within 60 m of it)", () => {
  checkPlatformLamps(HERE)
})

// Regression: which station had which canopy was a table of this map's station names in render code.
test("canopies, by Monzone station: one along a station building's track side wherever a platform runs along it (Gragnola's), none elsewhere", () => {
  checkCanopies(HERE)
})

// Regression: a table keyed by two of this map's station names decided which station drew which canopy.
test("no render code names the stations by Monzone station: each is drawn from the map's data alone", () => {
  checkNoStationNamed(HERE)
})
