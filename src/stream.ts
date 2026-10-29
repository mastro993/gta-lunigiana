/**
 * Browser host: streams the map's 2 km tiles (`src/sim/map/tiles.ts`) round the player, so that
 * every tile a step reads is in memory before the step runs (`ready`; `main.ts` pauses the game
 * until it is). Each animation frame, paused or not, `update` asks for the tiles the next step reads
 * (round the player and round an `extra` point: the respawn point while the player is dead), then
 * every listed tile within `NEAR` of the player, those the renderer's view needs (`wanted`) and
 * those within `NEAR` of `extra`, in that order. It keeps at most `IN_FLIGHT` downloads going,
 * gives each `DEADLINE` ms and cancels one nothing needs any more, retries a failed one after a wait
 * that doubles, hands over at most one downloaded tile a frame (decoding one takes a few
 * milliseconds), and lets a tile go only once it lies farther than `KEEP` from the player and
 * neither the view nor `extra` needs it, two updates running: the frame's render and audio read
 * the events its steps left round where the last update found the player (after a jump, the old
 * place: a skid, a crash). A tile that cannot ever come (the server has no such file,
 * as after a new build replaced the site, or the file is from another build) is `gone`: `main.ts`
 * offers a reload. Residency is the host's alone: the sim's answers never depend on it.
 *
 * It imports no sim module (the tile store comes in through `TileStreamHost`), so `boot.ts` shares
 * its download before the map is loaded.
 *
 * @module stream
 */

/** A point on the map, m east and north of the origin. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** Every listed tile within this distance (m, along either axis) of the player is fetched. */
export const NEAR = 1000
/** A tile is let go only once it lies farther than this (m, along either axis) from the player. */
export const KEEP = 1500
/** Downloads running at once, at most. */
const IN_FLIGHT = 3
/** The wait (ms) before the first retry of a failed tile; each failure doubles it, up to `RETRY_MAX`. */
const RETRY = 500
const RETRY_MAX = 16_000
/** A download still running after this (ms) is cancelled and tried again: a stalled connection must not hold a slot for good. */
const DEADLINE = 15_000

/** An HTTP error: the file and the status. */
export class HttpError extends Error {
  readonly status: number
  constructor(url: URL, status: number) {
    super(`${url.pathname}: HTTP ${status}`)
    this.status = status
  }
}

/** The response for `url` (cancelled by `signal`); throws, naming the file, on an HTTP error. */
export const fetchFile = async (url: URL, signal?: AbortSignal): Promise<Response> => {
  const response = await fetch(url, { signal })
  if (!response.ok || response.body === null) throw new HttpError(url, response.status)
  return response
}

/** Whether `error` says the file will never come: the server has none (404, 410), or it is not this map's (a tile `provideTile` refuses). */
const permanent = (error: unknown): boolean =>
  error instanceof HttpError
    ? error.status === 404 || error.status === 410
    : error instanceof Error && /from another build|not on this map/.test(error.message)

/**
 * The gzipped body of `response`, gunzipped as it arrives; `count` hears the size of each
 * compressed chunk (the loading bar's bytes). The files are named `.bin`, so no server labels them
 * `Content-Encoding: gzip` and the browser leaves them for this to gunzip.
 */
export const gunzipped = async (
  response: Response,
  count?: (bytes: number) => void,
): Promise<Uint8Array> => {
  const body = response.body!
  const counted =
    count === undefined
      ? body
      : body.pipeThrough(
          new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
            transform(chunk, out) {
              count(chunk.byteLength)
              out.enqueue(chunk)
            },
          }),
        )
  return new Uint8Array(
    await new Response(counted.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(),
  )
}

/** The tile file at `url`, downloaded and gunzipped (cancelled by `signal`). */
const download = async (url: URL, signal: AbortSignal): Promise<Uint8Array> =>
  gunzipped(await fetchFile(url, signal))

/** What the stream works on: the map's tile store (`src/sim/map/tiles.ts`) and where its tiles download from. */
interface TileStreamHost {
  /** Where tile `key` downloads from (`src/maps.ts`). */
  readonly url: (key: string) => URL
  /** The keys of the listed tiles a lookup over the box reads, in key order (`tilesOver`). */
  readonly over: (minX: number, minY: number, maxX: number, maxY: number) => ReadonlyArray<string>
  /** The keys of the tiles in memory (`residentTiles`). */
  readonly resident: () => ReadonlyArray<string>
  /** Takes a downloaded tile file into memory (`provideTile`); may throw (a tile from another build). */
  readonly provide: (file: Uint8Array) => void
  /** Lets tile `key` go (`dropTile`). */
  readonly drop: (key: string) => void
  /** Half the side of the square round the player whose tiles a step reads (`STEP_REACH`), m. */
  readonly reach: number
  /** Called once tile `key` is in memory. */
  readonly onProvided?: (key: string) => void
  /** Called just before tile `key` goes. */
  readonly onDropped?: (key: string) => void
  /** Downloads and gunzips a tile file, cancelled by the signal (default: `fetchFile`, then `gunzipped`). */
  readonly load?: (url: URL, signal: AbortSignal) => Promise<Uint8Array>
  /** Milliseconds, for the retry waits (default: `performance.now`). */
  readonly now?: () => number
}

