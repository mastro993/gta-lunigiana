import assert from "node:assert/strict"
import { test } from "node:test"

import { CROSSINGS } from "../crossings.ts"
import {
  checkBoxes,
  checkBoxLines,
  checkLevels,
  checkPairs,
  railwayAround,
} from "./railway-checks.ts"

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }
/** The railway within 4 km of Monzone station: Monzone's, Gragnola's and Equi Terme's boxes; crossings.map-test.ts checks the whole map's. */
const HERE = railwayAround(STATION, 4000)

test("crossings, by Monzone station: each box holds every line crossing it at grade, at the map's s, its carriageway's reach along it and its strike-in at line speed", () => {
  assert.ok(HERE.boxes.length >= 4, `${HERE.boxes.length} boxes`)
  checkBoxLines(HERE.boxes)
})

test("crossings, by Monzone station: level-aware: a line on a bridge over a road crosses nothing there, though it passes right over it", () => {
  checkLevels(HERE)
})

test("crossings, by Monzone station: stop lines 3.5–4 m from the nearest track, arms on the right spanning the road, approaches leading in, the foot crossing armless", () => {
  assert.ok(
    HERE.boxes.some((i) => CROSSINGS[i]!.walk),
    "Equi Terme's foot crossing",
  )
  checkBoxes(HERE.boxes, 8)
})

test("crossings, by Monzone station: with two boxes along one road, each traffic step leads into the box it reaches first", () => {
  checkPairs(HERE.boxes)
})
