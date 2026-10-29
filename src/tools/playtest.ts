// The CDP bot of the map runbook: drives an already-running headless Chrome over its remote-debugging
// port (start it as docs/standards/playtest.md step 2 says), each run in a new tab of its own,
// closed at the end, at 1280×720 and a device pixel ratio of 1.
// Run: node src/tools/playtest.ts shots <url> <outdir> <name>:<x>,<y>[,<texels/m>] … [map] [--port N] [--wait s]
//      node src/tools/playtest.ts heap <url> [--port N] [--seconds s]  (pnpm playtest …)
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
// The port defaults to 9333.
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { parseArgs } from "node:util"

const USAGE = `usage: node src/tools/playtest.ts shots <url> <outdir> <name>:<x>,<y>[,<texels/m>] … [map] [--port N] [--wait s]
       node src/tools/playtest.ts heap <url> [--port N] [--seconds s]
shots needs a dev build (pnpm exec vite: window.gta); heap works on dev and production builds`

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

/** Parses the arguments after the script's name; throws on a bad line (the CLI prints the usage after the error). */
export const parseCli = (argv: ReadonlyArray<string>): Command => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { port: { type: "string" }, wait: { type: "string" }, seconds: { type: "string" } },
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
  throw new Error("missing or extra arguments")
}

/** The slowest of `deltas` and its 99th percentile (nearest rank), in their unit; 0 for none. */
export const frameStats = (deltas: ReadonlyArray<number>): { slowest: number; p99: number } => {
  const sorted = deltas.toSorted((a, b) => a - b)
  return {
    slowest: sorted.at(-1) ?? 0,
    p99: sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)] ?? 0,
  }
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
/** No CDP command takes longer unless the page hangs, but heap's frames evaluate, which gets its own. */
const COMMAND_TIMEOUT_MS = 60_000
/** Longest wait for the title card to say "Press any key": a cold dev server transforms every module first. */
const LOAD_TIMEOUT_MS = 180_000

interface Message {
  readonly id?: number
  readonly method?: string
  readonly sessionId?: string
  readonly params?: Record<string, unknown>
  readonly result?: Record<string, unknown>
  readonly error?: { readonly message: string }
}

interface Tab {
  /** Sends a command to the page; it fails after `timeoutMs` (`COMMAND_TIMEOUT_MS`) without an answer. */
  send<T = Record<string, unknown>>(method: string, params?: object, timeoutMs?: number): Promise<T>
  on(method: string, handler: (params: Record<string, unknown>) => void): void
  close(): Promise<void>
}

