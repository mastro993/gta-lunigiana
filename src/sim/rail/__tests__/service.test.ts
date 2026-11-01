// The map with two lines on one track (two-lines.ts) is staged before any rail module loads; this file runs in a process of its own.
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  ahead,
  behind,
  bindings,
  CROSSINGS,
  entryClear,
  FillTrains,
  Game,
  KEEP_BEHIND,
  Keyboard,
  KeyboardInput,
  L,
  LENGTH,
  listener,
  makeRuntime,
  meet,
  placeTrains,
  railStep,
  railway,
  S,
  SetTrains,
  SHARED,
  sharedPart,
  trainDraft,
  TrainWorld,
} from "./two-lines.ts"

test("service, two lines on one track: the second runs the first's track the other way, run-outs and all, and every box holds both", () => {
  assert.ok(Math.abs(behind.length - L) < 1e-6)
  const parts = sharedPart(SHARED[1]![0]!, 100, 200)
  assert.ok(parts.every((p) => p.sign === -1))
  assert.ok(Math.abs(Math.min(...parts.map((p) => p.lo)) - (L - 200)) < 1e-6)
  assert.ok(Math.abs(Math.max(...parts.map((p) => p.hi)) - (L - 100)) < 1e-6)
  // Past line 0's end is the run-out before line 1's start.
  const [out] = sharedPart(SHARED[1]![0]!, L + 600, L + 700)
  assert.ok(Math.abs(out!.lo + 700) < 1e-6 && Math.abs(out!.hi + 600) < 1e-6 && out!.sign === -1)
  for (const box of CROSSINGS.filter((c) => c.on.length > 0)) {
    const [a, b] = box.on
    assert.deepEqual([a?.line, b?.line], [0, 1])
    assert.ok(Math.abs(b!.s - (L - a!.s)) < 0.01 && Math.abs(b!.half - a!.half) < 1e-9)
  }
})

test("service, two lines on one track: an AI train keeps KEEP_BEHIND m behind the other line's train standing ahead", () => {
  const game = railway()
  // Line 0's train stands facing +s at 5300; on line 1 it lies from L − 5300 to L − 5300 + its length.
  const near = L - 5300,
    s = near - 900
  assert.ok(
    game.runtime.tick(
      placeTrains([
        trainDraft("atr220", { line: 0, s: 5300, facing: 1, v: 0 }),
        trainDraft(
          "atr220",
          { line: 1, s, facing: 1, v: 20 },
          { dir: 1, stop: -1, state: "run", until: 0 },
        ),
      ]),
    ).ok,
  )
  game.step(90 * S)
  const ai = game.inspect().trains.find((t) => t.line === 1)!
  assert.equal(ai.v, 0)
  assert.ok(Math.abs(near - ai.s - KEEP_BEHIND) < 3, `${(near - ai.s).toFixed(2)} m behind it`)
})

test("service, two lines on one track: a box closes for the other line's train coming at it", () => {
  const index = CROSSINGS.findIndex((c) => !c.walk && c.on.length === 2),
    at = CROSSINGS[index]!.on[1]!
  const game = railway()
  // Line 1's train running on at its line speed, 1100 m short of the box.
  assert.ok(
    game.runtime.tick(
      placeTrains([
        trainDraft(
          "atr220",
          { line: 1, s: at.s - 1100, facing: 1, v: 80 / 3.6 },
          { dir: 1, stop: -1, state: "run", until: 0 },
        ),
      ]),
    ).ok,
  )
  const phases: Array<string> = []
  for (let frame = 0; frame < 80 * S; frame++) {
    assert.ok(game.runtime.tick(railStep).ok)
    const world = game.inspect(),
      { phase } = world.crossings[index]!,
      train = world.trains[0]!
    if (phases.at(-1) !== phase) phases.push(phase)
    if (Math.abs(train.s - at.s) <= at.half) assert.equal(phase, "closed", "down as it crosses")
  }
  assert.deepEqual(phases, ["open", "warning", "lowering", "closed", "raising", "open"])
})

test("service, two lines on one track: the dispatcher keeps a line's entry clear of the other line's train on their run-out", () => {
  // Line 0's train stands 700 m past its end, on line 1's run-out before its start.
  const game = railway()
  assert.ok(
    game.runtime.tick(placeTrains([trainDraft("atr220", { line: 0, s: L + 700, facing: 1, v: 0 })]))
      .ok,
  )
  assert.ok(-700 < behind.start + LENGTH + entryClear(80 / 3.6))
  game.runtime.send(SetTrains, { call: true })
  game.step(10 * S)
  assert.ok(!game.inspect().trains.some((t) => t.line === 1), "line 1's train waits")
  assert.ok(game.runtime.tick(placeTrains([])).ok)
  game.step(1)
  assert.ok(
    game.inspect().trains.some((t) => t.line === 1 && t.run !== undefined),
    "then enters",
  )
})

test("service, two lines on one track: trains of the two lines meeting on it strike each other there, neither passing through", () => {
  const game = railway()
  // Line 0's train stands facing +s at 5300; line 1's coasts at it at 10 m/s from 40 m off.
  const near = L - 5300
  assert.ok(
    game.runtime.tick(
      placeTrains([
        trainDraft("atr220", { line: 0, s: 5300, facing: 1, v: 0 }),
        trainDraft("atr220", { line: 1, s: near - 40, facing: 1, v: 10 }),
      ]),
    ).ok,
  )
  const hits: Array<{ hit: string; speed: number }> = [],
    listen = listener(hits)
  let deepest = 0,
    shoved = 0
  for (let frame = 0; frame < 40 * S; frame++) {
    assert.ok(game.runtime.tick(railStep, listen).ok)
    const trains = game.inspect().trains,
      a = trains.find((t) => t.line === 0)!,
      b = trains.find((t) => t.line === 1)!
    // Line 0's body on line 1 runs from L − a.s to L − a.s + its length.
    deepest = Math.max(deepest, b.s - (L - a.s))
    shoved = Math.min(shoved, a.v)
  }
  assert.ok(deepest < 0.01, `${deepest} m into it`)
  assert.ok(shoved < -1, "line 0's train shoved back along its line")
  assert.equal(hits.length, 1)
  assert.ok(hits[0]!.hit === "train" && hits[0]!.speed > 8, `at ${hits[0]!.speed} m/s`)
})

