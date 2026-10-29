/**
 * Mobile mode's controls (markup in index.html, layout in hud.css). On foot, a stick appears under
 * a thumb on the left half of the screen and holds the arrow keys it leans toward, eight ways like
 * the keys. Driving, buttons take its place: ◀ ▶ on the left steer, Gas and Brake on the right; in
 * a train, which has no steering, ◀ ▶ hide. Every key has a button, shown in the mode it works in.
 * They feed the keyboard's own snapshot (`withTouch`), so the simulation, its tests and replays
 * cannot tell a tap from a key. Ritmo's `Touch` tracks the fingers; its zones are read from the
 * drawn controls, so they always match.
 *
 * @module hud/touch
 */
import { type Controls, type InputCapture, type Keyboard, Touch } from "@typeonce/ritmo-browser"

import { bindings, type PlayerViewModel } from "../sim/index.ts"
import { actionFor } from "./hud.ts"
import { element } from "./title.ts"

type Key = keyof typeof bindings
type Keys = Keyboard.Snapshot<typeof bindings>

/** The keys the buttons press, every key; index.html draws each as `#hud-touch-<key>`. */
export const BUTTONS = Object.keys(bindings) as ReadonlyArray<Key>

/** sin 22.5°: the stick holds a direction key once it leans more than this toward it, so it has eight directions. */
const LEAN = Math.sin(Math.PI / 8)

/** The direction keys a stick tilt holds (screen y grows downwards). */
const directions = ({ x, y }: Controls.Vector): Partial<Record<Key, boolean>> => {
  const lean = LEAN * Math.hypot(x, y)
  return { up: y < -lean, down: y > lean, left: x < -lean, right: x > lean }
}

/**
 * The keyboard's controls with the touch screen's added: the stick holds the direction keys, each
 * button its own key. A key is held while any of them holds it, and a press on any is a press. A
 * control the mode or the vehicle hides is `null` in Touch's layout, so Touch lets go of it under a
 * thumb that stays down (the stick on getting in, ◀ on getting out, ◀ ▶ on boarding a train), and
 * its keys release once.
 */
export const withTouch = (
  keyboard: InputCapture.Source<Keys>,
  touch: InputCapture.Source<Touch.Snapshot<Key, "move">>,
): InputCapture.Source<Keys> => {
  let was = directions({ x: 0, y: 0 })
  return {
    snapshot: () => {
      const typed = keyboard.snapshot(),
        tapped = touch.snapshot(),
        now = directions(tapped.vectors.move)
      const merged = {} as Record<Key, Controls.ActionState>
      for (const key of BUTTONS) {
        const leans = now[key] === true,
          leant = was[key] === true
        const all = [
            typed.actions[key],
            tapped.actions[key],
            { held: leans, pressed: leans && !leant, released: leant && !leans },
          ],
          down = all.some((state) => state.held)
        merged[key] = {
          held: down,
          pressed: all.some((state) => state.pressed),
          released: all.some((state) => state.released) && !down,
        }
      }
      was = now
      return { actions: merged, vectors: {}, used: typed.used || tapped.used }
    },
  }
}

/** A CSS transform's matrix(a, b, c, d, e, f), as DOMMatrix holds it. */
interface Affine {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly e: number
  readonly f: number
}

/**
 * The point in a box's own frame under the screen point (x, y), when CSS draws the box, sitting at
 * the screen's top left, with `transform` about `origin` (its transform-origin, px): the inverse
 * of screen = origin + M (p − origin) + (e, f), M being the matrix's 2 × 2 part.
 */
export const unturn = (
  { a, b, c, d, e, f }: Affine,
  origin: { readonly x: number; readonly y: number },
  x: number,
  y: number,
) => {
  const det = a * d - b * c,
    sx = x - origin.x - e,
    sy = y - origin.y - f
  return { x: origin.x + (d * sx - c * sy) / det, y: origin.y + (a * sy - b * sx) / det }
}

/**
 * The canvas as the touch surface, in the page's own frame: a phone held upright turns the page a
 * quarter (hud.css), but touches arrive in screen coordinates, so each is turned back first.
 */
