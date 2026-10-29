import assert from "node:assert/strict"
import { once } from "node:events"
import { type IncomingHttpHeaders, createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { after, test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

import { getBytes, getText, head, overpass, pool, request } from "../net.ts"

/** Overpass answers as the server pretty-prints JSON: elements at column 0, their keys 2 spaces in, their tags 4. */
const TAGGED = `{
  "version": 0.6,
  "elements": [

{
  "type": "node",
  "id": 1,
  "tags": {
    "remark": "a tag, not the server's"
  }
}

  ]
}
`
/** A server timeout: a 200 whose remark sits at the top level, 2 spaces in. */
const TIMED_OUT = `{
  "version": 0.6,
  "elements": [

  ],
  "remark": "runtime error: Query timed out in \\"query\\" at line 1 after 181 seconds."
}
`
/** Out of memory, as an XML answer says it. */
const OUT_OF_MEMORY = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
<remark> runtime error: Query run out of memory using about 2048 MB of RAM. </remark>
</osm>
`

/** Requests seen per path, and the last request's method, URL and headers. */
const hits = new Map<string, number>()
let last: {
  readonly method?: string
  readonly url?: string
  readonly headers: IncomingHttpHeaders
} = { headers: {} }

/**
 * A local server: /flaky fails once then answers, /down always fails, /missing… is 404, /file has a
 * size; /overpass/… answer as an Overpass instance: tagged, timed-out, out-of-memory, busy (504).
 */
const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0]!,
    hit = (hits.get(path) ?? 0) + 1
  hits.set(path, hit)
  last = { method: req.method, url: req.url, headers: req.headers }
  if (path === "/flaky") res.writeHead(hit === 1 ? 500 : 200).end(hit === 1 ? "down" : "up")
  else if (path === "/down") res.writeHead(503).end()
  else if (path.startsWith("/missing")) res.writeHead(404).end("no")
  else if (path === "/file")
    res
      .writeHead(200, { "content-length": 1234 })
      .end(req.method === "HEAD" ? undefined : "x".repeat(1234))
  else if (path === "/overpass/tagged") res.writeHead(200).end(TAGGED)
  else if (path === "/overpass/timed-out") res.writeHead(200).end(TIMED_OUT)
  else if (path === "/overpass/out-of-memory") res.writeHead(200).end(OUT_OF_MEMORY)
  else if (path === "/overpass/busy") res.writeHead(504).end("Gateway Timeout")
  else res.writeHead(200).end("hello")
}).listen(0, "127.0.0.1")
await once(server, "listening")
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
after(() => {
  server.closeAllConnections()
  server.close()
})

test("requests name only the project", async () => {
  assert.equal(await (await request(`${base}/ua`)).text(), "hello")
  assert.equal(last.headers["user-agent"], "gta-lunigiana map build")
  for (const name of ["from", "referer", "cookie", "authorization"])
    assert.equal(last.headers[name], undefined, name)
})

test("request retries a 5xx 2 s later and gives the answer that follows", async () => {
  const start = performance.now()
  const res = await request(`${base}/flaky`, "GET", 2)
  assert.equal(res.status, 200)
  assert.equal(await res.text(), "up")
  assert.equal(hits.get("/flaky"), 2)
  assert.ok(performance.now() - start >= 1900)
})

test("request gives a 4xx at once, and the last 5xx when the tries run out", async () => {
  const start = performance.now()
  assert.equal((await request(`${base}/missing`)).status, 404)
  assert.equal(hits.get("/missing"), 1)
  assert.equal((await request(`${base}/down`, "GET", 1)).status, 503)
  assert.equal(hits.get("/down"), 1)
  assert.ok(performance.now() - start < 1000)
})

test("request throws a network error when the tries run out", async () => {
  const closed = createServer().listen(0, "127.0.0.1")
  await once(closed, "listening")
  const { port } = closed.address() as AddressInfo
  closed.close()
  await once(closed, "close")
  await assert.rejects(request(`http://127.0.0.1:${port}/`, "GET", 1), TypeError)
})

test("getText and getBytes give a 2xx body and throw with the URL and status otherwise", async () => {
  assert.equal(await getText(`${base}/hello`), "hello")
  assert.deepEqual(await getBytes(`${base}/file`), Buffer.from("x".repeat(1234)))
  await assert.rejects(getText(`${base}/missing-text`), {
    message: `${base}/missing-text: HTTP 404`,
  })
})

test("head reads the status and the size", async () => {
  assert.deepEqual(await head(`${base}/file`), { status: 200, bytes: 1234 })
  assert.equal(last.method, "HEAD")
  assert.equal((await head(`${base}/missing-head`)).status, 404)
})

/** The local Overpass instances at `names`, in order. */
const instances = (...names: ReadonlyArray<string>) => names.map((n) => `${base}/overpass/${n}`)

test("overpass sends the query as data= and takes a JSON answer whose tag is named remark", async (t) => {
  const log = t.mock.method(console, "log", () => {})
  assert.equal(await overpass("[out:json];node(1);out;", instances("tagged", "busy")), TAGGED)
  assert.equal(last.url, `/overpass/tagged?data=${encodeURIComponent("[out:json];node(1);out;")}`)
  assert.equal(log.mock.callCount(), 0)
})

test("overpass moves past a JSON remark at the top level, an XML remark and a 504 to the next instance", async (t) => {
  const log = t.mock.method(console, "log", () => {})
  const bases = instances("timed-out", "out-of-memory", "busy", "tagged")
  assert.equal(await overpass("q", bases), TAGGED)
  assert.deepEqual(
    log.mock.calls.map((c) => String(c.arguments[0])),
    [
      `${bases[0]}: an incomplete answer`,
      `${bases[1]}: an incomplete answer`,
      `${bases[2]}: HTTP 504`,
    ],
  )
})

test("overpass throws the last instance's reason when none gives a complete answer", async (t) => {
  t.mock.method(console, "log", () => {})
  await assert.rejects(overpass("q", instances("timed-out", "busy")), {
    message: "Overpass: HTTP 504",
  })
  await assert.rejects(overpass("q", instances("busy", "out-of-memory")), {
    message: "Overpass: an incomplete answer",
  })
})

test("pool gives the results in item order, whatever order the calls end in", async () => {
  const out = await pool([30, 0, 20, 10], 2, async (ms, i) => {
    await sleep(ms)
    return `${i}:${ms}`
  })
  assert.deepEqual(out, ["0:30", "1:0", "2:20", "3:10"])
})

/** pool over `n` items at `limit`: its results and the most calls it ran at once. */
const measure = async (n: number, limit: number) => {
  let active = 0,
    most = 0
  const out = await pool(
    Array.from({ length: n }, (_, i) => i),
    limit,
    async (item) => {
      active++
      most = Math.max(most, active)
      await sleep(1 + (item % 3))
      active--
      return item * 2
    },
  )
  return { out, most }
}

test("pool never runs more than limit calls at once, and runs that many", async () => {
  const { out, most } = await measure(10, 3)
  assert.deepEqual(out, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18])
  assert.equal(most, 3)
})

test("pool with a limit above the items runs them all at once; over no items it calls nothing", async () => {
  const { out, most } = await measure(2, 10)
  assert.deepEqual(out, [0, 2])
  assert.equal(most, 2)
  let calls = 0
  const none = await pool([], 4, () => {
    calls++
    return Promise.resolve()
  })
  assert.deepEqual(none, [])
  assert.equal(calls, 0)
})
