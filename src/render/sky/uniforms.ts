/**
 * The uniforms every sky-driven material shares by reference: the glow layer (lit windows, lantern
 * glass), the vehicle lamps and, later, the weather-patched world materials. Three gives each
 * program of a material its own uniforms object, so these `{ value }` cells must be the very
 * objects every material holds: write `.value`, never replace, spread or clone them.
 *
 * @module render/sky/uniforms
 */
import { Color, Vector2, Vector3 } from "three"

import type { SkyFrame } from "./frame.ts"

/**
 * `uTime` wraps at this many sim seconds, so float32 `sin()` in the shaders keeps its precision. A sine
 * on `uTime` runs on across the wrap only if it turns a whole number of times in TIME_WRAP: give every
 * angular frequency through `phaseLocked` (uniforms.test.ts checks the shaders).
 */
export const TIME_WRAP = 600

/** A number as a GLSL float literal, for the constants the shaders write into their text. */
export const glslFloat = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n))

/** The angular frequency (rad/s) nearest `omega` that turns a whole number of times in TIME_WRAP: `sin(uTime · it)` does not jump when `uTime` wraps. */
export const phaseLocked = (omega: number): number =>
  (2 * Math.PI * Math.max(1, Math.round((omega * TIME_WRAP) / (2 * Math.PI)))) / TIME_WRAP

/** The shared uniform cells (render-sky adds the surface-weather ones here): write `.value`, never replace the objects. */
export const SKY_UNIFORMS = {
  /** Lamps, lit windows and headlights on, 0..1 (`SkyFrame.lamps`). */
  uLamps: { value: 0 },
  /** 0 full day … 1 full night (`SkyFrame.night`). */
  uNight: { value: 0 },
  /** Light on unlit things, ≈ 1 at a clear noon, flash included (`SkyFrame.ambient`). */
  uAmbient: { value: 1 },
  /** Sim seconds modulo `TIME_WRAP` (`SkyFrame.now`). */
  uTime: { value: 0 },
  /** The post pass's exposure (1 by day, up to 4 at night): lamps divide by it, so they shine as bright on screen at dusk as at midnight. */
  uExposure: { value: 1 },
  // Surface weather (render/sky/surface: `applySurface` writes these).
  /** Render y of the snow line, `yOf(Weather.snowLine)`: far above the map, no snow. */
  uSnowLineY: { value: 1e4 },
  /** Ground wetness where no snow lies, 0..1. */
  uWet: { value: 0 },
  /** The air at the snow line, °C, and how it changes with height, °C per m: where it thaws, meltwater wets the ground below the snow. */
  uMelt: { value: new Vector2(0, 0) },
  /** The cloud field's value above which a cloud shades the ground (above 1: a clear sky). */
  uCloudCut: { value: 2 },
  /** How much of the direct light a cloud takes, 0..1. */
  uCloudShade: { value: 0 },
  /** How far the clouds have drifted, map metres (x east, y north), wrapped on the cloud field's period. */
  uCloudOffset: { value: new Vector2() },
  /** The sky's linear radiance, which puddles and rain rings mirror. */
  uSkyColour: { value: new Color(0, 0, 0) },
  /** Share of the water's cells that ring with a raindrop each tick, 0..0.06. */
  uRipples: { value: 0 },
  /** What the rivers carry, as their depth's and speed's factors: q^STAGE and q^SPEED (water/channel), q m³/s per km². */
  uRiverStage: { value: 0 },
  uRiverSpeed: { value: 0 },
  /** Tree canopy sway amplitude, m (0 in still air: not a texel moves). */
  uSway: { value: 0 },
  /** How far the canopies lean downwind on screen, in sway amplitudes. */
  uSwayLean: { value: 0 },
  /** The camera's right axis (three space): canopies sway along it, by whole texels. */
  uSwayAxis: { value: new Vector3(1, 0, 0) },
  /** The view's zoom, texels per metre. */
  uTexelsPerMetre: { value: 8 },
}

/** Copies this frame and the post pass's `exposure` into `SKY_UNIFORMS`: the sky host calls it once per frame, before the scene renders. */
export const applyFrame = (frame: SkyFrame, exposure = 1): void => {
  SKY_UNIFORMS.uExposure.value = exposure
  SKY_UNIFORMS.uLamps.value = frame.lamps
  SKY_UNIFORMS.uNight.value = frame.night
  SKY_UNIFORMS.uAmbient.value = frame.ambient
  SKY_UNIFORMS.uTime.value = ((frame.now % TIME_WRAP) + TIME_WRAP) % TIME_WRAP
}
