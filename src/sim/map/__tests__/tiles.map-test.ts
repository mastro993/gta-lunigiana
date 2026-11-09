import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { test } from "node:test"

import { latticeGround } from "../../../tools/build-ground.ts"
import { wholeMap } from "../../../tools/map-file.ts"
import { regionFromArgs } from "../../../tools/region.ts"
import { staticGrid } from "../../collide.ts"
import { coverAt, coverName } from "../cover.ts"
import { decodeTile } from "../format/tile-file.ts"
import { terrainZ } from "../ground.ts"
import { heightAt, MAP, treesIn, wallsNear } from "../index.ts"
import { anchorOf, pushTrunk, TILE, tileKey, tileRange, tilesRound, TRUNK } from "../kinds.ts"
import { readMapFile, TILE_CELLS, tileUrl } from "../packed.ts"

// Map checks (pnpm test:map): every tile of the shipped map, and the whole map joined from them
// (src/tools/__tests__/seams.map-test.ts checks the nodes two tiles share, on both maps).
const WHOLE = wholeMap()
const KEYS = MAP.tiles.map(({ i, j }) => tileKey(i, j))
const tiles = new Map(KEYS.map((key) => [key, decodeTile(readMapFile(tileUrl(MAP.name, key)))]))

/** The bounds' tile range (`tileRange`): the listed tiles and the notch's of an L. */
const RANGE = tileRange(MAP.bounds)