/** Opens a new tab in the Chrome on `port` and attaches to it; commands sent through the tab go to its page. On a failure it closes what it opened and throws. */
export const openTab = async (port: number): Promise<Tab> => {
  let browser: string
  try {
    const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
      webSocketDebuggerUrl: string
    }
    browser = version.webSocketDebuggerUrl
  } catch {
    throw new Error(
      `no Chrome on port ${port}: start it headless with --remote-debugging-port=${port} (docs/standards/playtest.md step 2)`,
    )
  }
  const ws = new WebSocket(browser)
  await new Promise((done, fail) => {
    ws.addEventListener("open", done, { once: true })
    ws.addEventListener("error", () => fail(new Error(`cannot connect to ${browser}`)), {
      once: true,
    })
  })
  let next = 0
  const pending = new Map<
    number,
    { done: (r: Record<string, unknown>) => void; fail: (e: Error) => void }
  >()
  const handlers = new Map<string, (params: Record<string, unknown>) => void>()
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Message
    if (message.id === undefined) {
      if (message.method !== undefined) handlers.get(message.method)?.(message.params ?? {})
      return
    }
    const waiting = pending.get(message.id)
    pending.delete(message.id)
    if (message.error === undefined) waiting?.done(message.result ?? {})
    else waiting?.fail(new Error(message.error.message))
  })
  ws.addEventListener("close", () => {
    for (const waiting of pending.values()) waiting.fail(new Error("Chrome closed the connection"))
    pending.clear()
  })
  const raw = <T>(
    method: string,
    params: object,
    sessionId?: string,
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<T> =>
    new Promise<Record<string, unknown>>((done, fail) => {
      // A closed socket drops what is sent: fail now rather than at the timeout.
      if (ws.readyState !== WebSocket.OPEN) {
        fail(new Error(`${method}: Chrome closed the connection`))
        return
      }
      const id = ++next
      const timer = setTimeout(() => {
        pending.delete(id)
        fail(new Error(`${method}: no answer in ${timeoutMs / 1000} s`))
      }, timeoutMs)
      pending.set(id, {
        done: (result) => (clearTimeout(timer), done(result)),
        fail: (error) => (clearTimeout(timer), fail(new Error(`${method}: ${error.message}`))),
      })
      ws.send(
        JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }),
      )
    }) as Promise<T>
  const close = async (targetId: string | undefined): Promise<void> => {
    if (targetId !== undefined) await raw("Target.closeTarget", { targetId }).catch(() => undefined)
    ws.close()
  }
  let made: string | undefined
  try {
    const { targetId } = await raw<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
    })
    made = targetId
    const { sessionId } = await raw<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    })
    return {
      send: (method, params = {}, timeoutMs) => raw(method, params, sessionId, timeoutMs),
      on: (method, handler) => handlers.set(method, handler),
      close: () => close(targetId),
    }
  } catch (error) {
    // An open socket keeps the process alive: close it, and the tab when it was made.
    await close(made)
    throw error
  }
}

/** Evaluates `expression` in the page, awaiting a promise, and returns its value; a page exception, or no answer in `timeoutMs`, throws. */
const evaluate = async <T>(tab: Tab, expression: string, timeoutMs?: number): Promise<T> => {
  const answer = await tab.send<{
    result: { value?: unknown }
    exceptionDetails?: { text: string; exception?: { description?: string } }
  }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs)
  const thrown = answer.exceptionDetails
  if (thrown !== undefined) throw new Error(`page: ${thrown.exception?.description ?? thrown.text}`)
  return answer.result.value as T
}

/** Presses and releases a key (`key` and `code` as KeyboardEvent has them). */
const press = async (tab: Tab, key: string, code: string, keyCode: number): Promise<void> => {
  const event = { key, code, windowsVirtualKeyCode: keyCode }
  await tab.send("Input.dispatchKeyEvent", { type: "keyDown", ...event })
  await sleep(80)
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", ...event })
}

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

const shoot = async (tab: Tab, path: string): Promise<void> => {
  const { data } = await tab.send<{ data: string }>("Page.captureScreenshot", { format: "png" })
  writeFileSync(path, Buffer.from(data, "base64"))
  console.log("shot", path)
}

const shots = async (tab: Tab, command: Extract<Command, { command: "shots" }>): Promise<void> => {
  const seconds = await load(tab, command.url)
  console.log(`ready in ${seconds.toFixed(1)} s`)
  if ((await evaluate<string>(tab, "typeof gta")) !== "object")
    throw new Error(
      "the page has no window.gta: shots needs a dev build (pnpm exec vite), not pnpm preview",
    )
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
  await tab.send("HeapProfiler.enable")
  await tab.send("HeapProfiler.collectGarbage")
  const used = await evaluate<number>(tab, "performance.memory.usedJSHeapSize")
  console.log(
    JSON.stringify({
      url: command.url,
      firstFrameS: Math.round(firstFrame / 10) / 100,
      slowestFrameMs: Math.round(slowest * 10) / 10,
      p99FrameMs: Math.round(p99 * 10) / 10,
      heapMB: Math.round(used / 1e6),
    }),
  )
}

/** Runs `command` in a new tab of the Chrome on its port, and closes the tab. */
const run = async (command: Command): Promise<void> => {
  const tab = await openTab(command.port)
  try {
    await (command.command === "shots" ? shots(tab, command) : heap(tab, command))
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
