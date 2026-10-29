// The CDP bot of the map runbook: drives an already-running headless Chrome over its remote-debugging
// port (start it as docs/standards/playtest.md step 2 says), each run in a new tab of its own,
// closed at the end, at 1280×720 and a device pixel ratio of 1.
// Run: node src/tools/playtest.ts shots <url> <outdir> <name>:<x>,<y>[,<texels/m>] … [map] [--port N] [--wait s]
//      node src/tools/playtest.ts heap <url> [--port N] [--seconds s]  (pnpm playtest …)
//      node src/tools/playtest.ts drive <url> [--port N] [--speed m/s] [--seconds s] [--route x1,y1,x2,y2,…]
// - shots needs a dev build (`pnpm exec vite`), whose page has `window.gta`, and fails on a
//   production one. It dismisses the title card, then for each spot shows only the canvas, pins the
//   zoom when given (texels per metre; else the game's own), pins the view's focus on the ground at
//   (x east, y north) in map metres, waits --wait s (6) for the world to stream and writes
//   <outdir>/<name>.png. `map` opens the full map (M) with the HUD shown and writes map.png.
// - heap works on dev and production builds (`pnpm build && pnpm preview`). It reports the first
//   frame (s from navigation start to the card's "Press any key", which the game shows once its
//   first frame is drawn), the slowest frame and the 99th percentile over --seconds s (10) after the
//   card goes (ms between animation frames), and the JS heap after a forced GC (MB, 10^6 bytes), as
//   one JSON line.
// - drive needs a dev build too (`gta.teleport`, `gta.tiles`). It dismisses the title card, puts the
//   player at the route's start and waits for the resident tiles to hold still, then each animation
//   frame teleports the player to where --speed m/s (40) has reached along the route (held at its
//   end) for --seconds s (the route's length at that speed). The route is --route's points (map
//   metres), else the SP59 from Monzone to Vinca out of the global map file. It reports, as one JSON
//   line, the slowest frame and the 99th percentile, the slowest frame within 1 s of each tile-seam
//   crossing, the most tiles resident at once, the tiles resident at the end and the heap after GC.
// The port defaults to 9333.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { parseArgs } from "node:util"

import { evaluate, openTab, press, type Tab } from "./cdp.ts"
import {
  defaultRoute,
  driveReport,
  driveScript,
  endOf,
  type Frame,
  frameStats,
  lengthOf,
} from "./playtest-drive.ts"

const USAGE = `usage: node src/tools/playtest.ts shots <url> <outdir> <name>:<x>,<y>[,<texels/m>] … [map] [--port N] [--wait s]
       node src/tools/playtest.ts heap <url> [--port N] [--seconds s]
       node src/tools/playtest.ts drive <url> [--port N] [--speed m/s] [--seconds s] [--route x1,y1,x2,y2,…]
shots and drive need a dev build (pnpm exec vite: window.gta); heap works on dev and production builds`

/** A place to shoot: x east and y north in map metres, at `zoom` texels per metre when set; or the full map. */
type Spot =
  | {
      readonly kind: "spot"
      readonly name: string
      readonly x: number
      readonly y: number
      readonly zoom?: number
    }
  | { readonly kind: "map" }

/** A parsed command line. */
export type Command =
  | {
      readonly command: "shots"
      readonly url: string
      readonly outdir: string
      readonly spots: ReadonlyArray<Spot>
      readonly port: number
      readonly waitS: number
    }
  | {
      readonly command: "heap"
      readonly url: string
      readonly port: number
      readonly seconds: number
    }
  | {
      readonly command: "drive"
      readonly url: string
      readonly port: number
      /** m/s along the route. */
      readonly speed: number
      /** Unset: the route's length at `speed`. */
      readonly seconds?: number
      /** Flat x, y pairs in map metres; unset: `defaultRoute()`. */
      readonly route?: ReadonlyArray<number>
    }

/** Parses `map` or `<name>:<x>,<y>[,<texels/m>]`; the name becomes a file name, so it holds only letters, digits, `_` and `-`. */
export const parseSpot = (text: string): Spot => {
  if (text === "map") return { kind: "map" }
  const match = /^([\w-]+):([^,]+),([^,]+)(?:,([^,]+))?$/.exec(text)
  const [x, y, zoom] = [match?.[2], match?.[3], match?.[4]].map((v) =>
    v === undefined ? undefined : Number(v),
  )
  if (match === null || !Number.isFinite(x) || !Number.isFinite(y))
    throw new Error(`bad spot "${text}": want <name>:<x>,<y>[,<texels/m>] or map`)
  if (zoom !== undefined && !(zoom > 0)) throw new Error(`bad zoom in "${text}": want texels/m > 0`)
  return { kind: "spot", name: match[1]!, x: x!, y: y!, ...(zoom === undefined ? {} : { zoom }) }
}

