import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../sim/map/index.ts"
import { readMapFile, tileUrl } from "../../sim/map/packed.ts"
import { dropTile, provideTile, residentTiles, setTileSource } from "../../sim/map/tiles.ts"
import { QUARTER, screenAxes } from "../../sim/view.ts"
import { makeMinimap, minimapRotation, tilesNear } from "../minimap.ts"
import { checkTilePaint, layersAround } from "./tile-paint.ts"

test("the minimap turns screen-up to the top, whichever way the view is turned", () => {
  for (const turns of [0, 1, 2, 3, -1]) {
    // North-up canvas vector of screen-up, rotated by the canvas transform (y grows downwards).
    const { up } = screenAxes(turns),
      r = minimapRotation(turns * QUARTER)
    const u = up.x,
      v = -up.y,
      c = Math.cos(r),
      s = Math.sin(r)
    assert.ok(Math.abs(u * c - v * s) < 1e-9, `turns ${turns}`)
    assert.ok(Math.abs(u * s + v * c + 1) < 1e-9, `turns ${turns}`)
  }
})

/** The minimap's reach from the player: the corner of its 300 m square, which a turn brings onto either axis. */
const VIEW = 150 * Math.SQRT2

test("the minimap shows the tiles its turned square can reach, nearest first, and none off the map", () => {
  const keys = (x: number, y: number, r: number) => tilesNear(x, y, r).map((t) => t.key)
  assert.deepEqual(keys(1000, 1000, VIEW), ["0_0"], "mid-tile: one tile")
  assert.deepEqual(
    keys(5, 1990, VIEW),
    ["0_0", "-1_0", "0_1", "-1_1"],
    "by a corner: four, nearest first",
  )
  assert.deepEqual(
    keys(1000, 1000, 1000),
    ["0_0"],
    "the neighbours of mid-tile lie a kilometre off",
  )
  assert.deepEqual(
    keys(900, 1500, 1000),
    ["0_0", "0_1", "-1_0", "-1_1"],
    "the tile in view is painted before those ahead, then the nearest",
  )
  const { minX, minY } = MAP.bounds
  for (const t of tilesNear(minX + 10, minY + 10, 1500))
    assert.ok(
      MAP.tiles.some(({ i, j }) => i === t.i && j === t.j),
      `${t.key} is a listed tile`,
    )
})

// minimap.map-test.ts (pnpm test:map) checks two tiles against the whole map painted; this one
// against the tiles round it (every feature within 2 km of it, as no stroke is that wide).
test("Monzone's tile, painted from only its own vectors, gets every fill and stroke the tiles round it would draw on it, in order and alike", () => {
  checkTilePaint(-1, 0, layersAround(-1, 0))
})

/** Monzone station, in tile -1_0. */
const STATION = { x: -493.8, y: 436.9 }

test("the minimap paints a tile once it is in memory, nearest first, and never asks for one", () => {
  let canvases = 0,
    blits = 0
  const ctx = new Proxy(
    {},
    { get: (_, key) => (key === "drawImage" ? () => blits++ : () => {}), set: () => true },
  )
  const document = {
    createElement: () => {
      canvases++
      return { width: 0, height: 0, getContext: () => ctx }
    },
  } as unknown as Document
  Object.assign(globalThis, {
    Path2D: class {
      moveTo() {}
      lineTo() {}
      closePath() {}
    },
  })
  setTileSource(undefined) // a read of a tile not in memory throws, as in the browser
  try {
    for (const key of residentTiles()) dropTile(key)
    const minimap = makeMinimap(document)
    const { x, y } = STATION
    minimap.draw(x, y, 0, 0)
    assert.deepEqual([canvases, blits], [1, 0], "no tile in memory: only the minimap's own canvas")
    provideTile(readMapFile(tileUrl(MAP.name, "0_0")))
    provideTile(readMapFile(tileUrl(MAP.name, "-1_0")))
    minimap.draw(x, y, 0, 0)
    assert.deepEqual([canvases, blits], [2, 1], "the station's tile first, the one in view")
    minimap.draw(x, y, 0, 0)
    assert.equal(canvases, 3, "then the next in memory")
    minimap.draw(x, y, 0, 0)
    assert.equal(canvases, 3, "the tiles round them are not in memory")
  } finally {
    setTileSource((key) => readMapFile(tileUrl(MAP.name, key)))
  }
})
