import assert from "node:assert/strict"
import { test } from "node:test"

import { SPRINT_SPEED, WALK_SPEED } from "../../../sim/tuning.ts"
import { unit } from "../graph.ts"
import { chirpRate, cricketsQuiet, echemeRate } from "../nature.ts"
import { stepRate } from "../steps.ts"
import { VEHICLE_SHOTS, VEHICLE_VOICES } from "../vehicles.ts"
import { WORLD_SHOTS, WORLD_VOICES } from "../world.ts"

test("the world synths load in Node: no Web Audio at module top level", () => {
  assert.deepEqual(Object.keys(WORLD_VOICES).sort(), [
    "crickets",
    "plBell",
    "rain",
    "roof",
    "water",
    "wind",
  ])
  assert.deepEqual(Object.keys(WORLD_SHOTS).sort(), [
    "bark",
    "bell",
    "bird",
    "groan",
    "grunt",
    "hiss",
    "meow",
    "moo",
    "scream",
    "squeal",
    "step",
    "talk",
    "thunder",
    "yell",
    "yelp",
  ])
})

test("the vehicle and train synths load in Node too", () => {
  assert.deepEqual(Object.keys(VEHICLE_VOICES).sort(), [
    "beeper",
    "brakes",
    "engine",
    "fire",
    "horn",
    "rails",
    "scrape",
    "siren",
    "trainHorn",
    "tyres",
  ])
  assert.deepEqual(Object.keys(VEHICLE_SHOTS).sort(), [
    "clunk",
    "crash",
    "door",
    "explosion",
    "honk",
    "ignition",
    "thud",
    "trainHonk",
  ])
})

test("footsteps fall twice a second at a walk and three times at a sprint", () => {
  assert.equal(stepRate(WALK_SPEED), 2)
  assert.ok(Math.abs(stepRate(SPRINT_SPEED) - 3) < 1e-9)
  assert.ok(stepRate(0.5) < stepRate(WALK_SPEED))
  assert.equal(stepRate(20), 3.4)
})

test("synth params clamp to 0…1, NaN to silence rather than a throwing AudioParam", () => {
  assert.deepEqual([-1, 0.3, 2, Number.NaN].map(unit), [0, 0.3, 1, 0])
})

test("the crickets' masking law follows the voice: 0 dB under at full density, about 12 dB under at the sparsest", () => {
  assert.equal(cricketsQuiet(1), 0)
  assert.ok(
    Math.abs(cricketsQuiet(0.5) - 4.9) < 0.1 && Math.abs(cricketsQuiet(0.1) - 11.7) < 0.1,
    `${cricketsQuiet(0.5)} ${cricketsQuiet(0.1)}`,
  )
  assert.ok(cricketsQuiet(0.01) < 12.2)
})

test("tree crickets chirp once a second at 22 °C, slower in a 15 °C afternoon, not at all in the cold", () => {
  assert.ok(Math.abs(echemeRate(22) - 1) < 1e-9)
  assert.ok(echemeRate(15) > 0 && echemeRate(15) < 1)
  assert.equal(echemeRate(9), 0)
})

test("a cricket voice held in the cold still chirps at the 10 °C rate: its next chirp is never Infinity s away", () => {
  // Regression: at a rate of 0 the singers scheduled their next echeme at now + x / 0 and never sang again once the air warmed.
  for (const celsius of [-5, 0, 9.9, Number.NaN]) assert.equal(chirpRate(celsius), echemeRate(10))
  assert.equal(chirpRate(22), echemeRate(22))
  assert.ok(chirpRate(25) > chirpRate(15) && Number.isFinite(1 / chirpRate(-40)))
})