test("the tiles are the region's, those its parts' rectangles meet, listed south to north, then west to east, each with a file (Lunigiana's 102 of the bounds' 132: two notches)", () => {
  const box: Array<string> = []
  for (let j = RANGE.j0; j <= RANGE.j1; j++)
    for (let i = RANGE.i0; i <= RANGE.i1; i++) box.push(tileKey(i, j))
  const region = regionFromArgs([]).tiles.map(({ i, j }) => tileKey(i, j))
  assert.deepEqual(KEYS, region)
  assert.deepEqual(
    KEYS,
    box.filter((key) => KEYS.includes(key)),
  )
  assert.deepEqual([KEYS.length, box.length], [102, 132], "today's Lunigiana")
  // the notches' tiles have no file
  for (const key of box)
    assert.equal(existsSync(tileUrl(MAP.name, key)), KEYS.includes(key), `${key}'s file`)
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

test("heightAt, terrainZ and coverAt read the tiles bit for bit as the whole heightmap and land cover give them, an L's notch the nearest listed node and cell", () => {
  const { cell, cols, rows, x0, y0 } = WHOLE.heightmap,
    { x: ax, y: ay, i: ai, j: aj } = anchorOf(WHOLE.heightmap)
  // The joined map holds 0 in the notch, which no tile holds: the game reads there the nearest
  // node or cell of the listed tiles round it (`tilesRound`), the first in key order on a tie, as
  // the cut's coarse grid does (tile-map.ts).
  const n = TILE / cell,
    cx = x0 / cell,
    cy = y0 / cell,
    listed = new Set(KEYS),
    isListed = (i: number, j: number) => listed.has(tileKey(i, j))
  /** The index of node (`cells` 0) or cell (1) (gi, gj), on the grid, the game reads. */
  const readAt = (gi: number, gj: number, cells: 0 | 1) => {
    const ni = cx + gi,
      nj = cy + gj,
      ti = Math.min(RANGE.i1, Math.max(RANGE.i0, Math.floor(ni / n))),
      tj = Math.min(RANGE.j1, Math.max(RANGE.j0, Math.floor(nj / n))),
      across = cols - cells
    if (isListed(ti, tj)) return gj * across + gi
    let best = Infinity,
      at = -1
    for (const [ri, rj] of tilesRound(ti, tj, isListed)) {
      const x = Math.min(cx + cols - 1 - cells, n * ri + n - cells, Math.max(cx, n * ri, ni)),
        y = Math.min(cy + rows - 1 - cells, n * rj + n - cells, Math.max(cy, n * rj, nj)),
        d = (x - ni) * (x - ni) + (y - nj) * (y - nj)
      if (d < best) [best, at] = [d, (y - cy) * across + x - cx]
    }
    return at
  }
  const data = (k: number) => WHOLE.heightmap.data[readAt(k % cols, Math.floor(k / cols), 0)]!
  const { minX, minY, maxX, maxY } = MAP.bounds
  // Today's bilinear formula over the whole grid (src/sim/map/index.ts before the tiles), a point's
  // cell counted from the anchor.
  const bilinear = (x: number, y: number) => {
    const fx = (Math.min(maxX, Math.max(minX, x)) - ax) / cell,
      fy = (Math.min(maxY, Math.max(minY, y)) - ay) / cell
    const i = Math.min(cols - 2, Math.max(0, Math.floor(fx) + ai)),
      j = Math.min(rows - 2, Math.max(0, Math.floor(fy) + aj))
    const tx = fx - (i - ai),
      ty = fy - (j - aj),
      k = j * cols + i
    const south = data(k) + (data(k + 1) - data(k)) * tx
    const north = data(k + cols) + (data(k + cols + 1) - data(k + cols)) * tx
    return (south + (north - south) * ty) / 10
  }
  // The ground model's terrain over the whole grid, as read here.
  const { terrainZ: drawn } = latticeGround(WHOLE.heightmap, data)
  // Points on and beside every seam, inside every tile, and far outside the bounds past each corner.
  const points: Array<readonly [number, number]> = [
    [-1e6, -1e6],
    [1e6, -1e6],
    [-1e6, 1e6],
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
  const read = new Set<string>()
  for (const [x, y] of points) {
    read.add(
      tileKey(
        Math.min(RANGE.i1, Math.max(RANGE.i0, Math.floor(x / TILE))),
        Math.min(RANGE.j1, Math.max(RANGE.j0, Math.floor(y / TILE))),
      ),
    )
    assert.equal(heightAt(x, y), bilinear(x, y), `heightAt ${x},${y}`)
    assert.equal(terrainZ(x, y), drawn(x, y), `terrainZ ${x},${y}`)
    const ci = Math.min(cols - 2, Math.max(0, Math.floor((x - ax) / cell) + ai)),
      cj = Math.min(rows - 2, Math.max(0, Math.floor((y - ay) / cell) + aj))
    assert.equal(coverAt(x, y), coverName(WHOLE.cover[readAt(ci, cj, 1)]!), `coverAt ${x},${y}`)
  }
  // Points read in every tile of the bounds, each notch's too, and a notch at a corner of the bounds,
  // found from the list (Lunigiana's north-west and south-east corners today)
  for (let j = RANGE.j0; j <= RANGE.j1; j++)
    for (let i = RANGE.i0; i <= RANGE.i1; i++)
      assert.ok(read.has(tileKey(i, j)), `a point read in ${tileKey(i, j)}`)
  assert.ok(
    [RANGE.i0, RANGE.i1].some((i) => [RANGE.j0, RANGE.j1].some((j) => !isListed(i, j))),
    "a notch at a corner of the bounds",
  )
})

test("wallsNear and treesIn answer exactly as one broad phase over the whole map does: the same walls and trunks, in the same order, across the seams too", () => {
  // The whole map's broad phases as they were before the map was cut (staticGrid anchors each at its
  // items' lowest corner), handing trees' ids. The trees' corner is fixed per region, not their
  // lowest (a part to the west or south, or an OSM refresh, moves that), so a sentinel item, never
  // answered, stands on the corner's 16 m lattice at or south-west of every tree: the grid's cells
  // are the runtime's.
  const { walls, trees, treeIds } = WHOLE
  const count = trees.length / 3,
    corner = MAP.walls.lattice.trees
  const lowest = [Infinity, Infinity]
  for (let k = 0; k < trees.length; k += 3)
    [lowest[0], lowest[1]] = [Math.min(lowest[0]!, trees[k]!), Math.min(lowest[1]!, trees[k + 1]!)]
  const [sx, sy] = [0, 1].map(
    (a) => corner[a]! - 16 * Math.max(0, Math.ceil((corner[a]! - lowest[a]!) / 16)),
  )
  const sentinelGrid = staticGrid(
    count + 1,
    (i) =>
      i === count
        ? [sx!, sy!, sx!, sy!]
        : [trees[3 * i]!, trees[3 * i + 1]!, trees[3 * i]!, trees[3 * i + 1]!],
    16,
  )
  const treeGrid = (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    visit: (i: number) => void,
  ) => sentinelGrid(minX, minY, maxX, maxY, (i) => i < count && visit(i))
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
    treeGrid(...box, (i) => want.push(treeIds[i]!))
    assert.deepEqual(ids, want, `trees ${box.join(",")}`)
  }
})
