import assert from "node:assert/strict"
import { test } from "node:test"

import { coverAt } from "../cover.ts"
import { terrainZ } from "../ground.ts"
import { heightAt, MAP, wallsNear } from "../index.ts"
import { TILE, tileKey } from "../kinds.ts"
import { decodeTile, readMapFile, tileUrl } from "../packed.ts"
import {
  dropTile,
  isResident,
  provideTile,
  residentTiles,
  setTileSource,
  tilesOver,
} from "../tiles.ts"

// The checks over every tile and the whole map joined live in tiles.map-test.ts (pnpm test:map);
// these read only the tiles round a few spots.
const fromDisk = (key: string) => readMapFile(tileUrl(MAP.name, key))
const KEYS = MAP.tiles.map(({ i, j }) => tileKey(i, j))

/** Every tile out of memory, then the source back. */
const emptied = () => {
  for (const key of KEYS) dropTile(key)
  setTileSource(fromDisk)
}

/** Walls near (x, y) as text, in answer order. */
const wallsAt = (kind: "walk" | "land" | "drive" | "traffic", x: number, y: number, r: number) =>
  wallsNear(kind, x - r, y - r, x + r, y + r).map((s) => `${s.ax},${s.ay},${s.bx},${s.by}`)

test("wallsNear gives the same answer, in the same order, whatever is in memory and in whichever order it came", () => {
  // Boxes across the x = 0 and y = 0 seams near Monzone station, at the tile corner (0, 0), and on a bounds wall
  // reaching into the next tile.
  const boxes = [
    [0, 30, 12],
    [-25, 0, 12],
    [0, 0, 40],
    [-2900, -4000, 40],
  ] as const
  const answer = () =>
    boxes.flatMap(([x, y, r]) =>
      (["walk", "land", "drive", "traffic"] as const).map((kind) => wallsAt(kind, x, y, r)),
    )
  emptied()
  const lazy = answer()
  const touched = residentTiles()
  // The tiles the answers read, and every tile beside them: more than they need, in two orders.
  const around = [
    ...new Set(boxes.flatMap(([x, y]) => tilesOver(x - TILE, y - TILE, x + TILE, y + TILE))),
  ]
  for (const order of [around, [...around].reverse()]) {
    emptied()
    for (const key of order) provideTile(fromDisk(key))
    assert.deepEqual(answer(), lazy)
  }
  assert.ok(touched.length >= 5, touched.join(" "))
  assert.ok(around.length > touched.length, around.join(" "))
  assert.ok(lazy.every((walls) => walls.length > 0))
})

test("wallsNear finds every wall whose box overlaps the query, from whichever tile it lives in", () => {
  const { reach } = MAP.walls,
    decoded = new Map<string, ReturnType<typeof decodeTile>>()
  const tile = (key: string) => {
    let data = decoded.get(key)
    if (data === undefined) decoded.set(key, (data = decodeTile(fromDisk(key))))
    return data
  }
  for (const [x, y] of [
    [0, 30],
    [-25, 0],
    [2000, 1500],
    [-2900, -4000],
    [4900, 2000],
  ] as const)
    for (const kind of ["walk", "drive"] as const) {
      const r = 6
      const found = new Set(wallsAt(kind, x, y, r))
      // A wall lives in the tile of its midpoint and reaches at most `reach` from it (tiles.map-test.ts):
      // every wall that can overlap the box lives in a tile over the box grown by `reach`.
      for (const key of tilesOver(x - r - reach, y - r - reach, x + r + reach, y + r + reach)) {
        const flat = tile(key).walls[kind]
        for (let k = 0; k < flat.length; k += 4) {
          const ax = flat[k]!,
            ay = flat[k + 1]!,
            bx = flat[k + 2]!,
            by = flat[k + 3]!
          if (
            Math.max(ax, bx) >= x - r &&
            Math.min(ax, bx) <= x + r &&
            Math.max(ay, by) >= y - r &&
            Math.min(ay, by) <= y + r
          )
            assert.ok(
              found.has(`${ax},${ay},${bx},${by}`),
              `${kind} ${ax},${ay},${bx},${by} near ${x},${y}`,
            )
        }
      }
    }
})

test("a lookup in a tile that is not in memory throws, naming it; with the tile back it answers again", () => {
  emptied()
  const station = heightAt(-412, 438)
  setTileSource(undefined)
  dropTile("-1_0")
  try {
    assert.equal(isResident("-1_0"), false)
    assert.throws(() => heightAt(-412, 438), /map tile -1_0 not loaded/)
    assert.throws(() => terrainZ(-1, 1), /map tile -1_0 not loaded/)
    assert.throws(() => coverAt(-412, 438), /map tile -1_0 not loaded/)
    // A box in tile 0_0 within MAP.walls.reach of tile -1_0 reads it too.
    assert.deepEqual(tilesOver(5 - MAP.walls.reach, 100, 10 + MAP.walls.reach, 110), [
      "-1_0",
      "0_0",
    ])
    assert.throws(() => wallsNear("walk", 5, 100, 10, 110), /map tile -1_0 not loaded/)
    provideTile(fromDisk("-1_0"))
    assert.equal(heightAt(-412, 438), station)
    assert.throws(
      () => provideTile(Buffer.from(`${JSON.stringify({ version: 2 })}\n`)),
      /version 2/,
    )
  } finally {
    setTileSource(fromDisk)
  }
})
