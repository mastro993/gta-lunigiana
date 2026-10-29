/**
 * The debug menu, in dev builds only (main.ts imports it inside its `import.meta.env.DEV` block): a
 * panel whose areas set the game live, Time and Weather through the sky store `gta.sky` shares
 * (`debug-sky.ts`), the vehicle Handling through the store the settings share
 * (`debug-handling.ts`), and Trains through the trains store `gta.trains` shares
 * (`debug-trains.ts`). P or the Debug button beside the Ritmo monitor's opens and closes it, Esc
 * inside it closes it, and no key pressed in it reaches the game. While it is open, the areas' live
 * readouts refresh each animation frame.
 *
 * @module hud/debug
 */
import { handlingArea } from "./debug-handling.ts"
import { timeArea, weatherArea } from "./debug-sky.ts"
import { trainsArea } from "./debug-trains.ts"
import type { HandlingStore } from "./handling.ts"
import type { SkyStore } from "./sky.ts"
import type { TrainStore } from "./trains.ts"

const TITLE = "Debug"

/**
 * Whether `event` toggles the menu: the key that types P (on any Latin layout, AZERTY too), or the
 * key in P's place on layouts that type no ASCII character there (Cyrillic, Greek). Repeats and
 * Ctrl, Cmd or Alt chords are not.
 */
export const isDebugKey = (
  event: Pick<KeyboardEvent, "key" | "code" | "repeat" | "ctrlKey" | "metaKey" | "altKey">,
): boolean => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return false
  const key = event.key.toLowerCase()
  return key === "p" || (event.code === "KeyP" && !/^[ -~]$/.test(key))
}

/** `document`'s element maker: a `tag` element with `props` set (ARIA too: `ariaLabel`, `ariaPressed`, `ariaValueText`) and `children` appended. */
const maker =
  (document: Document) =>
  <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: NoInfer<Partial<HTMLElementTagNameMap[K]>> = {},
    ...children: Array<Node | string>
  ): HTMLElementTagNameMap[K] => {
    const node = Object.assign(document.createElement(tag), props)
    node.append(...children)
    return node
  }

/** The element maker the areas build with. */
export type Make = ReturnType<typeof maker>

/** One area of the menu: its heading, what it holds, the control focus goes to when the menu opens on it, and what refreshes its live readouts each frame the menu is open. */
export interface Area {
  readonly title: string
  readonly nodes: ReadonlyArray<Node>
  readonly first: HTMLElement
  readonly live?: () => void
}

/** What the menu needs: the page, the player's handling, the game's clock and weather, its railway, and where the player stands (x east, y north, z m a.s.l.) once there is one. */
export interface DebugMenuHost {
  readonly window: Window
  readonly handling: HandlingStore
  readonly sky: SkyStore
  readonly trains: TrainStore
  readonly here: () => { readonly x: number; readonly y: number; readonly z: number } | undefined
}

