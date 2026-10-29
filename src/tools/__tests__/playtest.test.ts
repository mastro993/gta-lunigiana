import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo, Socket } from "node:net"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { runInNewContext } from "node:vm"

import { frameStats, openTab, parseCli, parseSpot, spotScript } from "../playtest.ts"

test("parseSpot: name, map metres and an optional zoom; map; bad spots throw", () => {
  assert.deepEqual(parseSpot("monzone:-494,436.9"), {
    kind: "spot",
    name: "monzone",
    x: -494,
    y: 436.9,
  })
  assert.deepEqual(parseSpot("vinca-2:2274,-2620,4"), {
    kind: "spot",
    name: "vinca-2",
    x: 2274,
    y: -2620,
    zoom: 4,
  })
  assert.deepEqual(parseSpot("map"), { kind: "map" })
  // The name becomes a file name: no paths.
  for (const bad of ["../up:1,2", "a/b:1,2", "a:1", "a:1,x", "a:1,2,0", "a:1,2,3,4", ":1,2"])
    assert.throws(() => parseSpot(bad), /bad/, bad)
})

test("parseCli: shots and heap with their defaults and flags; bad lines throw", () => {
  assert.deepEqual(
    parseCli(["shots", "http://localhost:5174/?seed=1", "out", "a:1,2", "map", "--port", "9444"]),
    {
      command: "shots",
      url: "http://localhost:5174/?seed=1",
      outdir: "out",
      spots: [{ kind: "spot", name: "a", x: 1, y: 2 }, { kind: "map" }],
      port: 9444,
      waitS: 6,
    },
  )
  assert.deepEqual(parseCli(["heap", "http://localhost:4173/", "--seconds", "3"]), {
    command: "heap",
    url: "http://localhost:4173/",
    port: 9333,
    seconds: 3,
  })
  assert.equal(
    (parseCli(["shots", "http://h/", "o", "map", "--wait", "1.5"]) as { waitS: number }).waitS,
    1.5,
  )
  for (const bad of [
    [],
    ["shots", "http://h/", "out"],
    ["heap"],
    ["heap", "http://h/", "extra"],
    ["heap", "not a url"],
    ["heap", "http://h/", "--port", "0"],
    ["heap", "http://h/", "--port", "70000"],
    ["heap", "http://h/", "--seconds=-1"],
    ["drive", "http://h/"],
  ])
    assert.throws(() => parseCli(bad), /bad|missing or extra/, bad.join(" "))
  assert.throws(() => parseCli(["heap", "http://h/", "--nope"]))
})

test("frameStats: slowest and the nearest-rank 99th percentile", () => {
  const deltas = Array.from({ length: 100 }, (_, i) => (i === 7 ? 50 : i === 9 ? 40 : 16))
  assert.deepEqual(frameStats(deltas), { slowest: 50, p99: 40 }) // rank 99 of 100
  assert.deepEqual(frameStats([16, 17]), { slowest: 17, p99: 17 })
  assert.deepEqual(frameStats([]), { slowest: 0, p99: 0 })
})

test("spotScript: pins the focus on the ground (render y = elevation − 200, z = −north) and the zoom when given", () => {
  const view = {
    focus: { x: 0, y: 0, z: 0, set: (): unknown => undefined },
    texelsPerMetre: 8,
  }
  const body = {
    children: [
      { id: "game", style: { visibility: "" } },
      { id: "hud", style: { visibility: "" } },
    ],
  }
  const gta = { view, heightAt: (x: number, y: number) => 300 + x / 100 + y / 1000 }
  const run = (script: string): unknown => runInNewContext(script, { gta, document: { body } })
  assert.equal(run(spotScript({ kind: "spot", name: "a", x: 100, y: -2000, zoom: 4 })), 299)
  assert.deepEqual([view.focus.x, view.focus.y, view.focus.z], [100, 99, 2000])
  assert.deepEqual(
    body.children.map((el) => el.style.visibility),
    ["", "hidden"],
  )
  // The game's frame writes neither the focus nor the pinned zoom.
  view.focus.set()
  view.texelsPerMetre = 7
  assert.equal(view.texelsPerMetre, 4)
  assert.deepEqual([view.focus.x, view.focus.y, view.focus.z], [100, 99, 2000])
  // A spot without a zoom frees it again.
  run(spotScript({ kind: "spot", name: "b", x: 0, y: 0 }))
  view.texelsPerMetre = 6
  assert.equal(view.texelsPerMetre, 6)
  assert.deepEqual([view.focus.x, view.focus.y, view.focus.z], [0, 100, 0])
})

