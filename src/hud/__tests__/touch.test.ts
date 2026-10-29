import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { Keyboard, Touch } from "@typeonce/ritmo-browser"

import { bindings, type PlayerViewModel } from "../../sim/index.ts"
import { BUTTONS, makeTouchControls, unturn, withTouch } from "../touch.ts"

type Snapshot = Keyboard.Snapshot<typeof bindings>
const held = (snapshot: Snapshot) =>
  Object.entries(snapshot.actions)
    .flatMap(([key, state]) => (state.held ? [key] : []))
    .sort()

test("the stick holds the arrow keys it leans to, eight ways, and the buttons press their own keys, the arrows' too", () => {
  const keyboard = Keyboard.scripted(bindings, [{ frame: 2, press: ["up"] }])
  const touch = Touch.scripted({ buttons: BUTTONS, sticks: ["move"] }, [
    { frame: 0, sticks: { move: { x: -0.6, y: -0.6 } } },
    { frame: 1, sticks: { move: { x: 0.3, y: -0.9 } } }, // 18° off straight up: up alone
    { frame: 2, sticks: { move: null }, press: ["action"], release: ["action"] }, // a tap shorter than a frame
    { frame: 3, press: ["handbrake"] },
    { frame: 4, press: ["left", "down"] }, // driving: ◀ and Brake
    { frame: 5, sticks: { move: { x: -1, y: 0 } }, release: ["left"] }, // a thumb on the stick still holds ◀'s key
  ])
  const controls = withTouch(keyboard, touch)

  const leaning = controls.snapshot()
  assert.deepEqual(held(leaning), ["left", "up"])
  assert.equal(leaning.actions.up.pressed && leaning.actions.left.pressed, true)
  const ahead = controls.snapshot()
  assert.deepEqual(held(ahead), ["up"])
  assert.equal(ahead.actions.up.pressed, false, "leaning up all along is one press")
  assert.equal(ahead.actions.left.released, true)
  const lifted = controls.snapshot()
  assert.deepEqual(held(lifted), ["up"], "W holds up as the thumb lifts")
  assert.equal(lifted.actions.up.released, false)
  assert.deepEqual([lifted.actions.action.pressed, lifted.actions.action.held], [true, false])
  const braking = controls.snapshot()
  assert.deepEqual(held(braking), ["handbrake", "up"])
  assert.equal(braking.actions.action.pressed, false)
  const steering = controls.snapshot()
  assert.deepEqual(held(steering), ["down", "handbrake", "left", "up"])
  assert.equal(steering.actions.left.pressed && steering.actions.down.pressed, true)
  const both = controls.snapshot()
  assert.deepEqual(held(both), ["down", "handbrake", "left", "up"])
  assert.equal(both.actions.left.released, false)
})

/** A canvas for Ritmo's live Touch: dispatches pointer events at page coordinates. */
const fakeCanvas = () => {
  const listeners = new Map<string, Set<(event: Touch.TouchEventLike) => void>>()
  const target: Touch.TouchTarget = {
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type, listener) => void listeners.get(type)?.delete(listener),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
  }
  const send = (type: "pointerdown" | "pointermove", pointerId: number, x: number, y: number) => {
    for (const listener of listeners.get(type) ?? [])
      listener({
        clientX: x,
        clientY: y,
        pointerId,
        pointerType: "touch",
        preventDefault: () => {},
      })
  }
  return { target, blur: { addEventListener: () => {}, removeEventListener: () => {} }, send }
}