const positive = (text: string | undefined, fallback: number, flag: string): number => {
  const value = text === undefined ? fallback : Number(text)
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`bad ${flag} "${text}"`)
  return value
}

const parseRoute = (text: string): Array<number> => {
  const route = text.split(",").map((v) => (v.trim() === "" ? Number.NaN : Number(v)))
  if (route.length < 4 || route.length % 2 !== 0 || !route.every(Number.isFinite))
    throw new Error(`bad --route "${text}": want x1,y1,x2,y2,… (two points or more)`)
  return route
}

/** Parses the arguments after the script's name; throws on a bad line (the CLI prints the usage after the error). */
export const parseCli = (argv: ReadonlyArray<string>): Command => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      port: { type: "string" },
      wait: { type: "string" },
      seconds: { type: "string" },
      speed: { type: "string" },
      route: { type: "string" },
    },
  })
  const port = positive(values.port, 9333, "--port")
  if (!Number.isInteger(port) || port > 65_535) throw new Error(`bad --port "${values.port}"`)
  const [command, url, ...rest] = positionals
  if (url !== undefined && !URL.canParse(url)) throw new Error(`bad url "${url}"`)
  if (command === "shots" && url !== undefined && rest.length >= 2) {
    const [outdir, ...spots] = rest as [string, ...Array<string>]
    return {
      command,
      url,
      outdir,
      spots: spots.map(parseSpot),
      port,
      waitS: positive(values.wait, 6, "--wait"),
    }
  }
  if (command === "heap" && url !== undefined && rest.length === 0)
    return { command, url, port, seconds: positive(values.seconds, 10, "--seconds") }
  if (command === "drive" && url !== undefined && rest.length === 0)
    return {
      command,
      url,
      port,
      speed: positive(values.speed, 40, "--speed"),
      ...(values.seconds === undefined
        ? {}
        : { seconds: positive(values.seconds, 0, "--seconds") }),
      ...(values.route === undefined ? {} : { route: parseRoute(values.route) }),
    }
  throw new Error("missing or extra arguments")
}

/**
 * The page script for a spot: shows only the canvas, pins the zoom when the spot has one (and frees
 * a zoom an earlier spot pinned when it has none), and pins the focus as docs/standards/playtest.md
 * step 5 does: on the ground (the render's y is the elevation − 200) at x east, z = −y north. It
 * returns the ground's elevation there, m.
 */
export const spotScript = (spot: Extract<Spot, { kind: "spot" }>): string => `(() => {
  for (const el of document.body.children) el.style.visibility = el.id === "game" ? "" : "hidden"
  const view = gta.view, zoom = ${spot.zoom ?? "undefined"}
  if (zoom !== undefined)
    Object.defineProperty(view, "texelsPerMetre", { get: () => zoom, set: () => {}, configurable: true })
  else if (Object.getOwnPropertyDescriptor(view, "texelsPerMetre").get !== undefined)
    Object.defineProperty(view, "texelsPerMetre", { value: view.texelsPerMetre, writable: true, configurable: true, enumerable: true })
  const f = view.focus
  f.set = function () { return this }
  f.x = ${spot.x}; f.y = gta.heightAt(${spot.x}, ${spot.y}) - 200; f.z = ${-spot.y}
  return gta.heightAt(${spot.x}, ${spot.y})
})()`

/** Shows only the canvas and the HUD (the full map is in the HUD). */
const MAP_SCRIPT = `for (const el of document.body.children) el.style.visibility = el.id === "game" || el.id === "hud" ? "" : "hidden"`

/** Records when the title card's "Press any key" shows (`titleReady` in src/hud/title.ts), the game's first frame, in ms. */
const FIRST_FRAME_SCRIPT = `new MutationObserver((records, observer) => {
  for (const r of records)
    if (r.target.id === "title-go" && !r.target.hidden) {
      window.__firstFrame = performance.now()
      observer.disconnect()
      return
    }
}).observe(document, { subtree: true, attributes: true, attributeFilter: ["hidden"] })`

/** Resolves to the ms between animation frames over `seconds` s (or, without frames, 5 s past them). */
const framesScript = (seconds: number): string => `new Promise((done) => {
  const deltas = [], end = performance.now() + ${seconds * 1000}
  let last
  const tick = (t) => {
    if (last !== undefined) deltas.push(t - last)
    last = t
    if (t < end) requestAnimationFrame(tick)
    else done(deltas)
  }
  requestAnimationFrame(tick)
  setTimeout(() => done(deltas), ${seconds * 1000 + 5000})
})`

