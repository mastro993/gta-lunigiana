/// <reference types="vite/client" />
/**
 * Browser host (imported by `boot.ts` once the map is in): makes the streamed world and the pixel
 * view, makes the runtime with the live keyboard, the render registries (trains included), the
 * effects (the tyre marks and smoke, the level crossings' arms and lights) and the audio director,
 * and drives everything from one FixedLoop: fixed sim steps, then once per animation frame the
 * render and audio schedules, the camera, world streaming, the frame and the HUD. While the full
 * map (M) or the settings (Esc) are open, both are skipped and the sound is suspended: the game is
 * paused. The build runs in steps the title card names; the card says "Press any key" once the
 * first frame is drawn, and the game clock stands still until it goes. In mobile mode (index.html)
 * the touch controls add to the keys.
 *
 * @module main
 */
import { FixedLoop, Result } from "@typeonce/ritmo"
import { BrowserHostClock, BrowserTickSource, Keyboard } from "@typeonce/ritmo-browser"
import { Vec2 } from "@typeonce/ritmo-math"
import { BasicShadowMap, Scene, Vector3, WebGLRenderer } from "three"

import { makeDirector } from "./audio/director/index.ts"
import { Audio, audio } from "./audio/index.ts"
import { makeSpeaker } from "./audio/speaker.ts"
import { VEHICLE_SHOTS, VEHICLE_VOICES } from "./audio/synth/vehicles.ts"
import { WORLD_SHOTS, WORLD_VOICES } from "./audio/synth/world.ts"
import type { Shots, Voices } from "./audio/types.ts"
import { makeHandlingStore } from "./hud/handling.ts"
import { makeHud, pausable, routeOverlayKeys } from "./hud/hud.ts"
import { makeSettings } from "./hud/settings.ts"
import { makeSkyStore } from "./hud/sky.ts"
import { element, holdClock, step, titleReady } from "./hud/title.ts"
import { holdLandscape, makeTouchControls, withTouch } from "./hud/touch.ts"
import { makeTrainStore } from "./hud/trains.ts"
import { groundY, yOf } from "./render/ground.ts"
import {
  Animals,
  blend,
  Crossings,
  Cut,
  Effects,
  makeEffects,
  makeRegistries,
  People,
  render,
  RenderClock,
  Sky,
  Trains,
  Vehicles,
} from "./render/index.ts"
import { PixelView, WIDEST_ZOOM, zoomFor } from "./render/pipeline.ts"
import { SeeThrough } from "./render/sightline.ts"
import { SkyHost } from "./render/sky/host.ts"
import { standIns } from "./render/stand-ins.ts"
import { type Swing, swingView } from "./render/swing.ts"
import { World } from "./render/world.ts"
import {
  bindings,
  Game,
  HandlingView,
  KeyboardInput,
  makeRuntime,
  PlayerView,
  SetClock,
  SetHandling,
  SetTrains,
  SetWeather,
  setup,
  SkyView,
  STEP,
  TrainView,
  update,
} from "./sim/index.ts"
import { mapCover } from "./sim/map/cover.ts"
import { heightAt } from "./sim/map/index.ts"
import { DAY, daysFromCivil, utcFromRome } from "./sim/sky/calendar.ts"
import { LOOK_AHEAD, QUARTER } from "./sim/view.ts"

const canvas = document.querySelector<HTMLCanvasElement>("#game")
if (canvas === null) throw new Error("index.html lacks canvas#game")

const renderer = new WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: "high-performance",
})
renderer.shadowMap.enabled = true
renderer.shadowMap.type = BasicShadowMap
renderer.info.autoReset = false // two renders per frame (scene + blit): reset once per frame instead

