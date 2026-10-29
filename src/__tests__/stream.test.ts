import assert from "node:assert/strict"
import { test } from "node:test"
import { gzipSync } from "node:zlib"

import { STEP_REACH, tilesOver } from "../sim/map/tiles.ts"
import {
  fetchFile,
  gunzipped,
  HttpError,
  KEEP,
  makeTileStream,
  NEAR,
  type Point,
} from "../stream.ts"

/** Lets every settled download's handlers run. */
const settle = () =>
  new Promise<void>((done) => {
    setImmediate(done)
  })

/**
 * A fake tile store and network: `load` records each request and waits for the test to answer it,
 * a tile file is its key's bytes, and `calls` logs what the stream did, in order.
 */
const fake = (resident: ReadonlyArray<string> = []) => {
  const here = new Set(resident)
  const pending = new Map<
    string,
    { ok: (file: Uint8Array) => void; fail: (error: Error) => void }
  >()
  const requested: Array<string> = []
  const calls: Array<string> = []
  let clock = 0
  const host = {
    url: (key: string) => new URL(`${key}.bin`, "https://tiles.test/"),
    over: tilesOver,
    resident: () => [...here],
    provide: (file: Uint8Array) => {
      const key = new TextDecoder().decode(file)
      calls.push(`provide ${key}`)
      here.add(key)
    },
    drop: (key: string) => {
      calls.push(`drop ${key}`)
      here.delete(key)
    },
    reach: STEP_REACH,
    onProvided: (key: string) => calls.push(`provided ${key}`),
    onDropped: (key: string) => calls.push(`dropped ${key}`),
    load: (url: URL, signal: AbortSignal) =>
      new Promise<Uint8Array>((ok, fail) => {
        const key = url.pathname.slice(1, -".bin".length)
        requested.push(key)
        pending.set(key, { ok, fail })
        // As fetch does: a cancelled download fails with the signal's reason.
        signal.addEventListener("abort", () => {
          pending.delete(key)
          fail(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)))
        })
      }),
    now: () => clock,
  }
  return {
    host,
    here,
    requested,
    calls,
    /** Answers the download of `key` with its file. */
    answer: (key: string) => {
      pending.get(key)!.ok(new TextEncoder().encode(key))
      pending.delete(key)
    },
    /** Fails the download of `key` (a server error, unless given another). */
    refuse: (key: string, error = new Error("HTTP 503")) => {
      pending.get(key)!.fail(error)
      pending.delete(key)
    },
    pending: () => [...pending.keys()],
    wait: (ms: number) => (clock += ms),
  }
}

const none: ReadonlySet<string> = new Set()
/** In tile 0_0, 900 m from its south-west corner: the step's square holds only 0_0, the kilometre round it four tiles. */
const near: Point = { x: 900, y: 900 }

test("the tiles the next step reads are asked for first, then the rest within a kilometre, three at a time", async () => {
  const net = fake()
  const stream = makeTileStream(net.host)
  assert.deepEqual(tilesOver(300, 300, 1500, 1500), ["0_0"], "the step's square")
  assert.deepEqual(
    tilesOver(near.x - NEAR, near.y - NEAR, near.x + NEAR, near.y + NEAR),
    ["-1_-1", "0_-1", "-1_0", "0_0"],
    "the kilometre round the player",
  )
  stream.update(near, undefined, none)
  assert.deepEqual(net.requested, ["0_0", "-1_-1", "0_-1"])
  stream.update(near, undefined, none)
  assert.equal(net.requested.length, 3, "no fourth download while three run")
  for (const key of net.pending()) net.answer(key)
  await settle()
  assert.equal(stream.ready(near, undefined), false, "downloaded is not yet handed over")
  stream.update(near, undefined, none)
  assert.deepEqual(net.calls, ["provide 0_0", "provided 0_0"], "one tile a frame, the step's first")
  assert.equal(stream.ready(near, undefined), true)
  assert.deepEqual(net.requested, ["0_0", "-1_-1", "0_-1", "-1_0"], "the fourth once one is done")
  stream.update(near, undefined, none)
  stream.update(near, undefined, none)
  assert.deepEqual(net.calls.slice(2), [
    "provide -1_-1",
    "provided -1_-1",
    "provide 0_-1",
    "provided 0_-1",
  ])
})

