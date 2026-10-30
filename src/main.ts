/// <reference types="vite/client" />
/**
 * Browser host (imported by `boot.ts` once the global map and the tiles round the start are in):
 * makes the streamed world and the pixel view, the tile stream (`stream.ts`), the runtime with the
 * live keyboard, the render registries (trains included), the effects (the tyre marks and smoke,
 * the level crossings' arms and lights) and the audio director, and drives everything from one
 * FixedLoop: fixed sim steps, then once per animation frame the tile stream, the render and audio
 * schedules, the camera, world streaming, the frame and the HUD. While the full map (M) or the
 * settings (Esc) are open, or a tile the next step reads is still downloading, both are skipped and
 * the sound is suspended: the game is paused (the tiles keep coming). A frame that throws, or a
 * loop failure, stops the loop for good and puts the title card back with the error and a reload
 * (`startGuardedLoop`, `crashed`). The build runs in steps the
 * title card names; the card says "Press any key" once the first frame is drawn, and the game clock
 * stands still until it goes. In mobile mode (index.html) the touch controls add to the keys.
 *
 * @module main
 */
import { type FixedLoop, Result } from "@typeonce/ritmo"
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
import { makeHud, pausable, routeOverlayKeys, startGuardedLoop } from "./hud/hud.ts"
import { makeSettings } from "./hud/settings.ts"
import { makeSkyStore } from "./hud/sky.ts"
import { crashed, element, holdClock, step, stopped, titleReady } from "./hud/title.ts"
import { holdLandscape, makeTouchControls, withTouch } from "./hud/touch.ts"
import { makeTrainStore } from "./hud/trains.ts"
import { mapForSearch } from "./maps.ts"
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
  type PlayerViewModel,
  SetClock,
  SetHandling,
  SetPlayer,
  SetTrains,
  SetWeather,
  setup,
  SkyView,
  STEP,
  TrainView,
  update,
} from "./sim/index.ts"
import { coarseHeightAt } from "./sim/map/coarse.ts"
import { heightAt, MAP } from "./sim/map/index.ts"
import {
  dropTile,
  isResidentAt,
  provideTile,
  residentTiles,
  STEP_REACH,
  tilesOver,
} from "./sim/map/tiles.ts"
import { DAY, daysFromCivil, utcFromRome } from "./sim/sky/calendar.ts"
import { LOOK_AHEAD, QUARTER } from "./sim/view.ts"
import { makeTileStream } from "./stream.ts"

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
await step(document, "Planting trees", 0.86)
const world = new World(scene)
// The tiles boot.ts handed over cover the start; from here on the stream brings them in round the player and the view.
for (const key of residentTiles()) world.tileProvided(key)
const stream = makeTileStream({
  url: mapForSearch(location.search).tileUrl,
  over: tilesOver,
  resident: residentTiles,
  provide: provideTile,
  drop: dropTile,
  reach: STEP_REACH,
  onProvided: (key) => world.tileProvided(key),
  onDropped: (key) => world.tileDropped(key),
})
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
/**
 * Whether a tile the next step reads is not in memory yet, set each animation frame after the
 * stream's update. Not at the start: boot.ts handed over every tile within `NEAR` of it, more than
 * a step reads.
 */
