import assert from "node:assert/strict"
import { test } from "node:test"

import { wholeMap } from "../../../tools/map-file.ts"
import { staticGrid } from "../../collide.ts"
import { coverAt, coverName } from "../cover.ts"
import { terrainZ } from "../ground.ts"
import { heightAt, MAP, treesIn, wallsNear } from "../index.ts"
import { pushTrunk, TILE, tileKey, tileRange, TRUNK } from "../kinds.ts"
import { decodeTile, readMapFile, TILE_CELLS, TILE_NODES, tileUrl } from "../packed.ts"
import {
  dropTile,
  isResident,
  provideTile,
  residentTiles,
  setTileSource,
  tilesOver,
} from "../tiles.ts"

const WHOLE = wholeMap()
const fromDisk = (key: string) => readMapFile(tileUrl(MAP.name, key))
const KEYS = MAP.tiles.map(({ i, j }) => tileKey(i, j))
const tiles = new Map(KEYS.map((key) => [key, decodeTile(fromDisk(key))]))

/** Every tile out of memory, then the source back. */
const emptied = () => {
  for (const key of KEYS) dropTile(key)
  setTileSource(fromDisk)
}

/** The listed tile range: every tile with ground in it (`tileRange`). */
const RANGE = tileRange(MAP.bounds)

test("the tiles cover the bounds: every tile of tileRange, listed south to north, then west to east (Lunigiana's 30)", () => {
  const expected: Array<string> = []
  for (let j = RANGE.j0; j <= RANGE.j1; j++)
    for (let i = RANGE.i0; i <= RANGE.i1; i++) expected.push(tileKey(i, j))
  assert.deepEqual(KEYS, expected)
  assert.equal(KEYS.length, 30, "today's Lunigiana")
  for (const t of MAP.tiles) {
    const heights = tiles.get(tileKey(t.i, t.j))!.heights
    assert.equal(
      heights.reduce((low, z) => Math.min(low, z), Infinity),
      t.zmin,
    )
    assert.equal(
      heights.reduce((high, z) => Math.max(high, z), -Infinity),
      t.zmax,
    )
  }
})

test("shared borders: a tile's east column is its east neighbour's west column, its north row its north neighbour's south row", () => {
  let compared = 0
  for (const t of tiles.values()) {
    const east = tiles.get(tileKey(t.i + 1, t.j)),
      north = tiles.get(tileKey(t.i, t.j + 1))
    for (let k = 0; k < TILE_NODES; k++) {
      if (east !== undefined)
        assert.equal(
          t.heights[k * TILE_NODES + TILE_NODES - 1],
          east.heights[k * TILE_NODES],
          `${t.i}_${t.j} east row ${k}`,
        )
      if (north !== undefined)
        assert.equal(
          t.heights[(TILE_NODES - 1) * TILE_NODES + k],
          north.heights[k],
          `${t.i}_${t.j} north col ${k}`,
        )
    }
    compared += Number(east !== undefined) + Number(north !== undefined)
  }
  const across = RANGE.i1 - RANGE.i0 + 1,
    up = RANGE.j1 - RANGE.j0 + 1
  assert.equal(compared, (across - 1) * up + across * (up - 1))
})

test("each wall lives in the tile of its midpoint and each tree in the tile of its point (clamped to the list); no wall reaches farther than MAP.walls.reach", () => {
  const { i0, i1, j0, j1 } = {
    i0: Math.min(...MAP.tiles.map((t) => t.i)),
    i1: Math.max(...MAP.tiles.map((t) => t.i)),
    j0: Math.min(...MAP.tiles.map((t) => t.j)),
    j1: Math.max(...MAP.tiles.map((t) => t.j)),
  }
  const owner = (x: number, y: number) =>
    tileKey(
      Math.min(i1, Math.max(i0, Math.floor(x / TILE))),
      Math.min(j1, Math.max(j0, Math.floor(y / TILE))),
    )
  let walls = 0,
    trees = 0
  for (const [key, t] of tiles) {
    for (const flat of [t.walls.walk, t.walls.shore, t.walls.drive])
      for (let k = 0; k < flat.length; k += 4) {
        const ax = flat[k]!,
          ay = flat[k + 1]!,
          bx = flat[k + 2]!,
          by = flat[k + 3]!
        assert.equal(owner((ax + bx) / 2, (ay + by) / 2), key)
        assert.ok(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / 2 < MAP.walls.reach)
        walls++
      }
    for (let k = 0; k < t.trees.length; k += 3)
      assert.equal(owner(t.trees[k]!, t.trees[k + 1]!), key)
    trees += t.ids.length
    assert.equal(t.cover.length, TILE_CELLS * TILE_CELLS)
  }
  assert.equal(
    walls,
    (WHOLE.walls.walk.length + WHOLE.walls.shore.length + WHOLE.walls.drive.length) / 4,
  )
  assert.equal(trees, WHOLE.trees.length / 3)
})

