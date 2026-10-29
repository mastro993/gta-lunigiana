/**
 * The sky host: the page's one sky. The render schedule's DrawSky hands it the game clock, the
 * weather, the sim time, the steps' lightning and the cars with lamps on; once the camera has moved,
 * `draw` works out this frame's light (`light.ts`) and the sky frame every effect reads, then drives
 * the key light (the sun, or the moon at night) and its shadow box, the hemisphere, the clear colour,
 * the shared uniforms, the post pass's fog and exposure, the rain and snow, the bolts and the night
 * light pool, and hands the surface weather (snow, wet ground, cloud shadows, sway) its uniforms.
 * Every light and weather mesh is made here at construction, before the first frame
 * compiles the shaders, and is driven only by colour and intensity after. Host state for the page's
 * life: it is recomputed from the saved clock and weather each frame, so a loaded save needs nothing.
 *
 * @module render/sky/host
 */
import { Color, DirectionalLight, HemisphereLight, type Object3D, Vector2, Vector3 } from "three"

import { type LightningValue, STEP, type WeatherValue } from "../../sim/index.ts"
import { moonAt, moonPhase } from "../../sim/sky/astro.ts"
import { airAt } from "../../sim/sky/climate.ts"
import { sunOver } from "../../sim/sky/day.ts"
import { conditionsAt, type FogLayers, fogLayers, windAt } from "../../sim/sky/local.ts"
import { place } from "../../sim/sky/place.ts"
import { linear } from "../geometry.ts"
import { farTerrainY, yOf } from "../ground.ts"
import { PALETTE } from "../palette.ts"
import { followSun, type PixelView, viewAxes, WIDEST_ZOOM } from "../pipeline.ts"
import { type SkyFrame } from "./frame.ts"
import {
  aimToward,
  type Aim,
  ease,
  easeLog,
  keyDirection,
  type Lighting,
  luminance,
  noonLight,
  type Rgb,
  skyLight,
} from "./light.ts"
import { Bolts } from "./lightning.ts"
import { type LitCar, NightLights } from "./night-lights.ts"
import { atmosphere, writePost } from "./post.ts"
import { Precipitation } from "./precipitation.ts"
import { applySurface, driftClouds } from "./surface.ts"
import { applyFrame } from "./uniforms.ts"

/** The key light's shadow map, texels a side, and normal bias, m (depth bias and range: followSun). */
const SHADOW = { size: 2048, normalBias: 0.05 } as const
/** Under this key-light intensity the shadow pass is skipped (night without a moon): the biggest GPU item, saved without a recompile. */
const KEY_DARK = 0.002
/** The eye adapts with this time constant, s of sim time; the lamps fade on and off with this one. */
const ADAPT_TAU = 1.5
const LAMPS_TAU = 1.2
/** A clock jump (the dev menu) of more than this many game seconds beyond the clock's run lands the exposure and the lamps at once. */
const JUMP = 1800
/** Longest frame step eased, s. */
const MAX_DT = 0.25
/** A full lightning flash adds this much up-face light on screen (× the flash colour, over the exposure): about a clear noon's, briefly. */
const FLASH_LIGHT = 2.4
const FLASH = linear(PALETTE.flash)
const FOREST = linear(PALETTE.forestDark)

/** The sim's sky this frame, as DrawSky reads it. */
interface SkyRead {
  /** Game time (Unix UTC s, fractional: seconds + alpha · rate), the clock's rate, the weather, and sim time (s). */
  readonly seconds: number
  readonly rate: number
  readonly weather: WeatherValue
  readonly now: number
  /** What the rivers carry, m³/s per km² (`SkyViewModel.flow`). */
  readonly flow: number
}

/** What the sky host reads of the view (a `PixelView`): where it looks, its turn and zoom, its size, its post uniforms and its shadow fit. */
type HostView = Pick<PixelView, "focus" | "yaw" | "texelsPerMetre" | "view" | "post" | "shadowFit">
/** What the sky host sets on the renderer (a `WebGLRenderer`): the shadow pass's switch and the clear colour. */
interface HostRenderer {
  readonly shadowMap: { autoUpdate: boolean; needsUpdate: boolean }
  setClearColor(color: Color): unknown
}

/** What the sky host drew last frame, for the dev handle `gta.skyLook`. */
export interface SkyLook {
  readonly frame: SkyFrame
  readonly sun: { readonly elevation: number; readonly azimuth: number }
  readonly moon: { readonly elevation: number; readonly azimuth: number; readonly lit: number }
  readonly light: Lighting
  readonly aim: Aim
  readonly exposure: number
  readonly shadows: boolean
  readonly fog: FogLayers
  readonly here: ReturnType<typeof conditionsAt>
}