/** The card's state: its error, "ready" once it says "Press any key", else "". */
const READY_SCRIPT = `(() => {
  const error = document.getElementById("title-error")
  if (error !== null && !error.hidden) return "error: " + error.textContent
  return document.getElementById("title-go")?.hidden === false ? "ready" : ""
})()`

/** What every load sets: the viewport the shots and docs/standards/playtest.md use. */
const METRICS = { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }
/** Longest wait for the title card to say "Press any key": a cold dev server transforms every module first. */
const LOAD_TIMEOUT_MS = 180_000

/** Loads `url` at 1280×720 (running `init` first in each new document) and waits for "Press any key"; returns the s it took. */
const load = async (tab: Tab, url: string, init?: string): Promise<number> => {
  tab.on("Runtime.exceptionThrown", (params) => {
    const details = params.exceptionDetails as {
      text: string
      exception?: { description?: string }
    }
    console.error("page error:", details.exception?.description ?? details.text)
  })
  await tab.send("Page.enable")
  await tab.send("Runtime.enable")
  await tab.send("Emulation.setDeviceMetricsOverride", METRICS)
  await tab.send("Emulation.setFocusEmulationEnabled", { enabled: true })
  if (init !== undefined) await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: init })
  const start = performance.now()
  const { errorText } = await tab.send<{ errorText?: string }>("Page.navigate", { url })
  if (errorText !== undefined) throw new Error(`cannot load ${url}: ${errorText}`)
  while (performance.now() - start < LOAD_TIMEOUT_MS) {
    // Between documents the page has no context to evaluate in: try again.
    const state = await evaluate<string>(tab, READY_SCRIPT).catch(() => "")
    if (state === "ready") return (performance.now() - start) / 1000
    if (state.startsWith("error")) throw new Error(`the game failed to start: ${state.slice(7)}`)
    await sleep(100)
  }
  throw new Error(`the title card never said "Press any key" in ${LOAD_TIMEOUT_MS / 1000} s`)
}

/** Presses X (no binding) to dismiss the title card, and checks it went. */
const dismissTitle = async (tab: Tab): Promise<void> => {
  await press(tab, "x", "KeyX", 88)
  await sleep(200)
  if (!(await evaluate<boolean>(tab, `document.getElementById("title").hidden`)))
    throw new Error("the title card stayed up after a key press")
}

/** Throws unless the page is a dev build whose `window.gta` has the functions `mode` calls. */
const needDevBuild = async (
  tab: Tab,
  mode: string,
  functions: ReadonlyArray<string>,
): Promise<void> => {
  const names = JSON.stringify(functions)
  if (
    !(await evaluate<boolean>(tab, `${names}.every((f) => typeof window.gta?.[f] === "function")`))
  )
    throw new Error(
      `the page has no window.gta with ${functions.join(", ")}: ${mode} needs a dev build (pnpm exec vite), not pnpm preview`,
    )
}

/** The JS heap after a forced GC, MB (10^6 bytes). */
const heapAfterGc = async (tab: Tab): Promise<number> => {
  await tab.send("HeapProfiler.enable")
  await tab.send("HeapProfiler.collectGarbage")
  return Math.round((await evaluate<number>(tab, "performance.memory.usedJSHeapSize")) / 1e6)
}

/** A value in ms or s to a tenth, as the reports print it. */
const tenths = (value: number): number => Math.round(value * 10) / 10

const shoot = async (tab: Tab, path: string): Promise<void> => {
  const { data } = await tab.send<{ data: string }>("Page.captureScreenshot", { format: "png" })
  writeFileSync(path, Buffer.from(data, "base64"))
  console.log("shot", path)
}

const shots = async (tab: Tab, command: Extract<Command, { command: "shots" }>): Promise<void> => {
  const seconds = await load(tab, command.url)
  console.log(`ready in ${seconds.toFixed(1)} s`)
  await needDevBuild(tab, "shots", ["heightAt"])
  await dismissTitle(tab)
  mkdirSync(command.outdir, { recursive: true })
  for (const spot of command.spots) {
    if (spot.kind === "map") {
      await evaluate(tab, MAP_SCRIPT)
      await press(tab, "m", "KeyM", 77)
      await sleep(1500)
      await shoot(tab, join(command.outdir, "map.png"))
      await press(tab, "m", "KeyM", 77)
      continue
    }
    // A spot off the tiles in memory gets the coarse grid's height first; the view's tiles then stream in, and the second pin
    // stands the focus on the exact ground.
    await evaluate<number>(tab, spotScript(spot))
    await sleep(2000)
    const elevation = await evaluate<number>(tab, spotScript(spot))
    console.log(`${spot.name}: ${spot.x}, ${spot.y}, ground at ${elevation.toFixed(1)} m`)
    await sleep(command.waitS * 1000)
    await shoot(tab, join(command.outdir, `${spot.name}.png`))
  }
}

