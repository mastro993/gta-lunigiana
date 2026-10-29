// A minimal Chrome DevTools Protocol client for the playtest bot: opens a tab of its own in an
// already-running Chrome, sends commands to its page with a timeout, evaluates scripts and presses
// keys. src/tools/playtest.ts drives the game with it.
import { setTimeout as sleep } from "node:timers/promises"

/** No CDP command takes longer unless the page hangs, but heap's frames evaluate, which gets its own. */
const COMMAND_TIMEOUT_MS = 60_000

interface Message {
  readonly id?: number
  readonly method?: string
  readonly sessionId?: string
  readonly params?: Record<string, unknown>
  readonly result?: Record<string, unknown>
  readonly error?: { readonly message: string }
}

/** A tab of its own in the Chrome the bot drives. */
export interface Tab {
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
export const evaluate = async <T>(tab: Tab, expression: string, timeoutMs?: number): Promise<T> => {
  const answer = await tab.send<{
    result: { value?: unknown }
    exceptionDetails?: { text: string; exception?: { description?: string } }
  }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs)
  const thrown = answer.exceptionDetails
  if (thrown !== undefined) throw new Error(`page: ${thrown.exception?.description ?? thrown.text}`)
  return answer.result.value as T
}

/** Presses and releases a key (`key` and `code` as KeyboardEvent has them). */
export const press = async (
  tab: Tab,
  key: string,
  code: string,
  keyCode: number,
): Promise<void> => {
  const event = { key, code, windowsVirtualKeyCode: keyCode }
  await tab.send("Input.dispatchKeyEvent", { type: "keyDown", ...event })
  await sleep(80)
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", ...event })
}
