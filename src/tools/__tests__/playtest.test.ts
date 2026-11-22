import assert from "node:assert/strict"
import { test } from "node:test"
import { runInNewContext } from "node:vm"

import { haltOf, spotScript, startOnScript, STOPPED_SCRIPT } from "../playtest.ts"

test("spotScript: pins the focus on the ground (render y = elevation − 200, z = −north) and the zoom when given", () => {
  const view = {
    focus: { x: 0, y: 0, z: 0, set: (): unknown => undefined },
    texelsPerMetre: 8,
  }
  const body = {
    children: [
      { id: "game", style: { visibility: "" } },
      { id: "hud", style: { visibility: "" } },
    ],
  }
  const gta = { view, heightAt: (x: number, y: number) => 300 + x / 100 + y / 1000 }
  const run = (script: string): unknown => runInNewContext(script, { gta, document: { body } })
  assert.equal(run(spotScript({ kind: "spot", name: "a", x: 100, y: -2000, zoom: 4 })), 299)
  assert.deepEqual([view.focus.x, view.focus.y, view.focus.z], [100, 99, 2000])
  assert.deepEqual(
    body.children.map((el) => el.style.visibility),
    ["", "hidden"],
  )
  // The game's frame writes neither the focus nor the pinned zoom.
  view.focus.set()
  view.texelsPerMetre = 7
  assert.equal(view.texelsPerMetre, 4)
  assert.deepEqual([view.focus.x, view.focus.y, view.focus.z], [100, 99, 2000])
  // A spot without a zoom frees it again.
  run(spotScript({ kind: "spot", name: "b", x: 0, y: 0 }))
  view.texelsPerMetre = 6
  assert.equal(view.texelsPerMetre, 6)
  assert.deepEqual([view.focus.x, view.focus.y, view.focus.z], [0, 100, 0])
})

test("startOnScript moves the page's clock to the day asked, at the same time of day, still running", () => {
  const read = runInNewContext(
    `${startOnScript({ year: 2027, month: 3, day: 1 })}
    const a = new Date(), t = Date.now()
    ;[a.getFullYear(), a.getMonth() + 1, a.getDate(), Math.abs(t - a.getTime()) < 1000, new Date(0).getTime()]`,
  ) as Array<unknown>
  assert.deepEqual([...read], [2027, 3, 1, true, 0])
})

// Regression: the bot listened only for Runtime.exceptionThrown, but the game loop catches what a frame throws and logs it, so a
// seam drive that stopped on "map tile -7_-4 not loaded" 68 s in drove on and reported as if it had run.
test('haltOf: the game\'s console.error "game stopped" and its error is a halt; any other console call is not', () => {
  const error = {
    type: "object",
    subtype: "error",
    description: "Error: map tile -7_-4 not loaded\n    at tileAt (tiles.ts:186:33)",
  }
  assert.equal(
    haltOf({ type: "error", args: [{ type: "string", value: "game stopped" }, error] }),
    "game stopped Error: map tile -7_-4 not loaded\n    at tileAt (tiles.ts:186:33)",
  )
  assert.equal(
    haltOf({ type: "error", args: [{ type: "string", value: "start-up failed" }, error] }),
    undefined,
  )
  assert.equal(
    haltOf({ type: "log", args: [{ type: "string", value: "game stopped" }] }),
    undefined,
  )
  assert.equal(haltOf({ type: "error", args: [error] }), undefined)
  assert.equal(haltOf({ type: "error" }), undefined)
})

test("STOPPED_SCRIPT: the Stopped card's reason once it is back over the game with its error, else empty", () => {
  const card = (title: boolean, error: boolean) => {
    const elements: Record<string, { hidden: boolean; textContent: string }> = {
      title: { hidden: !title, textContent: "" },
      "title-error": { hidden: !error, textContent: "The game stopped: map tile 0_1 not loaded" },
    }
    return runInNewContext(STOPPED_SCRIPT, {
      document: { getElementById: (id: string) => elements[id] ?? null },
    }) as string
  }
  assert.equal(card(true, true), "The game stopped: map tile 0_1 not loaded")
  assert.equal(card(false, false), "", "playing")
  assert.equal(card(true, false), "", "the card up at the start, before any error")
})
