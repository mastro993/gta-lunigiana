/**
 * The game settings (markup in index.html), in every build: a modal dialog, opened and closed by
 * Esc (`routeOverlayKeys` in hud.ts), opened in mobile mode by the pause button (#hud-pause), and
 * closed by its Resume button. One setting today, the vehicle
 * physics preset, chosen through the store the debug menu shares (`hud/handling.ts`). While it is
 * open the host pauses the game and leaves the last frame drawn dim behind it (`main.ts`).
 *
 * @module hud/settings
 */
import { HANDLING_PRESETS, PRESET_IDS } from "../sim/handling.ts"
import type { HandlingStore } from "./handling.ts"
import { element } from "./title.ts"

/**
 * What a key pressed in the dialog does: Esc cancels its default (the browser closing the dialog itself, which a held-down repeat or
 * Ctrl+Esc would do) and goes on to the window's router, which closes it; any other key stops, so it neither drives nor walks.
 */
export const settingsKey = (event: Pick<KeyboardEvent, "key">): "cancel" | "stop" =>
  event.key === "Escape" ? "cancel" : "stop"

/** Checks the radio of `preset` (none for a hand-set mix of knobs) and shows the Custom note only then. */
export const markPreset = (
  radios: ReadonlyArray<{ readonly value: string; checked: boolean }>,
  custom: Pick<HTMLElement, "hidden">,
  preset: string | undefined,
): void => {
  for (const radio of radios) radio.checked = radio.value === preset
  custom.hidden = preset !== undefined
}

/** Binds the settings to their markup (#settings) and to `store`, closed. Choosing a preset applies it at once. */
export const makeSettings = (document: Document, store: HandlingStore) => {
  const dialog = element(document, "settings") as HTMLDialogElement
  const physics = element(document, "settings-physics"),
    custom = element(document, "settings-custom")
  const radios = PRESET_IDS.map((id) => {
    const { label, description } = HANDLING_PRESETS[id]
    const radio = Object.assign(document.createElement("input"), {
      type: "radio",
      name: "physics",
      id: `physics-${id}`,
      value: id,
    })
    const about = Object.assign(document.createElement("p"), {
      id: `${radio.id}-about`,
      textContent: description,
    })
    radio.setAttribute("aria-describedby", about.id)
    radio.addEventListener("change", () => store.choose(id))
    const row = Object.assign(document.createElement("div"), { className: "preset" })
    row.append(
      radio,
      Object.assign(document.createElement("label"), { htmlFor: radio.id, textContent: label }),
      about,
    )
    physics.append(row)
    return radio
  })
  // A mix of knobs set in the debug menu is no preset: none checked, and the note says so.
  const show = () => markPreset(radios, custom, store.preset())
  store.subscribe(show)
  show()
  const showDialog = (): void => {
    dialog.showModal()
    const focus = radios.find((radio) => radio.checked) ?? radios[0]
    focus?.focus()
  }
  element(document, "settings-resume").addEventListener("click", () => dialog.close())
  // Blurred first, so closing the dialog puts focus back on the page: a key typed on the focused
  // button (Space, the handbrake) would click it again.
  const pause = element(document, "hud-pause")
  pause.addEventListener("click", () => {
    pause.blur()
    if (!dialog.open) showDialog()
  })
  // The game's keyboard listens on the window (`settingsKey`). Keyups go on, so a key held as the dialog opened is released.
  dialog.addEventListener("keydown", (event) => {
    if (settingsKey(event) === "cancel") event.preventDefault()
    else event.stopPropagation()
  })
  return {
    /** Whether the settings are open (the host pauses the game while they are). */
    open: (): boolean => dialog.open,
    /** Opens the settings, focus on the checked preset (the first when none is), or closes them; the browser puts focus back. */
    toggle: (): void => (dialog.open ? dialog.close() : showDialog()),
  }
}
