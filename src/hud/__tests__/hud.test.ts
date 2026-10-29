import assert from "node:assert/strict"
import { test } from "node:test"

import { Keyboard } from "@typeonce/ritmo-browser"

import { bindings, type PlayerViewModel } from "../../sim/index.ts"
import { BOARD_SPEED } from "../../sim/rail/boarding.ts"
import { TRAINS } from "../../sim/rail/models.ts"
import { QUARTER, screenAxes } from "../../sim/view.ts"
import { kmh, overlayKey, type Overlays, pausable, promptText, routeOverlayKeys } from "../hud.ts"
import { minimapRotation } from "../minimap.ts"

const pose = { x: 0, y: 0, angle: 0 }
const view = (patch: Partial<PlayerViewModel>): PlayerViewModel => ({
  prev: pose,
  pose,
  velocity: { x: 0, y: 0 },
  mode: "foot",
  vehicle: undefined,
  nearby: undefined,
  turns: 0,
  ...patch,
})

test("the prompt names the action the key would take", () => {
  assert.equal(promptText(view({})), "")
  assert.equal(
    promptText(view({ nearby: { label: "Fiat Panda", occupied: false, stolen: false } })),
    "F — steal Fiat Panda",
  )
  assert.equal(
    promptText(view({ nearby: { label: "Fiat Panda", occupied: false, stolen: true } })),
    "F — enter Fiat Panda",
  )
  assert.equal(
    promptText(view({ nearby: { label: "Piaggio Ape", occupied: true, stolen: false } })),
    "F — carjack Piaggio Ape",
  )
  assert.equal(
    promptText(view({ mode: "driving", vehicle: { label: "Fiat Panda", speed: 3 } })),
    "F — exit",
  )
  assert.equal(
    promptText(
      view({ mode: "down", nearby: { label: "Fiat Panda", occupied: false, stolen: false } }),
    ),
    "",
  )
  assert.equal(
    promptText(
      view({ mode: "dead", nearby: { label: "Fiat Panda", occupied: false, stolen: false } }),
    ),
    "",
  )
})

test("speed reads in whole km/h, reversing included", () => {
  assert.equal(kmh(10), 36)
  assert.equal(kmh(-2.5), 9)
})

test("a train reads as a car does: the prompt names it to take, then offers to get out", () => {
  const { label } = TRAINS.atr220
  assert.equal(
    promptText(view({ nearby: { label, occupied: true, stolen: false } })),
    `F — carjack ${label}`,
  )
  assert.equal(
    promptText(view({ nearby: { label, occupied: false, stolen: true } })),
    `F — enter ${label}`,
  )
  const driving = view({ mode: "driving", vehicle: { label, speed: 0, kind: "train" }, z: 231.4 })
  assert.equal(promptText(driving), "F — exit")
  assert.equal(kmh(driving.vehicle!.speed), 0)
})

// Regression: a train lets you out only below BOARD_SPEED, but the prompt and the touch EXIT pad offered it at 34 km/h.
test("driving a train, the prompt offers to get out only while it is slow enough to leave, backing up too; a car at any speed", () => {
  const { label } = TRAINS.atr220
  const train = (speed: number) =>
    view({ mode: "driving", vehicle: { label, speed, kind: "train" } })
  assert.equal(promptText(train(BOARD_SPEED - 0.1)), "F — exit")
  assert.equal(promptText(train(-(BOARD_SPEED - 0.1))), "F — exit")
  assert.equal(promptText(train(BOARD_SPEED)), "")
  assert.equal(promptText(train(-8.3)), "", "backing up at 30 km/h")
  assert.equal(
    promptText(view({ mode: "driving", vehicle: { label: "Fiat Panda", speed: 30 } })),
    "F — exit",
  )
})

test("the minimap turns screen-up to the top, whichever way the view is turned", () => {
  for (const turns of [0, 1, 2, 3, -1]) {
    // North-up canvas vector of screen-up, rotated by the canvas transform (y grows downwards).
    const { up } = screenAxes(turns),
      r = minimapRotation(turns * QUARTER)
    const u = up.x,
      v = -up.y,
      c = Math.cos(r),
      s = Math.sin(r)
    assert.ok(Math.abs(u * c - v * s) < 1e-9, `turns ${turns}`)
    assert.ok(Math.abs(u * s + v * c + 1) < 1e-9, `turns ${turns}`)
  }
})