const heap = async (tab: Tab, command: Extract<Command, { command: "heap" }>): Promise<void> => {
  await load(tab, command.url, FIRST_FRAME_SCRIPT)
  const firstFrame = await evaluate<number | undefined>(tab, "window.__firstFrame")
  if (firstFrame === undefined) throw new Error("the first frame went unrecorded")
  await dismissTitle(tab)
  // The script resolves by seconds + 5 s: its command waits 5 s longer than that.
  const { slowest, p99 } = frameStats(
    await evaluate<Array<number>>(
      tab,
      framesScript(command.seconds),
      command.seconds * 1000 + 10_000,
    ),
  )
  console.log(
    JSON.stringify({
      url: command.url,
      firstFrameS: Math.round(firstFrame / 10) / 100,
      slowestFrameMs: tenths(slowest),
      p99FrameMs: tenths(p99),
      heapMB: await heapAfterGc(tab),
    }),
  )
}

/** Puts the player at (x, y) facing `angle` and waits until the resident tiles hold still for 1 s (20 s at most). */
const settle = async (tab: Tab, x: number, y: number, angle: number): Promise<void> => {
  await evaluate(tab, `gta.teleport(${x}, ${y}, ${angle})`)
  let held = "",
    still = 0
  for (let k = 0; k < 80 && still < 4; k++) {
    await sleep(250)
    const now = await evaluate<string>(tab, "gta.tiles().join()")
    still = now === held ? still + 1 : 0
    held = now
  }
}

const drive = async (tab: Tab, command: Extract<Command, { command: "drive" }>): Promise<void> => {
  const route = command.route ?? defaultRoute()
  const length = lengthOf(route),
    seconds = command.seconds ?? length / command.speed
  await load(tab, command.url)
  await needDevBuild(tab, "drive", ["player", "teleport", "tiles"])
  await dismissTitle(tab)
  const start = endOf(route, false)
  await settle(tab, start.x, start.y, Math.atan2(route[3]! - start.y, route[2]! - start.x))
  // On stderr: stdout holds only the report's JSON line, as heap's does.
  console.error(`driving ${Math.round(length)} m at ${command.speed} m/s for ${tenths(seconds)} s`)
  // The script resolves by seconds + 5 s: its command waits 5 s longer than that.
  const frames = await evaluate<Array<Frame>>(
    tab,
    driveScript(route, command.speed, seconds),
    seconds * 1000 + 10_000,
  )
  const { slowest, p99, seams, slow, maxTiles } = driveReport(frames)
  const tiles = await evaluate<Array<string>>(tab, "gta.tiles()")
  console.log(
    JSON.stringify({
      url: command.url,
      speed: command.speed,
      routeM: Math.round(length),
      seconds: tenths((frames.at(-1)?.[0] ?? 0) / 1000),
      slowestFrameMs: tenths(slowest),
      p99FrameMs: tenths(p99),
      seamFrameMs: tenths(seams.reduce((m, seam) => Math.max(m, seam.slowest), 0)),
      seams: seams.map(({ axis, at, t, slowest }) => ({
        axis,
        at,
        t: tenths(t / 1000),
        slowestFrameMs: tenths(slowest),
      })),
      framesOver30Ms: slow.map(({ t, x, y, dt }) => ({
        t: tenths(t / 1000),
        x: x === null ? null : Math.round(x),
        y: y === null ? null : Math.round(y),
        ms: tenths(dt),
      })),
      maxTiles,
      tiles,
      heapMB: await heapAfterGc(tab),
    }),
  )
}

/** Runs `command` in a new tab of the Chrome on its port, and closes the tab. */
const run = async (command: Command): Promise<void> => {
  const tab = await openTab(command.port)
  try {
    if (command.command === "shots") await shots(tab, command)
    else if (command.command === "heap") await heap(tab, command)
    else await drive(tab, command)
  } finally {
    await tab.close()
  }
}

if (import.meta.main) {
  let command: Command | undefined
  try {
    command = parseCli(process.argv.slice(2))
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`)
    process.exitCode = 2
  }
  if (command !== undefined)
    await run(command).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
