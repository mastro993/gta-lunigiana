import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { Clock, type FixedLoop, Result } from "@typeonce/ritmo"

import { DEFAULT_START, SetClock, SkyView } from "../../sim/index.ts"
import { start } from "../../sim/testing.ts"
import { clockText } from "../clock.ts"
import { startGuardedLoop } from "../hud.ts"
import { crashed, holdClock, titleReady } from "../title.ts"

const html = readFileSync(new URL("../../../index.html", import.meta.url), "utf8")
const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8")
/** Whether index.html's markup hides the element with `id` before any script runs. */
const hiddenAtLoad = (id: string) => new RegExp(`id="${id}"[^>]*\\shidden[\\s>]`).test(html)

/** The title card's elements as plain event targets, as index.html starts them, in a window whose events tests dispatch. */
const page = () => {
  const nodes = new Map(
    [
      "title",
      "title-load",
      "title-go",
      "title-step",
      "title-detail",
      "title-error",
      "title-retry",
    ].map((id) => [
      id,
      Object.assign(new EventTarget(), { hidden: hiddenAtLoad(id), textContent: "", focus() {} }),
    ]),
  )
  const window = Object.assign(new EventTarget(), {
    document: { getElementById: (id: string) => nodes.get(id) ?? null },
  })
  return { window: window as unknown as Window, node: (id: string) => nodes.get(id)! }
}

// Regression: the card said "Press any key" while the game was still downloading, and keys did nothing.
test("the card shows the bar until the game is ready, then asks for a key and hides on the first one", () => {
  const { window, node } = page()
  assert.deepEqual(
    [node("title").hidden, node("title-load").hidden, node("title-go").hidden],
    [false, false, true],
    "loading: the bar, no Press any key",
  )
  let dismissed = 0
  titleReady(window, () => dismissed++)
  assert.deepEqual(
    [node("title-load").hidden, node("title-go").hidden, dismissed],
    [true, false, 0],
    "ready: Press any key",
  )
  window.dispatchEvent(new Event("keydown"))
  node("title").dispatchEvent(new Event("click"))
  assert.deepEqual([node("title").hidden, dismissed], [true, 1], "hidden by the first, once")
})

// A player who waited on the card started minutes after 08:00, the weather already moving: the clock ran behind it.
test("the game clock stands still behind the title card, the world moving on: the game starts at 08:00 as the player dismisses it", () => {
  const { runtime, run, world } = start()
  // As main.ts: held after setup, released by the key that dismisses the card.
  const release = holdClock((request) => runtime.send(SetClock, request))
  const { window, node } = page()
  titleReady(window, release)
  const cars = world()
    .vehicles.filter((car) => car.traffic)
    .map(({ x, y }) => ({ x, y }))
  run(5 * 60)
  const under = runtime.inspect(SkyView)
  assert.deepEqual(
    [under.seconds, clockText(under.local.hour * 3600 + under.local.minute * 60)],
    [DEFAULT_START, "08:00"],
    "the HUD clock under the card",
  )
  assert.notDeepEqual(
    world()
      .vehicles.filter((car) => car.traffic)
      .map(({ x, y }) => ({ x, y })),
    cars,
    "traffic drove on behind the card",
  )
  window.dispatchEvent(new Event("keydown"))
  assert.equal(node("title").hidden, true)
  run(60)
  assert.deepEqual(
    world().clock,
    { seconds: DEFAULT_START + 60, rate: 1 },
    "from 08:00:00 as the card went, a game minute a real second",
  )
})

// Regression: a throw in a frame left the last frame frozen on screen, the error only in the console.
test("a frame that throws puts the card back with the error and a reload, and no key hides it", (t) => {
  const logged = t.mock.method(console, "error", () => {})
  const { window, node } = page()
  titleReady(window, () => {})
  // As main.ts: the loop starts behind "Press any key", and a halt puts the card back.
  let onTick: (tick: FixedLoop.Tick) => void = () => {}
  let frames = 0
  startGuardedLoop(
    {
      source: { subscribe: (next) => ((onTick = next), { stop: () => {} }) },
      step: Clock.hz(60),
      maxFrameSeconds: 0.25,
      maxStepsPerFrame: 5,
      update: () => Result.success(undefined),
      render: () => {
        frames++
        throw new Error("boom")
      },
    },
    (error) => crashed(window.document, error),
  )
  onTick({ deltaMS: 16 })
  onTick({ deltaMS: 16 })
  window.dispatchEvent(new Event("keydown"))
  node("title").dispatchEvent(new Event("click"))
  assert.deepEqual(
    [node("title").hidden, node("title-go").hidden, node("title-load").hidden],
    [false, true, false],
    "the card is up, without Press any key, after a key and a click",
  )
  assert.deepEqual(
    [node("title-step").textContent, node("title-error").textContent, node("title-retry").hidden],
    ["Stopped", "The game stopped: boom", false],
  )
  assert.equal(frames, 1, "no frame after the throw")
  assert.equal(logged.mock.callCount(), 1, "logged once")
})

// Regression: hidden on the press, the card let the tap's click land on the minimap under it, which opened the map.
test("a tap hides the card on its click, not its press, so the click lands on the card", () => {
  const { window, node } = page()
  let dismissed = 0
  titleReady(window, () => dismissed++)
  window.dispatchEvent(new Event("pointerdown"))
  assert.equal(node("title").hidden, false, "pressed: still showing")
  node("title").dispatchEvent(new Event("click"))
  assert.deepEqual([node("title").hidden, dismissed], [true, 1])
})

// The opening warning should only say the game is early, not that it crashes or is rough.
test("the opening warning only says the game is in early development", () => {
  const warning = readme.match(/> \[!WARNING\]\n(?:> .+\n)+/)?.[0] ?? ""
  assert.match(html, /Il gioco è in fase di sviluppo iniziale/)
  assert.match(html, /early development/)
  assert.match(warning, /is in early development/)
  for (const [name, text] of [
    ["title card", html],
    ["README warning", warning],
  ] as const) {
    assert.doesNotMatch(text, /\bbugs?\b|\bcrashes?\b|\brough edges\b|\bglitch/i, name)
  }
})