/**
 * A fake Chrome on a free local port: /json/version names its WebSocket, which records each CDP
 * command's method and answers it with `reply(method)` (undefined: never; "hang up": drops the
 * connection). `closed` resolves when the client closes the socket.
 */
const fakeChrome = async (reply: (method: string) => object | "hang up" | undefined) => {
  const methods: Array<string> = [],
    sockets = new Set<Socket>(),
    closed = Promise.withResolvers<void>()
  const server = createServer((_, res) =>
    res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/x` })),
  )
  server.on("upgrade", (req, socket: Socket) => {
    sockets.add(socket)
    const accept = createHash("sha1")
      .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64")
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )
    // One masked client frame per read: the opcode, a 7- or 16-bit length, the mask, the payload.
    socket.on("data", (frame: Buffer) => {
      if ((frame[0]! & 0x0f) === 8) {
        closed.resolve()
        socket.end(Buffer.from([0x88, 0]))
        return
      }
      const long = (frame[1]! & 0x7f) === 126,
        at = long ? 4 : 2,
        length = long ? frame.readUInt16BE(2) : frame[1]! & 0x7f
      const payload = Buffer.from(
        frame.subarray(at + 4, at + 4 + length).map((b, k) => b ^ frame[at + (k % 4)]!),
      )
      const { id, method } = JSON.parse(payload.toString()) as { id: number; method: string }
      methods.push(method)
      const answer = reply(method)
      if (answer === "hang up") socket.destroy()
      if (answer === undefined || answer === "hang up") return
      const body = Buffer.from(JSON.stringify({ id, ...answer })) // under 126 bytes
      socket.write(Buffer.concat([Buffer.from([0x81, body.length]), body]))
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  const stop = () => {
    for (const socket of sockets) socket.destroy()
    server.close()
  }
  return { port, methods, closed: closed.promise, stop }
}

/** Fails unless `promise` settles within `ms`. */
const within = (promise: Promise<unknown>, ms: number, what: string): Promise<unknown> =>
  Promise.race([promise, sleep(ms, undefined, { ref: false }).then(() => assert.fail(what))])

test("openTab closes its socket, and the target it made, when Chrome will not make or attach the tab", async (t) => {
  const refuses = await fakeChrome(() => ({ error: { message: "no" } }))
  t.after(refuses.stop)
  await assert.rejects(openTab(refuses.port), /^Error: Target.createTarget: no$/)
  await within(refuses.closed, 2000, "the socket was left open")

  const detached = await fakeChrome((method) =>
    method === "Target.attachToTarget"
      ? { error: { message: "gone" } }
      : { result: { targetId: "T1" } },
  )
  t.after(detached.stop)
  await assert.rejects(openTab(detached.port), /^Error: Target.attachToTarget: gone$/)
  await within(detached.closed, 2000, "the socket was left open")
  assert.deepEqual(detached.methods, [
    "Target.createTarget",
    "Target.attachToTarget",
    "Target.closeTarget",
  ])

  // Chrome gone: nothing more is sent, so nothing waits out a timeout.
  const gone = await fakeChrome((method) =>
    method === "Target.attachToTarget" ? "hang up" : { result: { targetId: "T1" } },
  )
  t.after(gone.stop)
  await within(
    assert.rejects(
      openTab(gone.port),
      /^Error: Target.attachToTarget: Chrome closed the connection$/,
    ),
    2000,
    "openTab waited on a closed socket",
  )
})

test("a tab command takes its own timeout, so heap's long frames evaluate is not cut at the default", async (t) => {
  const chrome = await fakeChrome((method) =>
    method === "Runtime.evaluate" ? undefined : { result: { targetId: "T1", sessionId: "S1" } },
  )
  t.after(chrome.stop)
  const tab = await openTab(chrome.port)
  await within(
    assert.rejects(tab.send("Runtime.evaluate", {}, 100), /Runtime.evaluate: no answer in 0.1 s/),
    2000,
    "the command waited past its own timeout",
  )
  await tab.close()
  await within(chrome.closed, 2000, "the socket was left open")
})
