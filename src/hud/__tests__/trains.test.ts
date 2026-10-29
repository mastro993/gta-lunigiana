import assert from "node:assert/strict"
import { test } from "node:test"

import { SetTrains, TrainView, type TrainViewModel } from "../../sim/index.ts"
import { entryClear } from "../../sim/rail/dispatch.ts"
import { LINES, speedAt } from "../../sim/rail/lines.ts"
import { trainLength } from "../../sim/rail/models.ts"
import { trainDraft } from "../../sim/rail/service.ts"
import { placeTrains, railStep } from "../../sim/rail/testing.ts"
import { start } from "../../sim/testing.ts"
import { makeTrainStore } from "../trains.ts"

type Train = TrainViewModel["trains"][number]

/** A train on `line` driven by `driver`, standing at s 0. */
const train = (id: number, line: number, driver: Train["driver"]): Train => ({
  id,
  label: "ATR 220 Swing",
  line,
  s: 0,
  v: 0,
  facing: 1,
  state: driver === "ai" ? "run" : undefined,
  next: undefined,
  driver,
  stolen: driver !== "ai",
})

/**
 * Four lines: an AI train runs on line 0, line 1's next train is due in 95 s, the player has line 2's (none due), and line 3's is
 * due already.
 */
const RAILWAY: TrainViewModel = {
  lines: [
    { due: null, from: 0 },
    { due: 95, from: 1 },
    { due: null, from: 0 },
    { due: 0, from: 1 },
  ],
  trains: [train(7, 0, "ai"), train(9, 2, "player")],
  crossings: [],
}

/** A store over a fake game whose railway stays `game` until `become` moves it, as the real one's does until its next step: what the store sends is collected. */
const fakes = (game: TrainViewModel = RAILWAY) => {
  const sent: Array<{ readonly call: true }> = []
  let now = game
  const store = makeTrainStore({ read: () => now, send: (request) => void sent.push(request) })
  return { store, sent, become: (next: TrainViewModel) => void (now = next) }
}

test("a new store shows the game's railway and sends nothing", () => {
  const { store, sent } = fakes()
  assert.deepEqual([store.now(), sent], [RAILWAY, []])
})

// The game takes a call only on its next step, never while the full map or the settings pause it: read from the game, the menu open
// over the map would show no train called.
test("a call goes once each time, and until the game steps every line no AI train runs on reads its next train due now, as the sim's rule has it", () => {
  const { store, sent } = fakes()
  store.call()
  assert.deepEqual(sent, [{ call: true }])
  assert.deepEqual(store.now().lines, [
    { due: null, from: 0 },
    { due: 0, from: 1 },
    { due: 0, from: 0 },
    { due: 0, from: 1 },
  ])
  assert.deepEqual([store.now().trains, store.now().crossings], [RAILWAY.trains, RAILWAY.crossings])
  store.call()
  assert.deepEqual(sent, [{ call: true }, { call: true }])
})

test("once the game has stepped the store shows the game's railway again, whatever it holds", () => {
  const { store, become } = fakes()
  store.call()
  const later = { ...RAILWAY, lines: RAILWAY.lines.map((line) => ({ ...line, due: 30 })) }
  become(later)
  assert.deepEqual(store.now(), later, "a step since the call: the game's own")
  become(RAILWAY)
  assert.deepEqual(store.now(), RAILWAY, "and it stays the game's")
})

test("over a real game, a call reads before the step as the game holds it after: the line's train due now, held back by a train in its way", () => {
  const game = start([], undefined, { trains: true }),
    line = LINES[0]!,
    length = trainLength("atr220"),
    nose = line.start + length
  // A train with no driver standing just inside the entering train's clearance, so the train called stays due.
  const standing = trainDraft("atr220", {
    line: line.index,
    s: nose + entryClear(speedAt(line, nose)) - 1 + length,
    facing: 1,
    v: 0,
  })
  assert.ok(game.runtime.tick(placeTrains([standing])).ok)
  const read = () => game.runtime.inspect(TrainView)
  const store = makeTrainStore({ read, send: (request) => game.runtime.send(SetTrains, request) })
  assert.equal(read().lines[line.index]!.due, null, "none due: setup's trains are gone")
  store.call()
  const shown = store.now()
  assert.equal(shown.lines[line.index]!.due, 0)
  assert.equal(read().lines[line.index]!.due, null, "the game has not taken it yet")
  assert.ok(game.runtime.tick(railStep).ok)
  assert.deepEqual(read().lines, shown.lines)
  assert.deepEqual(store.now(), read())
})