test("heightAt, terrainZ and coverAt read the tiles bit for bit as the whole heightmap and land cover give them", () => {
  const { cell, cols, rows, x0, y0, data } = WHOLE.heightmap
  const node = (i: number, j: number) =>
    data[Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))]! / 10
  const { minX, minY, maxX, maxY } = MAP.bounds
  // Today's formulas over the whole grid (src/sim/map/index.ts and ground.ts before the tiles).
  const bilinear = (x: number, y: number) => {
    const fx = (Math.min(maxX, Math.max(minX, x)) - x0) / cell,
      fy = (Math.min(maxY, Math.max(minY, y)) - y0) / cell
    const i = Math.min(cols - 2, Math.max(0, Math.floor(fx))),
      j = Math.min(rows - 2, Math.max(0, Math.floor(fy)))
    const tx = fx - i,
      ty = fy - j,
      k = j * cols + i
    const south = data[k]! + (data[k + 1]! - data[k]!) * tx
    const north = data[k + cols]! + (data[k + cols + 1]! - data[k + cols]!) * tx
    return (south + (north - south) * ty) / 10
  }
  const drawn = (x: number, y: number) => {
    const fx = (x - x0) / cell,
      fy = (y - y0) / cell,
      i = Math.floor(fx),
      j = Math.floor(fy),
      u = fx - i,
      v = fy - j
    const sw = node(i, j),
      se = node(i + 1, j),
      nw = node(i, j + 1),
      ne = node(i + 1, j + 1)
    return u >= v ? sw + (se - sw) * u + (ne - se) * v : sw + (ne - nw) * u + (nw - sw) * v
  }
  // Points on and beside every seam, inside every tile, and far outside the bounds.
  const points: Array<readonly [number, number]> = [
    [-1e6, -1e6],
    [1e6, 1e6],
    [maxX, maxY],
    [minX - 150, maxY + 150],
  ]
  for (let x = minX - 200; x <= maxX + 200; x += 997.3)
    for (let y = minY - 200; y <= maxY + 200; y += 811.7) points.push([x, y])
  for (let i = RANGE.i0; i <= RANGE.i1 + 1; i++)
    for (const d of [-0.05, 0, 0.05, 3.9])
      for (let t = minY; t <= maxY; t += 413.1) points.push([TILE * i + d, t])
  for (let j = RANGE.j0; j <= RANGE.j1 + 1; j++)
    for (const d of [-0.05, 0, 0.05, 3.9])
      for (let t = minX; t <= maxX; t += 413.1) points.push([t, TILE * j + d])
  for (const [x, y] of points) {
    assert.equal(heightAt(x, y), bilinear(x, y), `heightAt ${x},${y}`)
    assert.equal(terrainZ(x, y), drawn(x, y), `terrainZ ${x},${y}`)
    const ci = Math.min(cols - 2, Math.max(0, Math.floor((x - x0) / cell))),
      cj = Math.min(rows - 2, Math.max(0, Math.floor((y - y0) / cell)))
    assert.equal(coverAt(x, y), coverName(WHOLE.cover[cj * (cols - 1) + ci]!), `coverAt ${x},${y}`)
  }
})

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
  for (const order of [KEYS, [...KEYS].reverse()]) {
    emptied()
    for (const key of order) provideTile(fromDisk(key))
    assert.deepEqual(answer(), lazy)
  }
  assert.ok(touched.length >= 5, touched.join(" "))
  assert.ok(lazy.every((walls) => walls.length > 0))
})