test("ready: every tile a step reads round the player and round the extra point (the respawn) is in memory; the extra's come before the player's kilometre", () => {
  const net = fake(["0_0"])
  const stream = makeTileStream(net.host)
  assert.equal(stream.ready(near, undefined), true)
  assert.equal(stream.ready({ x: 1700, y: 900 }, undefined), false, "600 m east reaches 1_0")
  const respawn = { x: -1000, y: -3000 }
  assert.deepEqual(tilesOver(-1600, -3600, -400, -2400), ["-1_-2"], "the respawn's step square")
  assert.equal(stream.ready(near, respawn), false)
  stream.update(near, respawn, none)
  assert.deepEqual(net.requested, ["-1_-2", "-1_-1", "0_-1"])
  net.here.add("-1_-2")
  assert.equal(stream.ready(near, respawn), true)
})

test("a tile is let go only past 1.5 km from the player, never while the view or the extra point needs it, and the host hears first", () => {
  const net = fake(["0_0", "1_1", "2_0", "-2_-2"])
  const stream = makeTileStream(net.host)
  assert.ok(!tilesOver(near.x - KEEP, near.y - KEEP, near.x + KEEP, near.y + KEEP).includes("2_0"))
  stream.update(near, { x: -3000, y: -3000 }, new Set(["2_0"]))
  assert.deepEqual(
    net.calls.filter((call) => call.includes("drop")),
    [],
    "1_1 lies within 1.5 km, the view wants 2_0, -2_-2 is by the extra point",
  )
  stream.update(near, undefined, none)
  assert.equal(
    net.calls.filter((call) => call.includes("drop")).length,
    0,
    "the last update kept them",
  )
  stream.update(near, undefined, none)
  assert.deepEqual(
    net.calls.filter((call) => call.includes("drop")),
    ["dropped 2_0", "drop 2_0", "dropped -2_-2", "drop -2_-2"],
  )
  assert.ok(net.here.has("1_1") && net.here.has("0_0"))
})

// Review of #64: the steps of the frame that jumped (a respawn, a teleport) left events at the old place (a skid, a crash), and the
// render and audio read the ground there after the stream had let its tiles go: "map tile i_j not loaded".
test("a tile goes only once two updates running would let it go: the frame after a jump still reads the old place", () => {
  const net = fake(["0_0"])
  const stream = makeTileStream(net.host)
  stream.update(near, undefined, none)
  const far: Point = { x: 4900, y: -5900 }
  stream.update(far, undefined, none)
  assert.ok(net.here.has("0_0"), "kept through the frame of the jump")
  stream.update(far, undefined, none)
  assert.deepEqual(
    net.calls.filter((call) => call.includes("drop")),
    ["dropped 0_0", "drop 0_0"],
  )
})

test("a failed download is retried after a wait that doubles", async (t) => {
  t.mock.method(console, "warn", () => {})
  const net = fake()
  const stream = makeTileStream(net.host)
  const tries = () => net.requested.filter((key) => key === "0_0").length
  stream.update(near, undefined, none)
  net.refuse("0_0")
  net.answer("-1_-1")
  net.answer("0_-1")
  await settle()
  stream.update(near, undefined, none)
  assert.equal(tries(), 1, "not at once")
  net.wait(501)
  stream.update(near, undefined, none)
  assert.equal(tries(), 2, "after half a second")
  net.refuse("0_0")
  await settle()
  net.wait(900)
  stream.update(near, undefined, none)
  assert.equal(tries(), 2, "the second wait is a second")
  net.wait(101)
  stream.update(near, undefined, none)
  assert.equal(tries(), 3)
  net.answer("0_0")
  await settle()
  stream.update(near, undefined, none)
  assert.equal(stream.ready(near, undefined), true)
})

