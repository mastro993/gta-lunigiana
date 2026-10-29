import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo, Socket } from "node:net"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { openTab } from "../cdp.ts"

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