test("wallsNear and treesIn answer exactly as one broad phase over the whole map does: the same walls and trunks, in the same order, across the seams too", () => {
  // The whole map's broad phases as they were before the map was cut (staticGrid anchors each at its items' lowest corner).
  const { walls, trees } = WHOLE
  const treeGrid = staticGrid(
    trees.length / 3,
    (i) => [trees[3 * i]!, trees[3 * i + 1]!, trees[3 * i]!, trees[3 * i + 1]!],
    16,
  )
  const joined = (a: ArrayLike<number>, b: ArrayLike<number>) => [
    ...Array.from(a),
    ...Array.from(b),
  ]
  const whole = (flat: ArrayLike<number>) => {
    const grid = staticGrid(
      flat.length / 4,
      (i) => {
        const ax = flat[4 * i]!,
          ay = flat[4 * i + 1]!,
          bx = flat[4 * i + 2]!,
          by = flat[4 * i + 3]!
        return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]
      },
      16,
    )
    return (minX: number, minY: number, maxX: number, maxY: number) => {
      const out: Array<string> = [],
        square: Array<number> = []
      grid(minX, minY, maxX, maxY, (i) =>
        out.push(`${flat[4 * i]},${flat[4 * i + 1]},${flat[4 * i + 2]},${flat[4 * i + 3]}`),
      )
      const h = TRUNK / 2
      treeGrid(minX - h, minY - h, maxX + h, maxY + h, (i) => {
        square.length = 0
        pushTrunk(square, trees[3 * i]!, trees[3 * i + 1]!)
        for (let k = 0; k < 16; k += 4)
          out.push(`${square[k]},${square[k + 1]},${square[k + 2]},${square[k + 3]}`)
      })
      return out
    }
  }
  const kinds = {
    walk: whole(walls.walk),
    land: whole(joined(walls.walk, walls.shore)),
    drive: whole(walls.drive),
    traffic: whole(joined(walls.drive, walls.shore)),
  }
  // Boxes from 1 to 60 m across, half of them within 40 m of a seam.
  let seed = 7
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let k = 0; k < 1500; k++) {
    const seam = k % 2 === 0
    const { minX, minY, maxX, maxY } = MAP.bounds
    const x = seam
        ? TILE * (RANGE.i0 + Math.floor(next() * (RANGE.i1 - RANGE.i0 + 2))) + (next() - 0.5) * 80
        : minX - 50 + next() * (maxX - minX + 100),
      y = seam
        ? TILE * (RANGE.j0 + Math.floor(next() * (RANGE.j1 - RANGE.j0 + 2))) + (next() - 0.5) * 80
        : minY - 50 + next() * (maxY - minY + 100),
      r = 0.5 + next() * 30
    const box = [x - r, y - r, x + r, y + r * (0.5 + next())] as const
    for (const kind of ["walk", "land", "drive", "traffic"] as const)
      assert.deepEqual(
        wallsNear(kind, ...box).map((s) => `${s.ax},${s.ay},${s.bx},${s.by}`),
        kinds[kind](...box),
        `${kind} ${box.join(",")}`,
      )
    const ids: Array<number> = [],
      want: Array<number> = []
    treesIn(...box, (_x, _y, _scale, id) => ids.push(id))
    treeGrid(...box, (i) => want.push(i))
    assert.deepEqual(ids, want, `trees ${box.join(",")}`)
  }
})

test("wallsNear finds every wall whose box overlaps the query, from whichever tile it lives in", () => {
  const all = (["walk", "drive"] as const).map((kind) => {
    const flat = Array.from(WHOLE.walls[kind])
    return Array.from({ length: flat.length / 4 }, (_, k) => flat.slice(4 * k, 4 * k + 4))
  })
  for (const [x, y] of [
    [0, 30],
    [-25, 0],
    [2000, 1500],
    [-2900, -4000],
    [4900, 2000],
  ] as const)
    (["walk", "drive"] as const).forEach((kind, k) => {
      const r = 6
      const found = new Set(wallsAt(kind, x, y, r))
      for (const [ax, ay, bx, by] of all[k]!)
        if (
          Math.max(ax!, bx!) >= x - r &&
          Math.min(ax!, bx!) <= x + r &&
          Math.max(ay!, by!) >= y - r &&
          Math.min(ay!, by!) <= y + r
        )
          assert.ok(
            found.has(`${ax},${ay},${bx},${by}`),
            `${kind} ${ax},${ay},${bx},${by} near ${x},${y}`,
          )
    })
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