test("a control the mode hides under a thumb that stays down lets go of its keys", () => {
  const canvas = fakeCanvas()
  let mode: "foot" | "driving" = "foot"
  // On foot the stick fills the left half; driving, ◀ sits at (60, 340) in its place.
  const touch = Touch.actions(canvas.target, canvas.blur, ({ width, height }) => ({
    sticks: {
      move:
        mode === "foot"
          ? { region: { left: 0, top: 0, width: width / 2, height }, radius: 56 }
          : null,
    },
    buttons: Object.fromEntries(
      BUTTONS.map((key) => [
        key,
        key === "left" && mode === "driving" ? { center: { x: 60, y: 340 }, radius: 40 } : null,
      ]),
    ) as Record<(typeof BUTTONS)[number], Touch.ButtonZone | null>,
  }))
  const controls = withTouch(Keyboard.scripted(bindings, []), touch)

  canvas.send("pointerdown", 1, 60, 340) // a thumb leaning the stick toward a car
  canvas.send("pointermove", 1, 60, 280)
  assert.deepEqual(held(controls.snapshot()), ["up"])
  mode = "driving" // the stick hides under the thumb: no throttle from it
  const gotIn = controls.snapshot()
  assert.deepEqual(held(gotIn), [])
  assert.equal(gotIn.actions.up.released, true)
  canvas.send("pointermove", 1, 60, 200)
  assert.deepEqual(held(controls.snapshot()), [], "the thumb, still down, holds nothing")

  canvas.send("pointerdown", 2, 60, 340) // ◀ held
  assert.deepEqual(held(controls.snapshot()), ["left"])
  mode = "foot" // ◀ hides under the thumb: the player does not walk off
  const gotOut = controls.snapshot()
  assert.deepEqual(held(gotOut), [])
  assert.equal(gotOut.actions.left.released, true)
  assert.equal(controls.snapshot().actions.left.released, false, "released once")
})

const html = readFileSync(new URL("../../../index.html", import.meta.url), "utf8"),
  css = readFileSync(new URL("../hud.css", import.meta.url), "utf8")

/** The keys whose buttons hud.css hides in a train: those whose markup carries a class it hides under `data-vehicle="train"`. */
const hiddenInTrain = (): ReadonlyArray<string> => {
  const rules = css.replaceAll(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)
  const hides = new Set(
    [...rules]
      .filter(([, , body]) => /display:\s*none/.test(body!))
      .flatMap(([, selectors]) => selectors!.split(",").map((selector) => selector.trim()))
      .flatMap((selector) => {
        const hidden = /^#hud-touch\[data-vehicle="train"\] \.([\w-]+)$/.exec(selector)
        return hidden === null ? [] : [hidden[1]!]
      }),
  )
  return BUTTONS.filter((key) => {
    const tag = new RegExp(`<[^>]*id="hud-touch-${key}"[^>]*>`).exec(html)?.[0] ?? ""
    const classes = /class="([^"]*)"/.exec(tag)?.[1] ?? ""
    return classes.split(" ").some((name) => hides.has(name))
  })
}

test("in a train ◀ ▶ hide, Gas, Brake, Hand brake and Horn stay, and a ◀ held as it boards lets go of its key", () => {
  assert.deepEqual(hiddenInTrain(), ["left", "right"])
  const canvas = fakeCanvas()
  let train = false
  // Driving, ◀ sits at (60, 340) and Gas at (740, 340); in a train hud.css hides ◀ ▶, so their zones are null.
  const at: Partial<Record<(typeof BUTTONS)[number], Touch.ButtonZone>> = {
    left: { center: { x: 60, y: 340 }, radius: 40 },
    up: { center: { x: 740, y: 340 }, radius: 40 },
  }
  const steer = new Set<string>(hiddenInTrain())
  const touch = Touch.actions(canvas.target, canvas.blur, () => ({
    sticks: { move: null },
    buttons: Object.fromEntries(
      BUTTONS.map((key) => [key, train && steer.has(key) ? null : (at[key] ?? null)]),
    ) as Record<(typeof BUTTONS)[number], Touch.ButtonZone | null>,
  }))
  const controls = withTouch(Keyboard.scripted(bindings, []), touch)

  canvas.send("pointerdown", 1, 60, 340) // ◀ held
  canvas.send("pointerdown", 2, 740, 340) // and Gas
  assert.deepEqual(held(controls.snapshot()), ["left", "up"])
  train = true // ◀ hides under the thumb: a train has no steering, and Gas still powers it
  const aboard = controls.snapshot()
  assert.deepEqual(held(aboard), ["up"])
  assert.equal(aboard.actions.left.released, true)
})