test("a tile the store refuses (from another build) or the server has not (404) is gone: tried no more, and named", async (t) => {
  t.mock.method(console, "error", () => {})
  const net = fake()
  const stream = makeTileStream({
    ...net.host,
    provide: (file) => {
      if (new TextDecoder().decode(file) === "0_0")
        throw new Error("map tile 0_0 is from another build")
      net.host.provide(file)
    },
  })
  stream.update(near, undefined, none)
  for (const key of net.pending()) net.answer(key)
  await settle()
  for (let frame = 0; frame < 3; frame++) stream.update(near, undefined, none)
  // The fourth tile of the kilometre started once a slot was free: the server has no such file.
  net.refuse("-1_0", new HttpError(new URL("https://tiles.test/-1_0.bin"), 404))
  await settle()
  net.wait(20_000)
  for (let frame = 0; frame < 3; frame++) stream.update(near, undefined, none)
  assert.deepEqual(stream.gone(), ["0_0", "-1_0"])
  assert.equal(stream.ready(near, undefined), false)
  assert.deepEqual(net.requested, ["0_0", "-1_-1", "0_-1", "-1_0"], "neither is asked for again")
})

test("a download that stalls past its deadline is cancelled and tried again; one nothing needs any more is cancelled, not failed", async (t) => {
  t.mock.method(console, "warn", () => {})
  const net = fake()
  const stream = makeTileStream(net.host)
  stream.update(near, undefined, none)
  assert.deepEqual(net.pending(), ["0_0", "-1_-1", "0_-1"])
  net.wait(15_001)
  stream.update(near, undefined, none)
  await settle()
  // All three were cancelled, and none is asked for again before its retry wait (review of #64: they restarted at once): a
  // freed slot goes to the kilometre's fourth tile, never tried yet.
  assert.deepEqual(net.requested.slice(3), ["-1_0"])
  stream.update(near, undefined, none)
  assert.deepEqual(net.requested.slice(3), ["-1_0"])
  // Once the wait is over they are asked for again, most urgent first, into the two slots left.
  net.wait(501)
  stream.update(near, undefined, none)
  assert.deepEqual(net.requested.slice(4), ["0_0", "-1_-1"])
  // Far away: the downloads round `near` are cancelled with no failure, so they start at once when needed again.
  const far: Point = { x: 4900, y: -5900 }
  stream.update(far, undefined, none)
  await settle()
  stream.update(near, undefined, none)
  assert.deepEqual(net.pending().slice(0, 1), ["0_0"])
})

test("a download that lands once nothing needs it is let go, not handed over", async () => {
  const net = fake()
  const stream = makeTileStream(net.host)
  stream.update(near, undefined, none)
  for (const key of net.pending()) net.answer(key)
  await settle()
  const far = { x: 4500, y: -7500 }
  assert.ok(!tilesOver(far.x - KEEP, far.y - KEEP, far.x + KEEP, far.y + KEEP).includes("0_0"))
  stream.update(far, undefined, none)
  assert.ok(net.calls.every((call) => !call.endsWith(" 0_0")))
})

test("tile files arrive gunzipped, their compressed bytes counted as they come", async () => {
  const file = new TextEncoder().encode('{"version":3}\n'.repeat(50))
  const zipped = gzipSync(file)
  let counted = 0
  const out = await gunzipped(new Response(zipped), (bytes) => (counted += bytes))
  assert.deepEqual(out, file)
  assert.equal(counted, zipped.length)
})

test("a download that fails names the file and the status", async (t) => {
  t.mock.method(globalThis, "fetch", () => Promise.resolve(new Response(null, { status: 404 })))
  await assert.rejects(fetchFile(new URL("https://tiles.test/0_0.bin")), /\/0_0\.bin: HTTP 404/)
})