let waiting = false
/** Whether the game stopped for good: a tile it needs will never come (`stream.gone`), or a frame threw. */
let lost = false
/** The full map and the settings pause the game, and so does a missing tile. */
const paused = () => hud.mapOpen() || settings.open() || waiting
redrawPaused = () => {
  if (!lost && settings.open()) view.render(scene)
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
/** The camera trails the player by at most about 26 m (its lead and its easing); farther than this (m) the player jumped. */
const CUT_BEYOND = 200
let swing: Swing = { yaw: view.yaw, rate: 0, by: "keys", seat: 0 }
// The view swings through each quarter turn and follows the car, or jumps when the player asks for less motion.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)")

/** Draws the frame for `player` (the PlayerView before the render tick, which changes no world state). */
const draw = (frame: FixedLoop.Frame, player: PlayerViewModel | undefined): void => {
  renderer.info.reset()
  renderClock.alpha = frame.alpha
  const drawn = runtime.tick(render, audio)
  if (!drawn.ok) console.error("render", drawn.error)
  if (player === undefined) return
  const { x, y, angle } = blend(player.prev, player.pose, frame.alpha)
  // After a jump (the respawn, a teleport) the camera cuts to the player instead of gliding over tiles no longer in memory.
  if (Math.hypot(x - camera.x, y - camera.y) > CUT_BEYOND) camera.placed = false
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

// The first frame here, shader compiles included: one that throws fails start-up on the card
// (boot.ts) with the step's name, where in the loop it would only say the game stopped. It also
// starts the render schedule reading Skid events before the first update. Every program the game
// draws is compiled first, at once, for the view's target: the scene's (the night lights and weather
// meshes included) and the stand-ins' (rivers, trees, glow, cars), so none compiles mid-game.
const warm = standIns()
view.compile(scene, warm.group)
warm.dispose()
draw({ elapsedSeconds: 0, fixedSteps: 0, alpha: 0, droppedSeconds: 0 }, runtime.inspect(PlayerView))
// Keys pressed while loading arrive during the steps: drop their presses (held keys stay held).
controls.snapshot()
/** A dev teleport (`gta.teleport`) waiting for its tiles: sent once they are in memory, forgotten once the player stands there. */
let jump:
  | { readonly x: number; readonly y: number; readonly angle: number; sent: boolean }
  | undefined
/** Since when (ms) the game has waited for a tile; "Loading map…" shows once it is longer than `HINT_MS`. */
let stalled: number | undefined
const HINT_MS = 300
/** Steps before the respawn from which the game waits for the start's tiles (1 s); before that they only download. */
const RESPAWN_WAIT = 60
/**
 * Runs the tile stream for the player as the last step left them and sets `waiting`. The tiles
 * round the start come in too while the player is dead (the respawn puts them there), and the game
 * waits for them only in the last second before it; the tiles round a dev teleport's goal come in
 * until the player is there.
 */
const follow = (player: PlayerViewModel): void => {
  const { pose } = player,
    dead = player.mode === "dead"
  const extra = dead ? MAP.spawns.player : jump
  stream.update(pose, extra, world.wanted())
  waiting = !stream.ready(pose, dead && (player.respawnIn ?? 0) > RESPAWN_WAIT ? undefined : extra)
  if (waiting && !lost && stream.gone().length > 0) {
    lost = true
    stopped(
      document,
      `The map changed since this page loaded (tile ${stream.gone()[0]} is gone): reload to play on.`,
    )
  }
  const now = performance.now()
  stalled = waiting ? (stalled ?? now) : undefined
  hud.loadingMap(!lost && stalled !== undefined && now - stalled > HINT_MS)
  if (jump === undefined || dead) return
  if (!jump.sent && !waiting) {
    runtime.send(SetPlayer, { x: jump.x, y: jump.y, angle: jump.angle })
    jump.sent = true
  } else if (jump.sent && Math.hypot(pose.x - jump.x, pose.y - jump.y) < 2) jump = undefined
}
const loop = startGuardedLoop(
  {
    source: BrowserTickSource.make(window),
    step: STEP,
    maxFrameSeconds: 0.25,
    maxStepsPerFrame: 5,
    update: pausable(paused, controls, () => runtime.tick(update), Result.success(undefined)),
    // Paused, nothing is drawn: the map covers the screen, the settings dim the last frame drawn, and actors stay put (no interpolation
    // jitter). The tiles come in all the same.
    render: (frame) => {
      const player = runtime.inspect(PlayerView)
      if (player !== undefined) follow(player)
      speaker.pause(paused())
      if (!paused()) draw(frame, player)
    },
  },
  // A frame threw or the loop failed: the loop has stopped, so silence it and put the card back (unless a lost tile already has).
  (error) => {
    speaker.pause(true)
    hud.loadingMap(false)
    if (lost) console.error("game stopped", error)
    else crashed(document, error)
    lost = true
  },
)
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
      // The terrain's height at (x, y): exact where its tile is in memory, else the coarse grid's (a spot far off still answers).
      heightAt: (x: number, y: number) =>
        isResidentAt(x, y) ? heightAt(x, y) : coarseHeightAt(x, y),
      player: () => runtime.inspect(PlayerView),
      // The tiles in memory, in key order, and a jump to (x, y) facing `angle`, made once the tiles there are in.
      tiles: () => residentTiles(),
      teleport: (x: number, y: number, angle: number): void => {
        jump = { x, y, angle, sent: false }
      },
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