const scene = new Scene()
// The sun (the moon at night) on its real arc, fixed in the sky, the sky light, the weather and the night lights: every light
// and weather mesh is made here, before the first frame compiles the shaders (the clear colour too is the sky's, each frame).
const skyHost = new SkyHost(scene, { reduced: () => reduceMotion.matches })
await step(document, "Painting land cover", 0.8)
mapCover() // built once, shared by the world, the tyres' grip and the sound
await step(document, "Planting trees", 0.86)
const world = new World(scene)
await step(document, "Waking the valley", 0.92)
// Before the pixel-ratio listener below, which repaints the maps.
const hud = makeHud(document)

const view = new PixelView(renderer)
/** Screen metres from the view's centre to its corner at the widest zoom: what streaming must cover. */
const reach = () => Math.hypot(view.view.x, view.view.y) / 2 / WIDEST_ZOOM
/** Milliseconds per frame spent building chunks (at least one chunk is built when any is missing). */
const STREAM_BUDGET_MS = 4
// The page's box, not the window: a phone held upright lays the page out sideways (hud.css).
const resize = () =>
  view.resize(document.body.clientWidth, document.body.clientHeight, devicePixelRatio)
resize()
/** A resize clears the canvas, and behind the settings nothing is drawn: draw the frozen scene again (set once the settings exist). */
let redrawPaused = (): void => {}
addEventListener("resize", () => {
  resize()
  redrawPaused()
})
// Moving the window to a screen with another pixel ratio fires no resize.
let dpr = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
const onDpr = () => {
  resize()
  redrawPaused()
  hud.repaintMap()
  dpr = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
  dpr.addEventListener("change", onDpr, { once: true })
}
dpr.addEventListener("change", onDpr, { once: true })

const keyboard = Keyboard.actions(window, bindings)
const pad = document.documentElement.classList.contains("touch")
  ? makeTouchControls(document, canvas)
  : undefined
const controls = pad === undefined ? keyboard : withTouch(keyboard, pad.touch)
const renderClock = { alpha: 0 }
const { people, animals, vehicles, trains } = makeRegistries(scene)
const effects = makeEffects(scene)
// The circle that opens round the player while the world hides them, sized in texels of the view.
const cut = new SeeThrough(view, () => reduceMotion.matches)
// The speaker starts its AudioContext on the first key, click or tap from here on: pressed while loading, or the one that dismisses the title card.
const speaker = makeSpeaker(
  window,
  { ...VEHICLE_VOICES, ...WORLD_VOICES } satisfies Voices,
  { ...VEHICLE_SHOTS, ...WORLD_SHOTS } satisfies Shots,
)
const director = makeDirector(speaker)
// A new game starts today (the browser's local date) at 08:00 in Rome.
const today = new Date()
const made = makeRuntime({
  // `?seed=123` replays a world; otherwise every load is a new one.
  seed:
    Number(
      new URLSearchParams(location.search).get("seed") ?? Math.floor(Math.random() * 2 ** 32),
    ) >>> 0,
  start: utcFromRome(
    daysFromCivil(today.getFullYear(), today.getMonth() + 1, today.getDate()) * DAY + 8 * 3600,
  ),
  services: Game.Runtime.services(
    Game.Runtime.service(KeyboardInput, controls),
    Game.Runtime.service(People, people),
    Game.Runtime.service(Animals, animals),
    Game.Runtime.service(Vehicles, vehicles),
    Game.Runtime.service(Trains, trains),
    Game.Runtime.service(RenderClock, renderClock),
    Game.Runtime.service(Effects, effects),
    Game.Runtime.service(Crossings, effects.crossings),
    Game.Runtime.service(Sky, skyHost),
    Game.Runtime.service(Cut, cut),
    Game.Runtime.service(Audio, director),
  ),
  ...(import.meta.env.DEV ? { debug: { hostClock: BrowserHostClock.make(window) } } : {}),
})
if (!made.ok) throw new Error(`runtime: ${JSON.stringify(made.error)}`)
const runtime = made.value
const ready = runtime.tick(setup)
if (!ready.ok) throw new Error(`setup: ${JSON.stringify(ready.error)}`)
// The game clock stands still behind the title card (the traffic and the people move on), so the game starts at 08:00 when the
// player dismisses it: `titleReady` below runs the clock again.
const play = holdClock((request) => runtime.send(SetClock, request))
// The player's handling, set from the settings and the dev debug menu; it sets the stored choice now, which waits for
// ApplyHandling's first run in the first update. UI events and this call run between ticks, never inside one, so `send` is safe there.
const handling = makeHandlingStore({
  read: () => runtime.inspect(HandlingView),
  set: (key, value) => runtime.send(SetHandling, { key, value }),
  // Read at each call: where the browser blocks storage, `localStorage` itself throws (the store catches it).
  storage: {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  },
})
const settings = makeSettings(document, handling)
/** The full map and the settings pause the game. */
const paused = () => hud.mapOpen() || settings.open()
redrawPaused = () => {
  if (settings.open()) view.render(scene)
}
// Before the first update: the audio system starts reading the Impact, Honk and Skid events from here on.
const listening = runtime.tick(audio)
if (!listening.ok) throw new Error(`audio: ${JSON.stringify(listening.error)}`)
await step(document, "Building the first view", 0.97)
// Build everything the first frame shows now, so nothing pops in at the start.
const spawn = runtime.inspect(PlayerView)
if (spawn !== undefined)
  world.update(
    new Vector3(spawn.pose.x, groundY(spawn.pose.x, spawn.pose.y), -spawn.pose.y),
    spawn.turns * QUARTER,
    reach(),
    Infinity,
  )