// The Debug button sits right of the monitor's (`.btm-toggle`, bottom left), anchored to it; until
// the monitor is on the page, or where anchor positioning is missing, it takes the fallbacks. In
// mobile mode both go under the minimap (hud.css: 12 px from the top, 124 px tall): clear of the top
// row's clock, of this menu (top right) and of the touch controls (◀ ▶ and the stick are bottom left).
const STYLE = `
.btm-toggle { anchor-name: --ritmo-monitor; }
.debug-toggle { position: fixed; z-index: 2147483000; left: 200px; left: calc(anchor(--ritmo-monitor right, 4px) + 8px); bottom: 12px; bottom: anchor(--ritmo-monitor bottom, 12px); padding: 2px 8px; font: inherit; font-size: 11px; color: var(--shadow); background: var(--accent); border: 2px solid var(--shadow); cursor: pointer; }
html.touch .btm-toggle { top: 148px; bottom: auto; }
html.touch .debug-toggle { top: 148px; top: anchor(--ritmo-monitor top, 148px); bottom: auto; }
.debug { position: fixed; z-index: 2147483000; top: 16px; right: 16px; bottom: 120px; box-sizing: border-box; width: min(360px, calc(100vw - 32px)); overflow-y: auto; padding: 12px 16px; color: var(--ink); background: rgb(23 22 26 / 0.9); border: 2px solid var(--accent); text-shadow: 2px 2px 0 var(--shadow); color-scheme: dark; }
.debug[hidden] { display: none; }
.debug h2, .debug h3, .debug h4 { margin: 0; color: var(--accent); text-transform: uppercase; letter-spacing: 0.06em; }
.debug h2 { font-size: 16px; }
.debug h3 { margin-top: 20px; padding-top: 8px; border-top: 2px solid var(--accent); font-size: 14px; }
.debug h4 { margin-top: 16px; font-size: 12px; }
.debug p { margin: 0; font-size: 11px; opacity: 0.85; }
.debug-knob { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 12px; margin-top: 8px; }
.debug-knob output { color: var(--accent); }
.debug-knob p { grid-column: 1 / -1; }
.debug input { margin: 0; accent-color: var(--accent); }
.debug input[type="checkbox"] { justify-self: start; }
.debug input[type="date"] { font: inherit; font-size: 12px; color: var(--ink); background: var(--shadow); border: 2px solid var(--accent); }
.debug button { padding: 0 8px; font: inherit; font-size: 12px; color: var(--shadow); background: var(--accent); border: 2px solid var(--shadow); text-shadow: none; cursor: pointer; }
.debug button[hidden] { display: none; }
.debug-choices { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
.debug-custom { color: var(--accent); }
.debug-custom[hidden] { display: none; }
.debug .debug-choices button[aria-pressed="false"] { color: var(--accent); background: transparent; border-color: var(--accent); }
.debug-settle { display: grid; gap: 2px; justify-items: start; margin-top: 8px; }
.debug-readouts { margin: 8px 0 0; font-size: 12px; }
.debug-readouts div { display: grid; grid-template-columns: 12ch 1fr; gap: 12px; }
.debug-readouts dt { color: var(--accent); }
.debug-readouts dd { margin: 0; }
.debug .debug-reset-all { margin-top: 16px; }
.debug :focus-visible, .debug-toggle:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
`

/** Mounts the menu, closed, and its button: the Time, Weather, Handling and Trains areas, each showing every change its store makes, from wherever it comes. */
export const mountDebugMenu = ({ window, handling, sky, trains, here }: DebugMenuHost): void => {
  const document = window.document,
    make = maker(document)
  const panel = make(
    "section",
    { id: "debug-menu", className: "debug", role: "dialog", ariaLabel: TITLE, hidden: true },
    make("h2", { textContent: TITLE }),
    make("p", { textContent: "Dev builds only." }),
  )
  const areas = [
    timeArea(make, sky),
    weatherArea(make, sky, here),
    handlingArea(make, handling),
    trainsArea(make, trains),
  ]
  for (const { title, nodes } of areas) {
    const heading = make("h3", { id: `debug-${title.toLowerCase()}-title`, textContent: title })
    const area = make("section", {}, heading, ...nodes)
    area.setAttribute("aria-labelledby", heading.id)
    panel.append(area)
  }
  const toggle = make("button", {
    type: "button",
    className: "debug-toggle",
    textContent: "Debug (P)",
    title: TITLE,
    ariaExpanded: "false",
  })
  toggle.setAttribute("aria-controls", panel.id)

  // The live readouts follow the game each frame, only while they show.
  let frame: number | undefined
  const refresh = () => {
    for (const area of areas) area.live?.()
    frame = window.requestAnimationFrame(refresh)
  }
  let returnTo: Element | null = null
  const open = () => {
    returnTo = document.activeElement
    panel.hidden = false
    toggle.ariaExpanded = "true"
    refresh()
    areas[0]!.first.focus()
  }
  const close = () => {
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    frame = undefined
    // Focus goes back only from inside the menu: one the player moved elsewhere stays there.
    const inside = panel.contains(document.activeElement)
    panel.hidden = true
    toggle.ariaExpanded = "false"
    if (inside && returnTo instanceof HTMLElement) returnTo.focus()
  }
  const flip = () => (panel.hidden ? open() : close())
  toggle.addEventListener("click", flip)
  // Esc outside the menu is the settings' (`routeOverlayKeys` in hud.ts).
  window.addEventListener("keydown", (event) => {
    if (isDebugKey(event)) flip()
  })
  // The game's keyboard listens on the window: a key pressed in the menu stops here, so it neither
  // drives nor walks (nor moves the map or the monitor). Keyups go on: one of a key held as focus
  // came in releases it, and the keyboard ignores the keyup of a key it never saw go down.
  panel.addEventListener("keydown", (event) => {
    event.stopPropagation()
    if (isDebugKey(event) || event.key === "Escape") close()
  })
  document.head.append(make("style", { textContent: STYLE }))
  document.body.append(panel, toggle)
}