/** index.html's touch controls as plain objects, enough for `makeTouchControls` to bind and draw (each shown, 80 px across). */
const touchPage = () => {
  const node = () => ({
    dataset: {} as Record<string, string>,
    textContent: "",
    classList: { toggle: () => {} },
    style: { transform: "" },
    offsetParent: {},
    offsetLeft: 0,
    offsetTop: 0,
    offsetWidth: 80,
    offsetHeight: 80,
    firstElementChild: { style: { transform: "" } },
  })
  const nodes = new Map(
    ["hud-touch", "hud-stick", ...BUTTONS.map((key) => `hud-touch-${key}`)].map((id) => [
      id,
      node(),
    ]),
  )
  const window = { addEventListener: () => {}, removeEventListener: () => {} }
  const document = { getElementById: (id: string) => nodes.get(id) ?? null, defaultView: window }
  const canvas = {
    ownerDocument: { body: { clientWidth: 800, clientHeight: 400 }, defaultView: window },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  return {
    controls: makeTouchControls(
      document as unknown as Document,
      canvas as unknown as HTMLCanvasElement,
    ),
    root: nodes.get("hud-touch")!,
  }
}

// Regression guard: hud.css hides ◀ ▶ under `data-vehicle="train"`, which only `draw` writes.
test("drawn in a train, the touch controls are marked as a train's, so hud.css hides ◀ ▶; in a car and on foot, not", () => {
  const { controls, root } = touchPage()
  const pose = { x: 0, y: 0, angle: 0 }
  const view = (vehicle: PlayerViewModel["vehicle"]): PlayerViewModel => ({
    prev: pose,
    pose,
    velocity: { x: 0, y: 0 },
    mode: vehicle === undefined ? "foot" : "driving",
    vehicle,
    nearby: undefined,
    turns: 0,
  })
  controls.draw(view({ label: "ATR 220", speed: 0, kind: "train" }))
  assert.deepEqual([root.dataset.mode, root.dataset.vehicle], ["driving", "train"])
  controls.draw(view({ label: "Fiat Panda", speed: 0 }))
  assert.deepEqual([root.dataset.mode, root.dataset.vehicle], ["driving", ""])
  controls.draw(view(undefined))
  assert.deepEqual([root.dataset.mode, root.dataset.vehicle], ["foot", ""])
})

// Only mobile mode looks the controls up, so a desktop start-up never notices a missing one.
test("index.html draws the stick and every button the touch screen presses", () => {
  for (const id of ["hud-touch", "hud-stick", ...BUTTONS.map((key) => `hud-touch-${key}`)])
    assert.match(html, new RegExp(`id="${id}"`))
  assert.match(html, /id="hud-stick"><div class="knob">/)
})

test("a touch on a page turned upright lands where it is drawn, whatever the turn's origin", () => {
  // hud.css on a phone held upright, 390 px wide: translateX(100vw) rotate(90deg) about the top left.
  const W = 390,
    upright = { a: 0, b: 1, c: -1, d: 0, e: W, f: 0 }
  for (const [u, v] of [
    [0, 0],
    [150, 290],
    [800, 12],
  ] as const)
    assert.deepEqual(unturn(upright, { x: 0, y: 0 }, W - v, u), { x: u, y: v })
  // The same quarter turn about the centre of an 844 × 390 page.
  const origin = { x: 422, y: 195 },
    at = { x: 150, y: 290 }
  const screen = { x: origin.x - (at.y - origin.y), y: origin.y + (at.x - origin.x) }
  assert.deepEqual(unturn({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }, origin, screen.x, screen.y), at)
})
