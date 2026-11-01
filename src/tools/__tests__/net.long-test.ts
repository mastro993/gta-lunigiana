import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { after, test } from "node:test"

import { request } from "../net.ts"

// net.test.ts checks the rest of request against a fuller local server; this one waits out a real back-off.
let hits = 0
const server = createServer((_req, res) => {
  hits++
  res.writeHead(hits === 1 ? 500 : 200).end(hits === 1 ? "down" : "up")
}).listen(0, "127.0.0.1")
await once(server, "listening")
after(() => {
  server.closeAllConnections()
  server.close()
})

test("request retries a 5xx 2 s later and gives the answer that follows", async () => {
  const start = performance.now()
  const res = await request(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, "GET", 2)
  assert.equal(res.status, 200)
  assert.equal(await res.text(), "up")
  assert.equal(hits, 2)
  assert.ok(performance.now() - start >= 1900)
})
