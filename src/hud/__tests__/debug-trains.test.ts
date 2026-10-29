import assert from "node:assert/strict"
import { test } from "node:test"

import type { TrainViewModel } from "../../sim/index.ts"
import { MAP } from "../../sim/map/index.ts"
import { LINES } from "../../sim/rail/lines.ts"
import { TRAINS } from "../../sim/rail/models.ts"
import {
  crossingName,
  crossingText,
  dueText,
  endName,
  lineName,
  trainText,
  waitText,
} from "../debug-trains.ts"

type Train = TrainViewModel["trains"][number]
type Crossing = TrainViewModel["crossings"][number]

/** The names of each line's stations, read from the map, so the tests follow any railway it holds. */
const stations = (line: number) =>
  LINES[line]!.stations.map((station) => MAP.railway.stations[station]!.name)

test("each line is named by its first and last stations, and its ends by the station nearest each", () => {
  assert.ok(
    LINES.some((line) => stations(line.index).length > 1),
    "a line on the map calls at two stations or more",
  )
  for (const line of LINES) {
    const names = stations(line.index)
    if (names.length === 0) continue
    assert.equal(
      lineName(line.index),
      names.length === 1 ? names[0] : `${names[0]} – ${names.at(-1)}`,
    )
    assert.equal(endName(line.index, 0), `the ${names[0]} end`)
    assert.equal(endName(line.index, 1), `the ${names.at(-1)} end`)
  }
  // A line the map does not hold has no station to name it by.
  assert.deepEqual(
    [lineName(LINES.length), endName(LINES.length, 0), endName(LINES.length, 1)],
    ["", "its start", "its end"],
  )
})

test("a wait reads in whole seconds rounded up, and minutes from one", () => {
  assert.deepEqual(
    [waitText(0), waitText(0.2), waitText(44.1), waitText(60), waitText(125), waitText(179.4)],
    ["0 s", "1 s", "45 s", "1 min", "2 min 5 s", "3 min"],
  )
})

test("a line's next train reads when it is due and the end it enters from, or why none is", () => {
  const end = endName(0, 1)
  assert.equal(dueText(0, 95.2, 1, false), `due in 1 min 36 s, from ${end}`)
  assert.equal(dueText(0, 0, 1, false), `due now, from ${end}`, "it enters once the line is clear")
  assert.equal(dueText(0, null, 0, true), "a train runs on it")
  assert.equal(dueText(0, null, 0, false), "none due", "the player has its train")
})

/** An AI train running toward the line's end at 80 km/h, past its first station. */
const running: Train = {
  id: 41,
  label: TRAINS.atr220.label,
  line: 0,
  s: 6703.4,
  v: 80 / 3.6,
  facing: 1,
  state: "run",
  next: "Gragnola",
  driver: "ai",
  stolen: false,
}

test("a train reads its model, line and place, its speed the way it faces, who drives it and where it calls next", () => {
  const end = endName(0, 1),
    start = endName(0, 0)
  assert.equal(
    trainText(running),
    `${TRAINS.atr220.label}, line 0 at km 6.703: 80 km/h forward, facing ${end}; AI driver, running; next Gragnola`,
  )
  assert.equal(
    trainText({ ...running, v: 0, state: "dwell", next: "Monzone" }),
    `${TRAINS.atr220.label}, line 0 at km 6.703: standing, facing ${end}; AI driver, dwelling; at Monzone`,
    "a train standing at its stop is at it",
  )
  assert.equal(
    trainText({ ...running, v: 0, state: "horn" }).split("; ")[1],
    "AI driver, held up, sounding the horn",
  )
  // The player's, its cab turned to face the line's start, backing up toward its end.
  assert.equal(
    trainText({
      ...running,
      v: 5,
      facing: -1,
      state: undefined,
      next: undefined,
      driver: "player",
      stolen: true,
    }),
    `${TRAINS.atr220.label}, line 0 at km 6.703: 18 km/h backing up, facing ${start}; you drive it, stolen; no station ahead`,
  )
  assert.equal(
    trainText({ ...running, v: 0, state: undefined, driver: "none", stolen: true }).split("; ")[1],
    "no driver, stolen",
  )
  // On a run-out, off either end of the line: how far beyond that end, never a negative km.
  const place = (s: number) => trainText({ ...running, s }).split(":")[0]
  assert.equal(place(-1066), `${TRAINS.atr220.label}, line 0 1.066 km short of ${start}`)
  assert.equal(place(LINES[0]!.length + 250), `${TRAINS.atr220.label}, line 0 0.250 km past ${end}`)
})

/** Via Riolo's crossing, closed, its arms down. */
const closed: Crossing = {
  x: 0,
  y: 0,
  road: "Via Riolo",
  walk: false,
  phase: "closed",
  arm: 1,
  lit: true,
  ringing: false,
}

test("a level crossing reads its road, its phase, its arms, its light and its bell; a foot crossing has none of them", () => {
  assert.equal(crossingName(closed), "Via Riolo")
  assert.equal(crossingText(closed), "closed: arms 100 % down, light on, bell off")
  assert.equal(
    crossingText({ ...closed, phase: "lowering", arm: 0.374, ringing: true }),
    "lowering: arms 37 % down, light on, bell ringing",
  )
  const foot = { ...closed, road: "", walk: true, phase: "warning" as const, arm: 0, lit: false }
  assert.equal(crossingName(foot), "Foot crossing")
  assert.equal(crossingText(foot), "warning; a foot crossing: no arms, light or bell")
  assert.equal(crossingName({ road: "", walk: false }), "Crossing")
})
