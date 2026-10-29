/**
 * Unlit materials for things that shine: the chunks' glow layer (window panes, lantern glass), the
 * vehicle lamps, a train's lit windows, and the signal lamps (a train's head and tail lamps, a level crossing's red lights),
 * which shine by day as well. They read `SKY_UNIFORMS` by reference, so the sky host turns every
 * window, lantern and lamp on and off by writing `uLamps` once a frame. Unlit colours do not darken
 * with the lights, so their day colour is scaled by `uAmbient`. The lit colour is divided by the post
 * pass's exposure, so a lamp shines as bright on screen at dusk as at midnight; bright, it is spared
 * the night grade, and past full brightness the post pass dims it whole, so it keeps its hue.
 * By day the panes are not drawn at all: the windows keep their settled daytime look.
 *
 * @module render/sky/glow
 */
import { Color, ShaderMaterial } from "three"

import { PALETTE } from "../palette.ts"
import { CUT_GLSL, CUT_UNIFORMS } from "../see-through.ts"
import { SKY_UNIFORMS } from "./uniforms.ts"

/** Lit colour gain of a glow pane at full `uLamps` (vertex colour × this, on screen): bright enough to keep its hue through the night grade. */
const GLOW_GAIN = 1.2
/** Below this `uLamps` (day) the panes are not drawn. */
const GLOW_FROM = 0.02
/**
 * Lamps: day colour × ambient × LAMP_DAY (a lit painted box), lit colour × LAMP_GAIN on screen at full `uLamps`. An unlit signal
 * lamp is dark glass by day, × LAMP_DARK: at the day look's 0.7 a white head lamp read as lit beside the lit red tail lamps.
 */
const LAMP_DAY = 0.7
const LAMP_DARK = 0.25
const LAMP_GAIN = 3

const VERTEX = /* glsl */ `
  varying vec3 vLit;
  void main() {
    vLit = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * The glow layer of every chunk (one material, shared): by day each pane is dark glass lit by the
 * ambient light, at night it adds its vertex colour (warm window light, lantern light) × `uLamps`.
 */
export const glowMaterial = new ShaderMaterial({
  uniforms: {
    uLamps: SKY_UNIFORMS.uLamps,
    uAmbient: SKY_UNIFORMS.uAmbient,
    uExposure: SKY_UNIFORMS.uExposure,
    uGlass: { value: new Color(PALETTE.windowGlass) },
    ...CUT_UNIFORMS,
  },
  vertexColors: true,
  // The panes lie on the walls: the see-through cut takes them with the walls (`render/see-through`).
  defines: { CUT_ABOVE: "" },
  vertexShader: /* glsl */ `
    varying vec3 vLit;
    varying vec3 vAt;
    varying float vY;
    void main() {
      vLit = color;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vec4 at = viewMatrix * world;
      vAt = at.xyz;
      vY = world.y;
      gl_Position = projectionMatrix * at;
    }
  `,
  fragmentShader: /* glsl */ `
    ${CUT_GLSL}
    varying vec3 vAt;
    varying float vY;
    uniform float uLamps;
    uniform float uAmbient;
    uniform float uExposure;
    uniform vec3 uGlass;
    varying vec3 vLit;
    void main() {
      if (uLamps < ${GLOW_FROM.toFixed(2)} || cutAway(vAt, vY)) discard;
      gl_FragColor = vec4(uGlass * uAmbient + vLit * (uLamps * ${GLOW_GAIN.toFixed(2)} / uExposure), 1.0);
    }
  `,
})

// A lamp shines with the night's lamps (`uLamps`), or always where its own `uDay` is 1, over its day look (`uPaint` of the vertex
// colour × ambient); where `uPane` is 1 it is a window pane, not drawn by day at all. Uniforms, not defines, so every lamp
// material is one program.
const LAMP_FRAGMENT = /* glsl */ `
  uniform float uLamps;
  uniform float uAmbient;
  uniform float uExposure;
  uniform float uOn;
  uniform float uDay;
  uniform float uPaint;
  uniform float uPane;
  varying vec3 vLit;
  void main() {
    if (uPane > 0.5 && uLamps < ${GLOW_FROM.toFixed(2)}) discard;
    gl_FragColor = vec4(vLit * (uAmbient * uPaint + uOn * max(uLamps, uDay) * ${LAMP_GAIN.toFixed(2)} / uExposure), 1.0);
  }
`
/**
 * A lamp material: `on` shines (HDR) at night, or by day too when `day`; off keeps the day look (vertex colour × ambient), a
 * signal lamp's darkened to unlit glass. One program for all of them.
 */
const lampMaterial = (on: boolean, day: boolean): ShaderMaterial =>
  new ShaderMaterial({
    uniforms: {
      uLamps: SKY_UNIFORMS.uLamps,
      uAmbient: SKY_UNIFORMS.uAmbient,
      uExposure: SKY_UNIFORMS.uExposure,
      uOn: { value: on ? 1 : 0 },
      uDay: { value: day ? 1 : 0 },
      uPaint: { value: day && !on ? LAMP_DARK : LAMP_DAY },
      uPane: { value: 0 },
    },
    vertexColors: true,
    vertexShader: VERTEX,
    fragmentShader: LAMP_FRAGMENT,
  })

/** The vehicle lamp materials (shared by every vehicle): lamps on (moving traffic, the player's car: they shine at night) and off (parked). */
export const vehicleLampMaterials = {
  on: lampMaterial(true, false),
  off: lampMaterial(false, false),
} as const
/**
 * The signal lamp materials (shared by the trains and the level crossings): on, they shine by day and night, as a train's head
 * and tail lamps and a crossing's red lights do; off, dark glass.
 */
export const signalLampMaterials = {
  on: lampMaterial(true, true),
  off: lampMaterial(false, true),
} as const

/**
 * A train's lit windows (render/train): its saloon light, on the lamp program but drawn only at night, as a house's window panes
 * are, so by day the body's own dark window band shows; at night its vertex colour × `uLamps` at a pane's gain (`GLOW_GAIN`).
 */
export const cabinLightMaterial = new ShaderMaterial({
  uniforms: {
    uLamps: SKY_UNIFORMS.uLamps,
    uAmbient: SKY_UNIFORMS.uAmbient,
    uExposure: SKY_UNIFORMS.uExposure,
    uOn: { value: GLOW_GAIN / LAMP_GAIN },
    uDay: { value: 0 },
    uPaint: { value: 0 },
    uPane: { value: 1 },
  },
  vertexColors: true,
  vertexShader: VERTEX,
  fragmentShader: LAMP_FRAGMENT,
})
