import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP, type Water } from "../../../sim/map/index.ts"
import { tileKey, WATER_VERTICES } from "../../../sim/map/kinds.ts"
import { cellBox } from "../../../sim/map/lattice.ts"
import {
  dropTile,
  provideTile,
  setTileSource,
  tilesOver,
  tileVectors,
} from "../../../sim/map/tiles.ts"
import { fromDisk, HELD, residentAround } from "../../testing.ts"
import { reachesIn, waterNear } from "../water.ts"

// The checks over the whole map live in water.map-test.ts (pnpm test:map); these hold the tiles round Monzone station,
// the Fontana di Aiola and the Lucido at the x = 0 seam, as the game holds those round the player.
const STATION = { x: -493.8, y: 436.9 },
  AIOLA = { x: 775.1, y: 122.9 },
  /** By the Torrente Lucido where it crosses the x = 0 seam, 4 tiles within 400 m. */
  SEAM = { x: 16, y: 343 }
residentAround([STATION, AIOLA, SEAM], HELD)

test("from Monzone station the Torrente Lucido is heard 67 m away, a calm river under the village noise", () => {
  const heard = waterNear(STATION.x, STATION.y, 400)
  const lucido = heard.find((w) => w.key === "water:Torrente Lucido")
  assert.ok(lucido !== undefined)
  assert.equal(lucido.body, "river")
  const d = Math.hypot(lucido.x - STATION.x, lucido.y - STATION.y)
  assert.ok(d > 60 && d < 75, `${d} m`)
  assert.ok(lucido.level > 45 && lucido.level < 55, `${lucido.level} dB`)
  assert.ok(lucido.flow > 0 && lucido.flow <= 1 && lucido.z > 150 && lucido.z < 250)
  assert.deepEqual(
    heard.map((w) => w.level),
    heard.map((w) => w.level).sort((a, b) => b - a),
    "loudest first",
  )
})

test("the Fontana di Aiola is a point source: 65 dB(A) at 1 m, 6 dB less per doubling, gone past the radius", () => {
  const near = waterNear(AIOLA.x, AIOLA.y, 100).find((w) => w.body === "fountain" && w.x === 765.1)
  assert.ok(near !== undefined && Math.abs(near.level - 45) < 1e-9 && near.flow > 0.2)
  assert.ok(!waterNear(AIOLA.x, AIOLA.y, 5).some((w) => w.body === "fountain"))
})

/** The tiles a reach query over the box reads: those under its 32 m cells on the rivers' lattice. */
const tilesUnder = (x0: number, y0: number, x1: number, y1: number) =>
  tilesOver(...cellBox(MAP.vectors.lattice.water, 32, x0, y0, x1, y1))

test("the reaches round Monzone station come in the whole map's order, each once, though the tiles round a seam all hold them", () => {
  const [ox, oy] = MAP.vectors.lattice.water,
    cell = (v: number, o: number) => Math.floor((v - o) / 32)
  // Boxes where the Lucido crosses the x = 0 and y = 0 seams, round the tile corner (0, 0), and 400 m discs.
  for (const [x, y, r] of [
    [SEAM.x, SEAM.y, 40],
    [60, -5, 64],
    [0, 0, 150],
    [SEAM.x, SEAM.y, 400],
    [STATION.x, STATION.y, 400],
  ] as const) {
    const box = [x - r, y - r, x + r, y + r] as const
    // Every piece of the tiles read, each once by its index, and each of its reaches by its first cell in the query's
    // cells (south to north, west to east), then by id: the order one broad phase over the whole map visits them in.
    const pieces = new Map<number, Water>()
    for (const key of tilesUnder(...box)) {
      const { ids, items } = tileVectors(key).water
      ids.forEach((id, k) => pieces.set(id, items[k]!))
    }
    const c0 = cell(box[0], ox),
      r0 = cell(box[1], oy),
      c1 = cell(box[2], ox),
      r1 = cell(box[3], oy)
    const want: Array<{ readonly id: number; readonly first: number }> = []
    for (const [w, { pts }] of pieces)
      for (let i = 0; 2 * i + 3 < pts.length; i++) {
        const ax = pts[2 * i]!,
          ay = pts[2 * i + 1]!,
          bx = pts[2 * i + 2]!,
          by = pts[2 * i + 3]!
        const c = Math.max(c0, cell(Math.min(ax, bx), ox)),
          r = Math.max(r0, cell(Math.min(ay, by), oy))
        if (c > Math.min(c1, cell(Math.max(ax, bx), ox))) continue
        if (r > Math.min(r1, cell(Math.max(ay, by), oy))) continue
        want.push({ id: w * WATER_VERTICES + i, first: (r - r0) * (c1 - c0 + 1) + c - c0 })
      }
    want.sort((a, b) => a.first - b.first || a.id - b.id)
    const got: Array<number> = []
    assert.ok(reachesIn(...box, (id) => got.push(id)))
    assert.deepEqual(
      got,
      want.map(({ id }) => id),
      box.join(", "),
    )
    assert.ok(got.length > 0, box.join(", "))
  }
})

test("the water heard across a seam is the same whichever tiles are in memory and in whichever order they came; with a tile round it out of memory none is read and only the fountains are heard", () => {
  const { x, y } = SEAM,
    want = waterNear(x, y, 400),
    under = tilesUnder(x - 400, y - 400, x + 400, y + 400),
    keys = MAP.tiles.map(({ i, j }) => tileKey(i, j))
  assert.equal(under.length, 4)
  assert.ok(want.some((w) => w.key === "water:Torrente Lucido"))
  setTileSource(undefined)
  try {
    for (const order of [under, [...under].reverse()]) {
      for (const key of keys) dropTile(key)
      for (const key of order) provideTile(fromDisk(key))
      assert.deepEqual(waterNear(x, y, 400), want)
    }
    // With no tile source, reading a missing tile would throw "map tile i_j not loaded".
    dropTile(under[3]!)
    assert.ok(!reachesIn(x - 400, y - 400, x + 400, y + 400, () => {}))
    assert.deepEqual(
      waterNear(x, y, 400).map((w) => w.key),
      want.filter((w) => w.body === "fountain").map((w) => w.key),
    )
  } finally {
    setTileSource(fromDisk)
    residentAround([STATION, AIOLA, SEAM], HELD)
  }
})