const camera = { x: 0, y: 0, elevation: 0, placed: false, zoom: 8 }
let swing: Swing = { yaw: view.yaw, rate: 0, by: "keys", seat: 0 }
// The view swings through each quarter turn and follows the car, or jumps when the player asks for less motion.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)")

const draw = (frame: FixedLoop.Frame): void => {
  renderer.info.reset()
  renderClock.alpha = frame.alpha
  const drawn = runtime.tick(render, audio)
  if (!drawn.ok) console.error("render", drawn.error)
  const player = runtime.inspect(PlayerView)
  if (player === undefined) return
  const { x, y, angle } = blend(player.prev, player.pose, frame.alpha)
  // Look ahead along the velocity, not the pose change: getting in or out hops the pose a door's width.
  const lead = Vec2.clampLength(Vec2.scale(player.velocity, LOOK_AHEAD.seconds), LOOK_AHEAD.max)
  const dt = frame.elapsedSeconds
  const ease = camera.placed ? 1 - Math.exp(-5 * dt) : 1
  camera.x += (x + lead.x - camera.x) * ease
  camera.y += (y + lead.y - camera.y) * ease
  // In a train the cab's own ground, which a rail bridge has and the map's ground has not.
  const ground =
    player.z === undefined
      ? groundY(x, y, camera.placed ? camera.elevation : undefined)
      : yOf(player.z)
  camera.elevation += (ground - camera.elevation) * ease
  view.focus.set(camera.x, camera.elevation, -camera.y)
  swing = swingView(
    swing,
    player.turns,
    // The step the player gets in, PrevPose is still where they stood: land on the car's own heading.
    player.mode === "driving" ? (swing.by === "car" ? angle : player.pose.angle) : undefined,
    dt,
    !camera.placed || reduceMotion.matches,
  )
  view.yaw = swing.yaw
  camera.placed = true
  const zoom = (camera.zoom = zoomFor(player.vehicle?.speed, camera.zoom))
  view.texelsPerMetre +=
    Math.abs(zoom - view.texelsPerMetre) < 0.01
      ? zoom - view.texelsPerMetre
      : (zoom - view.texelsPerMetre) * (1 - Math.exp(-3 * dt))
  skyHost.draw(view, renderer)
  world.update(view.focus, view.yaw, reach(), STREAM_BUDGET_MS)
  view.render(scene)
  hud.update(player, x, y, angle, view.yaw, runtime.inspect(SkyView))
  pad?.draw(player)
}