/** A keydown/keyup the way a browser fills it (Node's EventTarget has no KeyboardEvent). */
const keyEvent = (type: string, code: string, key: string, extra: object = {}) =>
  Object.assign(new Event(type, { cancelable: true }), {
    code,
    key,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extra,
  })

/** What `overlayKey` makes of a keydown of `key` at `code`, with the title card gone and nothing open unless `open` says so. */
const action = (code: string, key: string, extra: object = {}, open: Partial<Overlays> = {}) =>
  overlayKey(keyEvent("keydown", code, key, extra), {
    title: false,
    map: false,
    settings: false,
    ...open,
  })

test("M toggles the map by the character it types, or its place where the layout types no ASCII there; repeats and chords do nothing", () => {
  assert.equal(action("KeyM", "m"), "toggleMap")
  assert.equal(action("KeyM", "M"), "toggleMap", "Shift+M")
  assert.equal(action("KeyM", "m", {}, { map: true }), "toggleMap", "M closes the map too")
  assert.equal(action("Semicolon", "m"), "toggleMap", "AZERTY: the key labelled M")
  assert.equal(action("KeyM", ","), undefined, "AZERTY: the QWERTY M position types a comma")
  assert.equal(
    action("KeyM", "ь"),
    "toggleMap",
    "Cyrillic: no Latin letter, so the position counts",
  )
  for (const chord of [
    { repeat: true },
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true, key: "µ" },
  ])
    assert.equal(action("KeyM", "m", chord), undefined, JSON.stringify(chord))
  assert.equal(action("KeyW", "w"), undefined)
})

test("Esc closes the map when it is open, else opens or closes the settings; over the settings M does nothing", () => {
  assert.equal(action("Escape", "Escape"), "toggleSettings")
  assert.equal(action("Escape", "Escape", {}, { settings: true }), "toggleSettings")
  assert.equal(action("Escape", "Escape", {}, { map: true }), "closeMap")
  assert.equal(action("KeyM", "m", {}, { settings: true }), undefined)
  for (const chord of [{ repeat: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }])
    assert.equal(action("Escape", "Escape", chord), undefined, JSON.stringify(chord))
})

// The key that dismisses "Press any key" must not open the settings or the map behind the card.
test("no key opens anything while the title card is up", () => {
  for (const [code, key] of [
    ["Escape", "Escape"],
    ["KeyM", "m"],
  ] as const)
    assert.equal(action(code, key, {}, { title: true }), undefined, key)
})

// Regression: the Esc that opened the settings went on to its default, the browser closing the open dialog, so they never showed.
test("the overlay keys reach the window's listener: each keydown runs its action against the overlays' state then, and only its default is cancelled", () => {
  const host = new EventTarget(),
    calls: Array<string> = []
  let open: Overlays = { title: true, map: false, settings: false }
  routeOverlayKeys(host, {
    open: () => open,
    toggleMap: () => calls.push("map"),
    closeMap: () => calls.push("close"),
    toggleSettings: () => calls.push("settings"),
  })
  /** Whether the keydown's default is left to the browser. */
  const down = (code: string, key: string) => host.dispatchEvent(keyEvent("keydown", code, key))
  assert.equal(down("Escape", "Escape"), true, "the title card's: no action, the default stays")
  open = { ...open, title: false }
  assert.equal(down("Escape", "Escape"), false)
  assert.equal(down("KeyW", "w"), true)
  host.dispatchEvent(keyEvent("keyup", "Escape", "Escape"))
  open = { ...open, map: true }
  down("Escape", "Escape")
  assert.deepEqual(calls, ["settings", "close"])
})

// Regression: keys tapped while the map was open queued up and acted on resume (F stole a car).
test("pausing for the map or the settings drops taps made on it, keeps held keys held, and skips the sim", () => {
  const host = new EventTarget()
  const keyboard = Keyboard.actions(host as unknown as Window, bindings)
  let open = false,
    ticks = 0
  const update = pausable(
    () => open,
    keyboard,
    () => ++ticks,
    -1,
  )
  host.dispatchEvent(keyEvent("keydown", "KeyW", "w"))
  open = true
  host.dispatchEvent(keyEvent("keydown", "KeyF", "f"))
  host.dispatchEvent(keyEvent("keyup", "KeyF", "f"))
  assert.equal(update(), -1)
  assert.equal(ticks, 0)
  open = false
  assert.equal(update(), 1)
  const now = keyboard.snapshot()
  assert.equal(
    now.actions.action.pressed,
    false,
    "the F tapped on the map does not steal a car on resume",
  )
  assert.equal(now.actions.up.held, true, "W held through the pause is still held")
})