test("service, two lines on one track: a new game stands their first trains on platforms apart, and neither moves in the first step", () => {
  for (let seed = 1; seed <= 3; seed++) {
    const made = makeRuntime({
      seed,
      services: Game.Runtime.services(
        Game.Runtime.service(KeyboardInput, Keyboard.scripted(bindings, [])),
      ),
    })
    assert.ok(made.ok)
    const runtime = made.value
    assert.ok(runtime.tick(Game.Schedule(FillTrains, Game.Schedule.applyDeferred())).ok)
    const placed = runtime.inspect(TrainWorld).trains
    assert.deepEqual(
      placed.map((t) => [t.line, t.run?.state]),
      [
        [0, "dwell"],
        [1, "dwell"],
      ],
    )
    // Line 1's train on line 0's s: its ends mirrored.
    const [a, b] = placed as [(typeof placed)[number], (typeof placed)[number]]
    const span = (lo: number, hi: number) => [Math.min(lo, hi), Math.max(lo, hi)] as const
    const [alo, ahi] = span(a.s, a.s - a.facing * LENGTH),
      [blo, bhi] = span(L - b.s, L - (b.s - b.facing * LENGTH))
    assert.ok(bhi + KEEP_BEHIND < alo || ahi + KEEP_BEHIND < blo, `seed ${seed}: apart`)
    assert.ok(runtime.tick(railStep).ok)
    assert.deepEqual(
      runtime.inspect(TrainWorld).trains.map((t) => [t.s, t.v]),
      placed.map((t) => [t.s, t.v]),
      `seed ${seed}: standing`,
    )
  }
})

test("service, two lines on one track: AI trains of the two lines running at each other both brake to a stand KEEP_BEHIND m apart, striking nothing", () => {
  const game = railway()
  // Line 0's runs toward +s from 3000 and line 1's toward the same point from 1500 m beyond it, both at 20 m/s.
  const run = { dir: 1, stop: -1, state: "run", until: 0 } as const
  assert.ok(
    game.runtime.tick(
      placeTrains([
        trainDraft("atr220", { line: 0, s: 3000, facing: 1, v: 20 }, run),
        trainDraft("atr220", { line: 1, s: L - 4500, facing: 1, v: 20 }, run),
      ]),
    ).ok,
  )
  const hits: Array<{ hit: string; speed: number }> = [],
    listen = listener(hits)
  for (let frame = 0; frame < 120 * S; frame++) assert.ok(game.runtime.tick(railStep, listen).ok)
  const trains = game.inspect().trains,
    a = trains.find((t) => t.line === 0)!,
    b = trains.find((t) => t.line === 1)!
  assert.deepEqual(hits, [])
  assert.deepEqual([a.v, b.v], [0, 0])
  // Line 1's nose on line 0 is at L − b.s.
  const apart = L - b.s - a.s
  assert.ok(Math.abs(apart - KEEP_BEHIND) < 1, `${apart.toFixed(2)} m apart`)
})

test("service, two lines on one track: the dispatcher lets no train in toward the other line's AI train running at its end", () => {
  // Line 0's AI train runs on toward its end, line 1's start, far beyond the reach of line 1's entry.
  const game = railway()
  assert.ok(
    game.runtime.tick(
      placeTrains([
        trainDraft(
          "atr220",
          { line: 0, s: 5000, facing: 1, v: 0 },
          { dir: 1, stop: -1, state: "dwell", until: 60 * S },
        ),
      ]),
    ).ok,
  )
  assert.ok(L - 5000 > behind.start + LENGTH + entryClear(80 / 3.6))
  game.runtime.send(SetTrains, { call: true })
  game.step(10 * S)
  assert.ok(!game.inspect().trains.some((t) => t.line === 1), "line 1's train waits")
  assert.ok(game.runtime.tick(placeTrains([])).ok)
  game.step(1)
  assert.ok(
    game.inspect().trains.some((t) => t.line === 1 && t.run !== undefined),
    "then enters",
  )
})

test("service, two lines on one track: it is one stretch, and two trains overlapping across a piece joint are pushed apart just to touch", () => {
  assert.equal(SHARED[0]![1]!.length, 1, "unbroken from run-out to run-out")
  // Line 0's train ahead of line 1's, their bodies 0.2 m into each other over the joint at the end of a piece.
  const joint = ahead.runs.find((run) => run.key >= 0 && run.from > 3000)!.from,
    x = joint - 0.1
  const out = meet([
    { id: 1, line: 0, s: x + 0.2, v: 5, facing: 1, length: LENGTH, mass: 108000 },
    { id: 2, line: 1, s: L - x, v: 0, facing: 1, length: LENGTH, mass: 108000 },
  ])
  const [a, b] = out.trains as [(typeof out.trains)[number], (typeof out.trains)[number]]
  // b's body on line 0 starts at L − b.s.
  assert.ok(Math.abs(L - b.s - a.s) < 1e-6, `${(L - b.s - a.s).toFixed(3)} m apart`)
})