const surface = (canvas: HTMLCanvasElement): Touch.TouchTarget => {
  const page = canvas.ownerDocument.body,
    window = canvas.ownerDocument.defaultView!
  const turned = new Map<(event: Touch.TouchEventLike) => void, (event: PointerEvent) => void>()
  return {
    addEventListener: (type, listener) => {
      const local = (event: PointerEvent) => {
        const style = window.getComputedStyle(page)
        const [x = 0, y = 0] = style.transformOrigin.split(" ").map(parseFloat)
        const at =
          style.transform === "none"
            ? { x: event.clientX, y: event.clientY }
            : unturn(new DOMMatrix(style.transform), { x, y }, event.clientX, event.clientY)
        listener({
          clientX: at.x,
          clientY: at.y,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          preventDefault: () => event.preventDefault(),
        })
      }
      turned.set(listener, local)
      canvas.addEventListener(type, local)
    },
    removeEventListener: (type, listener) =>
      canvas.removeEventListener(type, turned.get(listener) ?? listener),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: page.clientWidth,
      height: page.clientHeight,
    }),
    setPointerCapture: (pointerId) => canvas.setPointerCapture(pointerId),
    style: canvas.style,
  }
}

/** Whether hud.css hides `node` in the current mode. */
const hidden = (node: HTMLElement) => node.offsetParent === null

/** A drawn control's touch zone in the page's frame: the circle it is drawn as, or `null` while hidden. */
const zone = (node: HTMLElement): Touch.ButtonZone | null =>
  hidden(node)
    ? null
    : {
        center: {
          x: node.offsetLeft + node.offsetWidth / 2,
          y: node.offsetTop + node.offsetHeight / 2,
        },
        radius: node.offsetWidth / 2,
      }

/** Binds the touch controls to their markup over `canvas`: `touch` feeds `withTouch`, `draw` runs once per frame. */
export const makeTouchControls = (document: Document, canvas: HTMLCanvasElement) => {
  const root = element(document, "hud-touch"),
    stick = element(document, "hud-stick"),
    knob = stick.firstElementChild as HTMLElement
  const pads = Object.fromEntries(
    BUTTONS.map((key) => [key, element(document, `hud-touch-${key}`)]),
  ) as Record<Key, HTMLElement>
  // Read again on every snapshot and every new touch, so the zones follow the controls hud.css shows
  // in the current mode: a hidden one is null, and Touch lets go of it under a thumb that stays down.
  const touch = Touch.actions(surface(canvas), document.defaultView!, ({ width, height }) => ({
    sticks: {
      move: hidden(stick)
        ? null
        : { region: { left: 0, top: 0, width: width / 2, height }, radius: stick.offsetWidth / 2 },
    },
    buttons: Object.fromEntries(BUTTONS.map((key) => [key, zone(pads[key])])) as Record<
      Key,
      Touch.ButtonZone | null
    >,
  }))
  let moved = "",
    leaned = ""
  return {
    touch,
    /** Shows the buttons of the player's mode and vehicle, the action button's verb, the held controls lit and the stick under the thumb. */
    draw: (view: PlayerViewModel): void => {
      if (root.dataset.mode !== view.mode) root.dataset.mode = view.mode
      // "train" hides ◀ ▶ (hud.css): their zones turn null, and Touch lets go of a finger on one.
      const vehicle = view.vehicle?.kind ?? ""
      if (root.dataset.vehicle !== vehicle) root.dataset.vehicle = vehicle
      const verb = actionFor(view)?.verb ?? ""
      if (pads.action.textContent !== verb) pads.action.textContent = verb
      const live = touch.view()
      for (const key of BUTTONS) pads[key].classList.toggle("held", live.buttons[key].held)
      const at = live.sticks.move
      stick.classList.toggle("held", at !== null)
      // At rest the stick sits where hud.css puts it; held, it is centred where the thumb landed.
      const move =
        at === null
          ? ""
          : `translate(${at.origin.x - stick.offsetLeft - stick.offsetWidth / 2}px, ${at.origin.y - stick.offsetTop - stick.offsetHeight / 2}px)`
      const lean =
        at === null ? "" : `translate(${at.knob.x - at.origin.x}px, ${at.knob.y - at.origin.y}px)`
      if (move !== moved) stick.style.transform = moved = move
      if (lean !== leaned) knob.style.transform = leaned = lean
    },
  }
}

/**
 * On the first tap, asks for the full screen, then for landscape, which a browser grants only in
 * full screen (Android). An iPhone grants neither to a page; the page turns itself there (hud.css).
 */
export const holdLandscape = (window: Window): void => {
  // On the click, the tap's last event: the full screen uses up the tap's user activation, which
  // the speaker needs first (it starts the sound on the touchend before it).
  window.addEventListener(
    "click",
    () => {
      void Promise.resolve()
        .then(() => window.document.documentElement.requestFullscreen({ navigationUI: "hide" }))
        .then(() => window.screen.orientation.lock("landscape"))
        .catch(() => {}) // refused or unsupported: the game plays on as it is
    },
    { once: true },
  )
}