const setRgb = (c: Color, rgb: Rgb, k = 1): Color => c.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k)

/** The page's sky: make it once, before the first frame, and add nothing to the scene's lights after. */
export class SkyHost {
  /** The key light: the sun by day, the moon by night (one light, one shadow map: no recompiles). */
  readonly key = new DirectionalLight(PALETTE.sun, 2)
  /** Sky from above, bounce from the ground: shaded walls stay readable. */
  readonly hemisphere = new HemisphereLight(PALETTE.skyNoon, PALETTE.groundNoon, 1.8)
  /** Rain and snow around the focus. */
  readonly precipitation = new Precipitation()
  /** Lightning bolts and the scene flash. */
  readonly bolts: Bolts
  /** Headlight beams and street-lamp lights. */
  readonly lights: NightLights
  /** Toward the key light this frame, three space, where it really stands (cast from at least SHADOW_FLOOR up). */
  readonly toKey = new Vector3()
  /** The sky frame drawn last. */
  frame: SkyFrame | undefined
  /** What was drawn last (dev handle). */
  look: SkyLook | undefined
  private read: SkyRead | undefined
  private readonly strikes: Array<LightningValue> = []
  private readonly cars: Array<LitCar> = []
  private readonly reduced: () => boolean
  private aim: Aim | undefined
  private exposure = 1
  private lamps = 0
  private last: SkyRead | undefined
  private shadows = true
  private axes = viewAxes(0)
  private axesYaw = 0
  private readonly clear = new Color()
  private readonly skyRadiance = new Color()
  /** How far the cloud shadows have drifted with the wind, map metres. */
  private readonly clouds = new Vector2()

  /** Makes every light and weather mesh and adds them to `scene`; `reduced` says, each frame, whether the player asks for less motion (bolts stop flickering). */
  constructor(scene: Object3D, options: { readonly reduced: () => boolean }) {
    this.reduced = options.reduced
    this.key.castShadow = true
    this.key.shadow.mapSize.set(SHADOW.size, SHADOW.size)
    this.key.shadow.normalBias = SHADOW.normalBias
    this.bolts = new Bolts() // `reduced` is read each frame
    scene.add(
      this.key,
      this.key.target,
      this.hemisphere,
      this.precipitation.object,
      this.bolts.object,
    )
    this.lights = new NightLights(scene)
  }

  /** DrawSky: the game time `seconds` (fractional), the clock's `rate`, the `weather`, sim time `now` (s) and the rivers' `flow` (m³/s per km²) this frame; the cars' list starts empty. */
  sky(seconds: number, rate: number, weather: WeatherValue, now: number, flow: number): void {
    this.read = { seconds, rate, weather, now, flow }
    this.cars.length = 0
  }

  /** DrawSky: a `Lightning` event from the steps since the last frame. */
  strike(lightning: LightningValue): void {
    this.strikes.push(lightning)
  }

  /** DrawSky: a car with its lamps on this frame (traffic, and the player's). */
  car(car: LitCar): void {
    this.cars.push(car)
  }