/** A tile stream over `host`: `update` it every animation frame, and step the game only while it is `ready`. */
export const makeTileStream = (host: TileStreamHost) => {
  const { url, over, resident, provide, drop, reach } = host
  const { onProvided, onDropped, load = download, now = () => performance.now() } = host
  /** Tiles downloading: since when (ms), and how to cancel the download. */
  const loading = new Map<string, { readonly since: number; readonly abort: AbortController }>()
  /** Tiles downloaded and not yet handed over. */
  const arrived = new Map<string, Uint8Array>()
  /** Tiles whose last try failed: how many tries failed, and when the next may start (ms). */
  const failed = new Map<string, { readonly tries: number; readonly until: number }>()
  /** Tiles that will never come: tried no more. */
  const gone = new Set<string>()
  /** The tiles the last update kept. */
  let kept: ReadonlySet<string> = new Set()
  const around = (p: Point, r: number) => over(p.x - r, p.y - r, p.x + r, p.y + r)
  const fail = (key: string, error: unknown) => {
    if (permanent(error)) {
      gone.add(key)
      console.error(`map tile ${key}: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const tries = (failed.get(key)?.tries ?? 0) + 1
    const wait = Math.min(RETRY_MAX, RETRY * 2 ** (tries - 1))
    failed.set(key, { tries, until: now() + wait })
    console.warn(
      `map tile ${key}: ${error instanceof Error ? error.message : String(error)}; retrying in ${wait} ms`,
    )
  }
  const start = (key: string) => {
    const abort = new AbortController(),
      download = { since: now(), abort }
    loading.set(key, download)
    load(url(key), abort.signal)
      .then(
        (file) => {
          if (abort.signal.aborted) return
          failed.delete(key)
          arrived.set(key, file)
        },
        (error: unknown) => {
          // A cancelled download was settled where it was cancelled: no failure when nothing needs it any more, one at once
          // past its deadline (so its retry waits the backoff).
          if (!abort.signal.aborted) fail(key, error)
        },
      )
      .finally(() => {
        if (loading.get(key) === download) loading.delete(key)
      })
  }
  const allIn = (here: ReadonlySet<string>, p: Point) => around(p, reach).every((k) => here.has(k))

  return {
    /**
     * Fetches, hands over and lets go of tiles for the player at `player` (its pose after the last
     * step), the `extra` point and the tiles the renderer's view needs (`wanted`). Call it every
     * animation frame, also while the game is paused, so the downloads go on.
     */
    update: (player: Point, extra: Point | undefined, wanted: ReadonlySet<string>): void => {
      const need = new Set([
        ...around(player, reach),
        ...(extra === undefined ? [] : around(extra, reach)),
        ...around(player, NEAR),
        ...wanted,
        ...(extra === undefined ? [] : around(extra, NEAR)),
      ])
      const here = new Set(resident())
      for (const key of arrived.keys()) if (!need.has(key) || here.has(key)) arrived.delete(key)
      // The most urgent download first; one a frame, as decoding takes a few milliseconds.
      for (const key of need) {
        const file = arrived.get(key)
        if (file === undefined) continue
        arrived.delete(key)
        try {
          provide(file)
          here.add(key)
          onProvided?.(key)
        } catch (error) {
          fail(key, error)
        }
        break
      }
      const keep = new Set([
        ...around(player, KEEP),
        ...wanted,
        ...(extra === undefined ? [] : around(extra, NEAR)),
      ])
      for (const key of here)
        if (!keep.has(key) && !kept.has(key)) {
          onDropped?.(key)
          drop(key)
        }
      kept = keep
      const t = now()
      for (const [key, { since, abort }] of loading) {
        if (!need.has(key)) abort.abort("unneeded")
        else if (t - since > DEADLINE) {
          const error = new Error(`no answer in ${DEADLINE} ms`)
          abort.abort(error)
          fail(key, error)
        } else continue
        loading.delete(key)
      }
      for (const key of need) {
        if (loading.size >= IN_FLIGHT) break
        if (here.has(key) || loading.has(key) || arrived.has(key) || gone.has(key)) continue
        if ((failed.get(key)?.until ?? 0) > t) continue
        start(key)
      }
    },
    /** The tiles that will never come (`gone`), in the order they failed: a reload is the way on. */
    gone: (): ReadonlyArray<string> => [...gone],
    /** Whether every listed tile a step reads round `player`, and round `extra` when given, is in memory. */
    ready: (player: Point, extra: Point | undefined): boolean => {
      const here = new Set(resident())
      return allIn(here, player) && (extra === undefined || allIn(here, extra))
    },
  }
}
