/**
 * The HUD: plain DOM over the canvas (markup in index.html). It reads only the PlayerView and
 * SkyView models and the map, and touches the DOM only when a text changes.
 *
 * @module hud
 */
import { FixedLoop } from "@typeonce/ritmo"

import type { PlayerViewModel, SkyViewModel } from "../sim/index.ts"
import { heightAt } from "../sim/map/index.ts"
import { boardable } from "../sim/rail/boarding.ts"
import { clockText, weatherText } from "./clock.ts"
import { locationAt } from "./location.ts"
import { makeMinimap } from "./minimap.ts"
import { element, set } from "./title.ts"
import { makeWorldMap } from "./worldmap.ts"

/** What the action key would do now, and to which vehicle (none when getting out); undefined when nothing (a train still too fast to leave). */
export const actionFor = (
  view: PlayerViewModel,
): { readonly verb: string; readonly vehicle?: string } | undefined => {
  if (view.mode === "driving")
    return view.vehicle?.kind === "train" && !boardable(view.vehicle.speed)
      ? undefined
      : { verb: "exit" }
  if (view.mode === "down" || view.mode === "dead" || view.nearby === undefined) return undefined
  const { occupied, stolen, label } = view.nearby
  return { verb: occupied ? "carjack" : stolen ? "enter" : "steal", vehicle: label }
}

/** The action prompt for the current view, or "" when there is nothing to do. */
export const promptText = (view: PlayerViewModel): string => {
  const action = actionFor(view)
  return action === undefined
    ? ""
    : action.vehicle === undefined
      ? `F — ${action.verb}`
      : `F — ${action.verb} ${action.vehicle}`
}

/** Speedometer reading in km/h (always positive, rounded). */
export const kmh = (metresPerSecond: number): number => Math.round(Math.abs(metresPerSecond) * 3.6)

/** Binds the HUD to its markup; `update` once per frame with the interpolated player position, the view's yaw and the sky. */
export const makeHud = (document: Document) => {
  const road = element(document, "hud-road"),
    district = element(document, "hud-district")
  const clock = element(document, "hud-clock"),
    weather = element(document, "hud-weather")
  const speedo = element(document, "hud-speedo"),
    speed = element(document, "hud-speed"),
    vehicle = element(document, "hud-vehicle")
  const prompt = element(document, "hud-prompt"),
    wasted = element(document, "hud-wasted"),
    wait = element(document, "hud-loading")
  const minimap = makeMinimap(document)
  const worldMap = makeWorldMap(document)
  let last = { x: Number.NaN, y: Number.NaN, angle: 0 }
  const toggleMap = (): void =>
    worldMap.open ? worldMap.hide() : worldMap.show(last.x, last.y, last.angle)
  const corner = element(document, "hud-minimap")
  corner.append(minimap.canvas)
  // A touch screen has no M key: a tap on the minimap opens the map, and one on the map closes it.
  corner.addEventListener("click", toggleMap)
  element(document, "hud-map").addEventListener("click", () => worldMap.hide())
  const show = (node: HTMLElement, visible: boolean) => {
    if (node.hidden === visible) node.hidden = !visible
  }
  let located = { x: Number.NaN, y: Number.NaN, z: 0 }
  return {
    /** Whether the full map is open (the host pauses the game while it is). */
    mapOpen: (): boolean => worldMap.open,
    /** Opens the full map at the last drawn player position, or closes it. */
    toggleMap,
    closeMap: (): void => worldMap.hide(),
    /** Repaints the open map (after the pixel ratio changes without a resize). */
    repaintMap: (): void => {
      if (worldMap.open) worldMap.show(last.x, last.y, last.angle)
    },
    /** Shows or hides "Loading map…": the game has waited a while for a tile the next step reads (`update` is not called meanwhile). */
    loadingMap: (visible: boolean): void => show(wait, visible),
    update: (
      view: PlayerViewModel,
      x: number,
      y: number,
      angle: number,
      yaw: number,
      sky: SkyViewModel,
    ): void => {
      last = { x, y, angle }
      // Names and heights change slowly: look them up again only after moving a couple of metres.
      if (!(Math.hypot(x - located.x, y - located.y) < 2)) {
        located = { x, y, z: heightAt(x, y) }
        const here = locationAt(x, y)
        set(road, here.road ?? "")
        set(district, here.district)
      }
      const time = clockText(sky.local.hour * 3600 + sky.local.minute * 60)
      if (clock.textContent !== time) {
        clock.textContent = time
        clock.setAttribute("datetime", time)
      }
      set(weather, weatherText(sky, located.x, located.y, located.z))
      show(speedo, view.vehicle !== undefined)
      if (view.vehicle !== undefined) {
        set(speed, String(kmh(view.vehicle.speed)))
        set(vehicle, view.vehicle.label)
      }
      const text = promptText(view)
      show(prompt, text !== "")
      set(prompt, text)
      // Killed by a blast: "Sei morto" until the player comes back at the start (`Respawn`).
      show(wasted, view.mode === "dead")
      minimap.draw(x, y, angle, yaw)
    },
  }
}

