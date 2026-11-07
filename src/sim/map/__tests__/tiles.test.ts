import assert from "node:assert/strict"
import { test } from "node:test"

import { coverAt } from "../cover.ts"
import { terrainZ } from "../ground.ts"
import { heightAt, MAP, wallsNear } from "../index.ts"
import { TILE, tileKey } from "../kinds.ts"
import { decodeTile, readMapFile, tileUrl } from "../packed.ts"
import {
  cellCorners,
  dropTile,
  isResident,
  nodeAt,
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

/** Where the play area's outline crosses a tile seam nearest the tile corner (0, 0): a bounds wall there reaches into the next tile. */
const outlineOnSeam = (): readonly [number, number] => {
  let best: readonly [number, number] = [NaN, NaN],
    least = Infinity
  const take = (x: number, y: number) => {
    if (x * x + y * y < least) [best, least] = [[x, y], x * x + y * y]
  }
  for (const ring of MAP.outline)
    for (let k = 0; k < ring.length; k += 2) {
      const ax = ring[k]!,
        ay = ring[k + 1]!,
        bx = ring[(k + 2) % ring.length]!,
        by = ring[(k + 3) % ring.length]!
      if (ax !== bx)
        for (let s = Math.ceil(Math.min(ax, bx) / TILE); TILE * s <= Math.max(ax, bx); s++)
          take(TILE * s, ay + ((by - ay) * (TILE * s - ax)) / (bx - ax))
      if (ay !== by)
        for (let s = Math.ceil(Math.min(ay, by) / TILE); TILE * s <= Math.max(ay, by); s++)
          take(ax + ((bx - ax) * (TILE * s - ay)) / (by - ay), TILE * s)
    }
  return best
}

test("wallsNear gives the same answer, in the same order, whatever is in memory and in whichever order it came", () => {
  // Boxes across the x = 0 and y = 0 seams near Monzone station, at the tile corner (0, 0), and on a
  // bounds wall reaching into the next tile, where the outline crosses a seam (found by geometry).
  const [ox, oy] = outlineOnSeam()
  const boxes = [
    [0, 30, 30],
    [-25, 0, 24],
    [0, 0, 40],
    [ox, oy, 40],
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
  // Each box holds a wall of every kind itself, not only the 16 m cells round it that its broad phase
  // answers: their corner, the kind's lowest wall, moves as a part grows the box (`MAP.walls.lattice`)
  for (const [x, y, r] of boxes)
    for (const kind of ["walk", "land", "drive", "traffic"] as const)
      assert.ok(
        wallsNear(kind, x - r, y - r, x + r, y + r).some(
          (s) =>
            Math.max(s.ax, s.bx) >= x - r &&
            Math.min(s.ax, s.bx) <= x + r &&
            Math.max(s.ay, s.by) >= y - r &&
            Math.min(s.ay, s.by) <= y + r,
        ),
        `${kind} at ${x},${y}`,
      )
})

test("wallsNear finds every wall whose box overlaps the query, from whichever tile it lives in", () => {
  const { reach } = MAP.walls,
    decoded = new Map<string, ReturnType<typeof decodeTile>>()
  const tile = (key: string) => {
    let data = decoded.get(key)
    if (data === undefined) decoded.set(key, (data = decodeTile(fromDisk(key))))
    return data
  }
  for (const [x, y] of [[0, 30], [-25, 0], [2000, 1500], outlineOnSeam(), [4900, 2000]] as const)
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

test("cellCorners reads a cell's four nodes as four nodeAt calls do, on and either side of the seams by Monzone station", () => {
  const hm = MAP.heightmap,
    gi = (x: number) => Math.floor((x - hm.x0) / hm.cell),
    gj = (y: number) => Math.floor((y - hm.y0) / hm.cell)
  const out = new Int32Array(4)
  let cells = 0
  // The x = 0 seam along Monzone station's row, the y = 0 seam along its column, and the tile corner (0, 0).
  // Two tiles hold a seam's nodes alike; which one a seam cell reads, ground.test.ts's farTerrainY checks.
  for (const [x, y] of [
    [0, 436.9],
    [-493.8, 0],
    [0, 0],
  ] as const)
    for (let i = gi(x) - 3; i <= gi(x) + 3; i++)
      for (let j = gj(y) - 3; j <= gj(y) + 3; j++) {
        cells++
        assert.deepEqual(
          [...cellCorners(i, j, out)],
          [nodeAt(i, j), nodeAt(i + 1, j), nodeAt(i, j + 1), nodeAt(i + 1, j + 1)],
          `cell ${i},${j}`,
        )
      }
  assert.equal(cells, 147)
})