  /** After the camera has moved: this frame's light, shadows, fog, rain, bolts and night lights for `view`. */
  draw(view: HostView, renderer: HostRenderer): void {
    const read = this.read
    if (read === undefined) return
    const { seconds, weather, now } = read,
      focus = view.focus
    const x = focus.x,
      y = -focus.z,
      z = focus.y - yOf(0)
    const last = this.last,
      dt = last === undefined ? 0 : Math.min(MAX_DT, Math.max(0, now - last.now))
    const jumped =
      last === undefined ||
      Math.abs(seconds - last.seconds) > JUMP + (Math.abs(read.rate) * dt) / STEP.dt
    this.last = read

    // The sun and the moon over the loaded map's origin (`sunOver` reads the same place).
    const { lat, lon } = place(),
      sun = sunOver(seconds),
      moon = moonAt(seconds, lat, lon),
      lit = moonPhase(sun, moon).illuminated
    const here = conditionsAt(seconds, weather, x, y, z),
      fog = fogLayers(seconds, weather)
    const light = skyLight({
      sun,
      moon,
      moonLit: lit,
      cloud: weather.cloud,
      precip: here.rain + here.snow,
      storm: weather.storm,
      fog: here.fog,
      snowCover: here.snowCover,
    })
    this.exposure = jumped ? light.exposure : easeLog(this.exposure, light.exposure, dt, ADAPT_TAU)
    this.lamps = jumped ? light.lamps : ease(this.lamps, light.lamps, dt, LAMPS_TAU)
    const exposure = this.exposure

    this.bolts.reduced = this.reduced()
    for (const l of this.strikes)
      this.bolts.strike(l, farTerrainY(l.x, l.y), l.step * STEP.dt, focus)
    this.strikes.length = 0
    const flash = this.bolts.update({ now }),
      flashLight = (flash * FLASH_LIGHT) / exposure

    // The key light: aimed in steps (hard shadow edges must not crawl), fixed in the sky whichever way the view looks; its shadow pass skipped when it is dark.
    const key = light.key
    this.aim = aimToward(this.aim, key.azimuth, key.elevation)
    keyDirection(this.aim, this.toKey)
    setRgb(this.key.color, key.color)
    this.key.intensity = key.intensity
    followSun(
      this.key,
      focus,
      this.toKey,
      view.shadowFit(this.toKey, (gx, gz) => farTerrainY(gx, -gz)),
    )
    // Dark, or every texel under an overcast sky's cloud shadow: no shadow to draw.
    const shadows = key.intensity * light.direct > KEY_DARK
    if (shadows !== this.shadows || this.frame === undefined) {
      renderer.shadowMap.autoUpdate = shadows
      // Once on the first frame (it notes the shadow type there, on the title card), and whenever it comes back.
      renderer.shadowMap.needsUpdate = true
      this.shadows = shadows
    }

    // The hemisphere carries the flash: one smooth pulse of light over the whole scene, as bright on screen by day as by night.
    const sky: Rgb = [
      light.sky[0] * light.hemisphere + FLASH[0] * flashLight,
      light.sky[1] * light.hemisphere + FLASH[1] * flashLight,
      light.sky[2] * light.hemisphere + FLASH[2] * flashLight,
    ]
    const ground: Rgb = [
      light.ground[0] * light.hemisphere + FLASH[0] * flashLight * 0.5,
      light.ground[1] * light.hemisphere + FLASH[1] * flashLight * 0.5,
      light.ground[2] * light.hemisphere + FLASH[2] * flashLight * 0.5,
    ]
    setRgb(this.hemisphere.color, sky)
    setRgb(this.hemisphere.groundColor, ground)
    this.hemisphere.intensity = 1
    const irradiance = light.irradiance + flashLight * luminance(FLASH)
    // Where nothing is drawn (off the map), dark forest lit like the ground.
    renderer.setClearColor(setRgb(this.clear, FOREST, irradiance / noonLight()))

    const frame: SkyFrame = {
      now,
      night: light.night,
      lamps: this.lamps,
      ambient: irradiance / noonLight(),
      flash,
      wind: windAt(weather, z),
      rain: here.rain,
      snow: here.snow,
    }
    this.frame = frame
    applyFrame(frame, exposure)
    // The fog gathers the key light that comes through the clouds as level ground takes it: a low sun only grazes its top.
    const through =
      key.intensity * light.direct * Math.max(0, Math.sin((key.elevation * Math.PI) / 180))
    const keyLight: Rgb = [key.color[0] * through, key.color[1] * through, key.color[2] * through]
    // A flash lights the dark too: the night grade lifts while it lasts.
    writePost(view.post, atmosphere(fog, here, { key: keyLight, sky, ground }), {
      exposure,
      night: light.night * (1 - flash),
      grey: light.grey,
      x: focus.x,
      y: focus.y,
      z: focus.z,
    })

    if (view.yaw !== this.axesYaw) [this.axes, this.axesYaw] = [viewAxes(view.yaw), view.yaw]
    applySurface({
      snowLine: weather.snowLine,
      wet: weather.wet,
      air: airAt(seconds, weather, sun),
      cloudCover: weather.cloud,
      cloudOffset: driftClouds(this.clouds, frame.wind, dt),
      wind: frame.wind,
      rain: here.rain,
      flow: read.flow,
      texelsPerMetre: view.texelsPerMetre,
      viewRight: this.axes.right,
      // A mirror shows the sky's radiance: a white Lambert face under the hemisphere's sky colour (× its intensity 1) returns it / π.
      skyColour: this.skyRadiance.copy(this.hemisphere.color).multiplyScalar(1 / Math.PI),
    })
    this.precipitation.update(frame, focus, this.axes, view.texelsPerMetre, {
      width: view.view.x / WIDEST_ZOOM,
      height: view.view.y / WIDEST_ZOOM,
    })
    this.lights.update(frame, focus, this.cars)
    this.look = {
      frame,
      sun: { elevation: sun.elevation, azimuth: sun.azimuth },
      moon: { elevation: moon.elevation, azimuth: moon.azimuth, lit },
      light,
      aim: this.aim,
      exposure,
      shadows,
      fog,
      here,
    }
  }
}