/** Which overlays are up when a key goes down: the title card, the full map, the settings. */
export interface Overlays {
  readonly title: boolean
  readonly map: boolean
  readonly settings: boolean
}

/** What an overlay key does. */
export type OverlayAction = "toggleMap" | "closeMap" | "toggleSettings"

/**
 * What a keydown does to the overlays: M toggles the full map, unless the settings are open; Esc
 * closes the map when it is open, else opens or closes the settings. Nothing while the title card
 * is up, so the key that dismisses it opens nothing behind it; held-down repeats and modified keys
 * (Cmd+M...) do nothing. M is matched by the character it types, so it is the key labelled M on any
 * Latin layout (AZERTY too); layouts whose keys type no ASCII character (Cyrillic, Greek) fall back
 * to its position.
 */
export const overlayKey = (
  event: Pick<KeyboardEvent, "key" | "code" | "repeat" | "ctrlKey" | "metaKey" | "altKey">,
  open: Overlays,
): OverlayAction | undefined => {
  if (open.title || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return undefined
  if (event.key === "Escape") return open.map ? "closeMap" : "toggleSettings"
  const key = event.key.toLowerCase()
  return !open.settings && (key === "m" || (event.code === "KeyM" && !/^[ -~]$/.test(key)))
    ? "toggleMap"
    : undefined
}

/**
 * Runs `overlayKey`'s action for each keydown that reaches the window, and cancels that key's
 * default: the Esc that opens the settings would go on to close them, as the browser closes an open
 * modal dialog on Esc. Add it before the title card's listener (`titleReady`), so the key that
 * dismisses the card still finds it up.
 */
export const routeOverlayKeys = (
  window: Pick<Window, "addEventListener">,
  overlays: { readonly open: () => Overlays } & Readonly<Record<OverlayAction, () => void>>,
): void => {
  window.addEventListener("keydown", (event) => {
    const action = overlayKey(event, overlays.open())
    if (action === undefined) return
    event.preventDefault()
    overlays[action]()
  })
}

/**
 * The fixed-loop update with the full map or the settings able to pause the game: `tick` while
 * `paused` is false; while it is true, `skip`, after draining the controls' press edges (keys and
 * touch) so presses made over the pause do not act when play resumes (held keys stay held).
 */
export const pausable =
  <R>(
    paused: () => boolean,
    controls: { readonly snapshot: () => unknown },
    tick: () => R,
    skip: R,
  ) =>
  (): R => {
    if (!paused()) return tick()
    controls.snapshot()
    return skip
  }

/**
 * Starts the fixed loop so that a frame that throws (a sim step, the render or audio schedule, the
 * tile stream) stops it for good, as a failure the loop reports (`onFailure`) does, and calls
 * `halt` once with the error or the failure. Unguarded, a throw would skip the browser tick
 * source's next `requestAnimationFrame`: the last frame stays up, and nothing says the game stopped.
 */
export const startGuardedLoop = <T extends FixedLoop.Tick, E>(
  options: Omit<FixedLoop.StartOptions<T, E>, "onFailure">,
  halt: (error: unknown) => void,
) => {
  let down = false
  let driver: FixedLoop.Driver | undefined
  const fail = (error: unknown): void => {
    if (down) return
    down = true
    driver?.stop()
    halt(error)
  }
  const source = FixedLoop.source<T>((onTick) =>
    options.source.subscribe((tick) => {
      if (down) return
      try {
        onTick(tick)
      } catch (error) {
        fail(error)
      }
    }),
  )
  const started = FixedLoop.start({ ...options, source, onFailure: fail })
  if (started.ok) {
    driver = started.value
    // A source that ticks inside `subscribe` can fail before the driver is known.
    if (down) driver.stop()
  }
  return started
}