// The first frame here, shader compiles included: one that throws lands on the card (boot.ts),
// where in the loop's animation frame it would stop the loop behind "Press any key". It also
// starts the render schedule reading Skid events before the first update. Every program the game
// draws is compiled first, at once, for the view's target: the scene's (the night lights and weather
// meshes included) and the stand-ins' (rivers, trees, glow, cars), so none compiles mid-game.
const warm = standIns()
view.compile(scene, warm.group)
warm.dispose()
draw({ elapsedSeconds: 0, fixedSteps: 0, alpha: 0, droppedSeconds: 0 })
// Keys pressed while loading arrive during the steps: drop their presses (held keys stay held).
controls.snapshot()
const loop = FixedLoop.start({
  source: BrowserTickSource.make(window),
  step: STEP,
  maxFrameSeconds: 0.25,
  maxStepsPerFrame: 5,
  update: pausable(paused, controls, () => runtime.tick(update), Result.success(undefined)),
  // Paused, nothing is drawn: the map covers the screen, the settings dim the last frame drawn, and actors stay put (no interpolation
  // jitter).
  render: (frame) => {
    speaker.pause(paused())
    if (!paused()) draw(frame)
  },
  onFailure: (failure) => console.error("loop stopped", failure),
})
if (!loop.ok) throw new Error(`loop: ${JSON.stringify(loop.error)}`)
// Before titleReady: the key that dismisses the card finds it still up, so it opens nothing.
const title = element(document, "title")
routeOverlayKeys(window, {
  open: () => ({ title: !title.hidden, map: hud.mapOpen(), settings: settings.open() }),
  toggleMap: hud.toggleMap,
  closeMap: hud.closeMap,
  toggleSettings: settings.toggle,
})
if (pad !== undefined) holdLandscape(window)
titleReady(window, play)

// Dev only: the Ritmo monitor (backslash toggles it), the debug menu (P: time, weather, handling, trains) and a handle for
// measuring from the console. No HMR hooks: nothing accepts updates, so Vite reloads the page on every edit.
if (import.meta.env.DEV) {
  // The clock and the weather for the debug menu and `gta.sky`; like the handling store's, its sends run between ticks.
  const sky = makeSkyStore({
    read: () => runtime.inspect(SkyView),
    setClock: (request) => runtime.send(SetClock, request),
    setWeather: (request) => runtime.send(SetWeather, request),
  })
  // The railway for the debug menu's Trains area and `gta.trains`; its call, like the stores' above, is sent between ticks.
  const railway = makeTrainStore({
    read: () => runtime.inspect(TrainView),
    send: (request) => runtime.send(SetTrains, request),
  })
  const here = () => {
    const player = runtime.inspect(PlayerView)
    return player === undefined
      ? undefined
      : { x: player.pose.x, y: player.pose.y, z: heightAt(player.pose.x, player.pose.y) }
  }
  Object.assign(window, {
    gta: {
      renderer,
      view,
      scene,
      world,
      effects,
      heightAt,
      player: () => runtime.inspect(PlayerView),
      handling: () => runtime.inspect(HandlingView),
      audio: { speaker, level: speaker.level, context: speaker.context },
      sky,
      // The see-through cut: `open` (0 shut … 1 open) and `follow`, which the render schedule calls with the player each frame.
      cut,
      // What the sky host drew last: the sky frame, the sun and moon, the light, the exposure, the fog and the weather at the focus.
      skyLook: () => skyHost.look,
      // The railway as the debug menu's Trains area shows it; `gta.trains.call()` calls the trains.
      trains: Object.assign(() => railway.now(), railway),
    },
  })
  const mountDebug = async () => {
    const debug = runtime.debug
    if (debug !== undefined) {
      const { Monitor } = await import("@typeonce/ritmo-devtools")
      void Monitor.attach({ debug }, { schedules: { update, render, audio }, host: window })
    }
    // After the monitor: the menu's button is anchored beside the monitor's, which must come first in the page.
    const { mountDebugMenu } = await import("./hud/debug.ts")
    mountDebugMenu({ window, handling, sky, trains: railway, here })
  }
  void mountDebug()
}
