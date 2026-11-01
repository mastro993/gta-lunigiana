import assert from "node:assert/strict"
import { test } from "node:test"

import { staticGrid } from "../../../sim/collide.ts"
import { MAP, type Water } from "../../../sim/map/index.ts"
import { TILE, tileKey, tileRange, WATER_VERTICES } from "../../../sim/map/kinds.ts"
import { tileVectors } from "../../../sim/map/tiles.ts"
import { residentAround } from "../../testing.ts"
import { reachesIn } from "../water.ts"

// Map checks (pnpm test:map): the reaches of the tiles, every tile in memory, against the whole map's water joined from
// them; water.test.ts checks those round Monzone station.
const RANGE = tileRange(MAP.bounds)
const { minX, minY, maxX, maxY } = MAP.bounds
residentAround([{ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }], Math.max(maxX - minX, maxY - minY))
/** The whole map's water, each piece from the first tile holding it (every copy is the same: vectors.map-test.ts). */
const WATER: ReadonlyArray<Water> = (() => {
  const out: Array<Water> = []
  for (const { i, j } of MAP.tiles) {
    const { ids, items } = tileVectors(tileKey(i, j)).water
    ids.forEach((id, k) => (out[id] ??= items[k]!))
  }
  assert.equal(out.filter(Boolean).length, MAP.vectors.counts.water)
  return out
})()

test("the reaches come as one broad phase over every reach of the whole map gave them: the same, in the same order, each once, across the seams too", () => {
  // Every reach of the whole map's water, its id and its box: what the sound's broad phase gridded before the tiles.
  const ids: Array<number> = [],
    boxes: Array<readonly [number, number, number, number]> = []
  WATER.forEach(({ pts }, w) => {
    for (let i = 0; 2 * i + 3 < pts.length; i++) {
      const ax = pts[2 * i]!,
        ay = pts[2 * i + 1]!,
        bx = pts[2 * i + 2]!,
        by = pts[2 * i + 3]!
      ids.push(w * WATER_VERTICES + i)
      boxes.push([Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)])
    }
  })
  assert.deepEqual(MAP.vectors.lattice.water, [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
  ])
  const grid = staticGrid(boxes.length, (k) => boxes[k]!, 32)
  // Boxes from 1 to 800 m across (the 400 m disc), half of them within 80 m of a seam.
  let seed = 5,
    found = 0
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let k = 0; k < 1500; k++) {
    const seam = k % 2 === 0
    const x = seam
        ? TILE * (RANGE.i0 + Math.floor(next() * (RANGE.i1 - RANGE.i0 + 2))) + (next() - 0.5) * 160
        : minX - 50 + next() * (maxX - minX + 100),
      y = seam
        ? TILE * (RANGE.j0 + Math.floor(next() * (RANGE.j1 - RANGE.j0 + 2))) + (next() - 0.5) * 160
        : minY - 50 + next() * (maxY - minY + 100),
      r = 0.5 + next() ** 2 * 400
    const box = [x - r, y - r, x + r, y + r] as const
    const got: Array<number> = [],
      want: Array<number> = []
    assert.ok(
      reachesIn(...box, (id, { ax, ay, bx, by, az, bz }) => {
        got.push(id)
        const { pts, z } = WATER[Math.floor(id / WATER_VERTICES)]!,
          i = id % WATER_VERTICES
        assert.deepEqual([ax, ay, bx, by, az, bz], [...pts.slice(2 * i, 2 * i + 4), z[i], z[i + 1]])
      }),
    )
    grid(...box, (item) => want.push(ids[item]!))
    assert.deepEqual(got, want, box.join(","))
    found += got.length
  }
  assert.ok(found > 10_000, `${found} reaches found`)
})
