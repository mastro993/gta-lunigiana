import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { once } from "node:events"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { gridOver, mask } from "../coverage-grid.ts"
import {
  checkPicks,
  fillLayer,
  forestPolygons,
  osmPolygon,
  readUcs,
  tileSource,
} from "../coverage.ts"
import { gaussBoagaToLatLon } from "../crs.ts"
import { CELL, emptyTile } from "../dtm-tiles.ts"
import { fromLocal, toLocal } from "../geometry.ts"
import { readManifest } from "../manifest.ts"
import type { Osm, Tags } from "../osm.ts"
import { SOURCES } from "../terrain-sources.ts"

/** An Osm of the given nodes (id: local x, y), ways (id: node ids, tags) and relations. */
const osmOf = (
  nodes: Readonly<Record<string, readonly [number, number]>>,
  ways: Readonly<Record<string, readonly [ReadonlyArray<string>, Tags?]>>,
  relations: Readonly<Record<string, readonly [ReadonlyArray<readonly [string, string]>, Tags]>>,
): Osm => ({
  nodes: new Map(
    Object.entries(nodes).map(([id, [x, y]]) => {
      const [lat, lon] = fromLocal(x, y)
      return [id, { id, lat, lon, tags: {} }]
    }),
  ),
  ways: new Map(
    Object.entries(ways).map(([id, [nds, tags]]) => [id, { id, nds, tags: tags ?? {} }]),
  ),
  relations: new Map(
    Object.entries(relations).map(([id, [members, tags]]) => [
      id,
      { id, tags, members: members.map(([ref, role]) => ({ type: "way", ref, role })) },
    ]),
  ),
})

/**
 * A 100 m square split into three member ways, the middle one drawn backwards, round a 20 m
 * square hole drawn as one closed way; a dangling outer way that closes nothing.
 */
const osm = osmOf(
  {
    a: [0, 0],
    b: [100, 0],
    c: [100, 100],
    d: [0, 100],
    e: [40, 40],
    f: [60, 40],
    g: [60, 60],
    h: [40, 60],
    i: [200, 200],
    j: [210, 200],
    k: [300, 0],
    l: [330, 0],
    m: [330, 30],
  },
  {
    w1: [["a", "b", "c"]],
    w2: [["d", "c"]],
    w3: [["d", "a"]],
    hole: [["e", "f", "g", "h", "e"]],
    dangling: [["i", "j"]],
    wood: [["k", "l", "m", "k"], { natural: "wood" }],
    meadow: [["e", "f", "g", "e"], { landuse: "meadow" }],
  },
  {
    r1: [
      [
        ["w1", "outer"],
        ["hole", "inner"],
        ["w2", "outer"],
        ["dangling", "outer"],
        ["w3", "outer"],
      ],
      { type: "multipolygon", landuse: "forest" },
    ],
  },
)

const round = (ring: ReadonlyArray<number>) => ring.map((v) => Math.round(v * 1000) / 1000)

test("osmPolygon: chains the member ways into closed rings, outer then inner, and drops what does not close", () => {
  const rings = osmPolygon(osm, osm.relations.get("r1")!)
  assert.deepEqual(rings.map(round), [
    [0, 0, 100, 0, 100, 100, 0, 100],
    [40, 40, 60, 40, 60, 60, 40, 60],
  ])
  assert.equal(
    mask(gridOver([[0, 0, 100, 100]], 10), [rings]).filter((v) => v === 1).length,
    100 - 4,
  )
})

test("forestPolygons: the forest and wood multipolygons and closed ways, nothing else", () => {
  const polygons = forestPolygons(osm)
  assert.deepEqual(
    polygons.map((p) => p.map(round)),
    [
      [[300, 0, 330, 0, 330, 30]],
      [
        [0, 0, 100, 0, 100, 100, 0, 100],
        [40, 40, 60, 40, 60, 60, 40, 60],
      ],
    ],
  )
})

/** A WFS answer with one wood, and the 200 the server sends for a request it cannot serve. */
const GML =
  "<wfs:FeatureCollection><gml:featureMember><ms:ucs><ms:ucs2019>311</ms:ucs2019><gml:Polygon><gml:coordinates>0,0 10,0 10,10 0,0</gml:coordinates></gml:Polygon></ms:ucs></gml:featureMember></wfs:FeatureCollection>"
const FAILED =
  '<?xml version="1.0"?><ServiceExceptionReport version="1.2.0"><ServiceException>msWFSGetFeature(): WFS server error.</ServiceException></ServiceExceptionReport>'

