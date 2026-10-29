// HTTP for the map tools. Every request names only the project in its User-Agent (AGENTS.md), and
// what an overloaded server drops (a network error, 429, a 5xx) is retried with backoff.

import { setTimeout as sleep } from "node:timers/promises"

/** The only thing the requests say about who asks: the project (no names, no addresses). */
const HEADERS = { "User-Agent": "gta-lunigiana map build" }

/**
 * `fetch` with HEADERS, tried up to `tries` times, 2, 4, 8… s apart, on a network error (a try
 * longer than `timeoutMs` included), 429 or a 5xx; any other answer (a 404, the OSM API's 400 for
 * too many nodes) comes back as it is.
 */
export const request = async (
  url: string,
  method = "GET",
  tries = 5,
  timeoutMs?: number,
): Promise<Response> => {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: HEADERS,
        ...(timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
      })
      if ((res.status !== 429 && res.status < 500) || attempt >= tries) return res
      await res.body?.cancel()
    } catch (error) {
      if (attempt >= tries) throw error
    }
    await sleep(1000 * 2 ** attempt)
  }
}

/** The body of a 2xx answer; throws with the URL and status otherwise. */
const ok = async (url: string): Promise<Response> => {
  const res = await request(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res
}

/** The text of a 2xx answer from `url`. */
export const getText = async (url: string): Promise<string> => (await ok(url)).text()

/** The bytes of a 2xx answer from `url`. */
export const getBytes = async (url: string): Promise<Buffer> =>
  Buffer.from(await (await ok(url)).arrayBuffer())

/** A HEAD answer: the status, and the size when the server gives it. */
export interface Head {
  readonly status: number
  readonly bytes?: number
}

/** HEAD `url`. */
export const head = async (url: string): Promise<Head> => {
  const res = await request(url, "HEAD")
  const bytes = res.headers.get("content-length")
  return { status: res.status, ...(bytes === null ? {} : { bytes: Number(bytes) }) }
}

/** Overpass instances, best first: the kumi.systems mirror (the main one is often overloaded), then the main one. */
const OVERPASS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
] as const
/**
 * How long an Overpass instance gets, ms, before the next is asked: the [timeout:180] every query
 * of the map tools sets (`coverage`, `footprint-check`) and room to send the answer.
 */
const OVERPASS_WAIT = 240_000

/**
 * The answer to an Overpass `query` (XML or JSON, as it asks) from the first of `bases` (instances,
 * best first) that gives a complete one: a network error, a non-2xx answer and a 200 with a remark
 * (a server timeout or out of memory, the result partial) move on to the next. Throws with the last
 * instance's reason.
 */
export const overpass = async (
  query: string,
  bases: ReadonlyArray<string> = OVERPASS,
): Promise<string> => {
  let why = ""
  for (const base of bases) {
    try {
      const res = await request(
        `${base}?data=${encodeURIComponent(query)}`,
        "GET",
        1,
        OVERPASS_WAIT,
      )
      const text = await res.text()
      // XML puts the remark in its own element, JSON as a top-level key (2 spaces in; tags sit deeper).
      if (res.ok && !text.includes("<remark>") && !/\n {2}"remark"\s*:/.test(text)) return text
      why = res.ok ? "an incomplete answer" : `HTTP ${res.status}`
    } catch (error) {
      why = String(error)
    }
    console.log(`${base}: ${why}`)
  }
  throw new Error(`Overpass: ${why}`)
}

/** `fn` over `items`, at most `limit` at a time (to spare the servers), results in item order. */
export const pool = async <T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<R>> => {
  if (!(limit >= 1)) throw new Error(`pool: limit ${limit}`)
  const out = Array.from<R>({ length: items.length })
  let next = 0
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!, i)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