test("readUcs caches a WFS answer only once it parses, then reads the cache", async (t) => {
  t.mock.method(console, "log", () => {})
  const server = createServer((req, res) =>
    res.writeHead(200).end(req.url === "/good" ? GML : FAILED),
  ).listen(0, "127.0.0.1")
  await once(server, "listening")
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"))
  t.after(() => {
    server.closeAllConnections()
    server.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    path = join(dir, "ucs.gml")
  const wood = [{ attrs: { ucs2019: "311" }, polygons: [[[0, 0, 10, 0, 10, 10, 0, 0]]] }]

  await assert.rejects(readUcs(path, false, `${base}/bad`), /WFS: truncated or failed answer/)
  assert.equal(existsSync(path), false)
  assert.deepEqual(await readUcs(path, false, `${base}/good`), wood)
  assert.equal(readFileSync(path, "utf8"), GML)
  assert.deepEqual(await readUcs(path, false, `${base}/bad`), wood, "read from the cache")
  await assert.rejects(readUcs(path, true, `${base}/bad`))
  assert.equal(readFileSync(path, "utf8"), GML, "a failed refresh keeps the cache")
})

test("checkPicks throws for a part without a manifest (read as empty) or with no CTR sheet and no LiDAR tile picked", () => {
  const message =
    "no picks in data/parts/x.json: run pnpm pick-sheets x --write and pnpm pick-lidar x --write first"
  const empty = readManifest("x")
  assert.throws(() => checkPicks("x", empty), { message })
  assert.throws(() => checkPicks("x", { ...empty, dtm10: ["MS_dtm10x10"] }), { message })
  const ctr = { ...empty, ctr: ["23D11"] },
    lidar = { ...empty, lidar: ["23d42"] }
  assert.equal(checkPicks("x", ctr), ctr)
  assert.equal(checkPicks("x", lidar), lidar)
})

test("fillLayer codes each play-area cell by its fill source, 0 on the LiDAR, and throws on a source it has no column for", () => {
  const grid = gridOver([[0, 0, 50, 10]], 10),
    all = new Uint16Array([1, 1, 1, 1, 1])
  const sides = ["lidar", "dsm2021", "dtm10", "lig", "rer"]
  assert.deepEqual([...fillLayer(grid, all, (x) => sides[Math.floor(x / 10)])!], [0, 1, 2, 3, 4])
  // A source the chain gains must get a column, not count as LiDAR.
  assert.throws(
    () => fillLayer(grid, all, () => "tinitaly"),
    /no coverage column for terrain source tinitaly/,
  )
})

test("fillLayer never asks outside the play area, and has no layer while a play-area cell has no terrain", () => {
  const grid = gridOver([[0, 0, 50, 10]], 10),
    play = new Uint16Array([0, 1, 1, 1, 0])
  // The cells outside the play area have no terrain, and an unknown source: neither is asked.
  const source = (x: number) => (x < 10 ? "tinitaly" : x > 40 ? undefined : "dtm10")
  assert.deepEqual([...fillLayer(grid, play, source)!], [0, 2, 2, 2, 0])
  assert.equal(
    fillLayer(grid, play, (x) => (x > 30 ? undefined : "lidar")),
    undefined,
  )
})

test("tileSource reads a point's source from the nearest cell of the file of the tile holding it, none where no file holds one", () => {
  // Tile 0_0's file: its cells west of column C the LiDAR's, the rest the 10 m DTM's, none north
  // of row R; tile 1_0 has no file.
  const t = emptyTile(0, 0, SOURCES),
    C = 600,
    R = 700
  for (let r = 0; r <= R; r++)
    for (let c = 0; c < t.cols; c++) t.codes[r * t.cols + c] = c < C ? 0 : 2
  const source = tileSource([{ i: 0, j: 0, tile: t }])
  /** The local point at EPSG:3003 (e, n) past cell (C, 300)'s centre. */
  const at = (de: number, dn: number) =>
    toLocal(...gaussBoagaToLatLon(t.e0 + CELL * C + de, t.n0 + CELL * 300 + dn))
  // Nearest cell C (0.9 m west of its centre), then C − 1 (1.1 m west).
  assert.equal(source(...at(-0.9, 0)), "dtm10")
  assert.equal(source(...at(-1.1, 0)), "lidar")
  assert.equal(source(...at(-1.1, CELL * (R - 300) + 0.9)), "lidar")
  assert.equal(source(...at(-1.1, CELL * (R - 300) + 1.1)), undefined)
  assert.equal(source(2500, 1000), undefined)
  assert.equal(source(1000, -10), undefined)
})

test("coverage throws on a mistyped flag before it reads or asks for anything", () => {
  const run = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "../coverage.ts"), "nope", "--refesh"],
    { encoding: "utf8" },
  )
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /Unknown option '--refesh'/)
})
