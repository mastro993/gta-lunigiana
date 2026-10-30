import assert from "node:assert/strict"
import { test } from "node:test"

import { TILE } from "../../sim/map/kinds.ts"
import type { BuildingF, RoadF, WaterF } from "../features.ts"
import { hash01 } from "../geometry.ts"
import type { Rect } from "../region.ts"
import { mergeTrees } from "../tile-map.ts"
import { scatterTrees, type TreeFeatures, treeScatter } from "../trees.ts"

/** Lucido's lattice anchor and built terrain. */
const LUCIDO = {
  anchor: { x: -2900, y: -6100 },
  bounds: { minX: -2900, minY: -6100, maxX: 4900, maxY: 3900 },
}

/** Tile (i, j)'s box. */
const tileBox = (i: number, j: number): Rect => [TILE * i, TILE * j, TILE * (i + 1), TILE * (j + 1)]

/** A box's ring. */
const ring = ([x0, y0, x1, y1]: Rect) => [x0, y0, x1, y0, x1, y1, x0, y1]

/** A stream of width `w` along `pts`, its piece starting `from` m along its way. */
const stream = (id: number, pts: ReadonlyArray<readonly [number, number]>, from = 0): WaterF => ({
  id,
  kind: "stream",
  w: 6,
  bed: 4,
  depth: 1,
  pts: pts.map(([x, y]) => ({ x, y })),
  from,
})

const road: RoadF = {
  id: 1,
  cls: "residential",
  w: 5,
  surface: "asphalt",
  private: false,
  pts: [
    { x: 1950, y: 1900 },
    { x: 2050, y: 1960 },
  ],
}

const house: BuildingF = {
  id: 2,
  kind: "house",
  h: 6,
  style: "plaster",
  tint: 0,
  outer: ring([-20, -30, -5, -15]),
}

// Two woods astride seams, each holding a pair of lattice points that round onto one spot of a
// seam from either side of it (at (2000, 1975) and (126, 0), found by search), a meadow across the
// x = 2000 seam, a road and a house; a stream across the seam with a second one 0.5 m beside it,
// whose bank trees fall in the first one's 4 m cells.
const FEATURES: TreeFeatures = {
  areas: [
    { kind: "forest", rings: [ring([1900, 1900, 2100, 2050])] },
    { kind: "forest", rings: [ring([-100, -100, 226, 100])] },
    { kind: "meadow", rings: [ring([1990, 1920, 2010, 1940])] },
  ],
  roads: [road],
  buildings: [house],
  water: [
    stream(7, [
      [1800, 1000],
      [2200, 1000],
    ]),
    stream(3, [
      [1800, 1000.5],
      [2200, 1000.5],
    ]),
  ],
  rail: [],
}

/** The lattice point of cell (gi, gj) on lucido's anchor, as the scatter jitters it. */
const latticePoint = (gi: number, gj: number) => {
  const step = Math.sqrt(50)
  return [
    LUCIDO.anchor.x + (gi + hash01(gi, gj, 1)) * step,
    LUCIDO.anchor.y + (gj + hash01(gi, gj, 2)) * step,
  ] as const
}

test("the scatters of the tiles, merged by id, are the scatter of their whole box, seam pairs included", () => {
  // The fixture holds what the seams test: two lattice points rounding onto one spot of a seam,
  // one from each side of it, both in a wood.
  const pairs = [
    [2000, 1975],
    [126, 0],
  ].filter(([sx, sy]) => {
    const from = new Set<string>()
    const step = Math.sqrt(50),
      gi = Math.floor((sx! - LUCIDO.anchor.x) / step),
      gj = Math.floor((sy! - LUCIDO.anchor.y) / step)
    for (let j = gj - 1; j <= gj + 1; j++)
      for (let i = gi - 1; i <= gi + 1; i++) {
        const [x, y] = latticePoint(i, j)
        if (Math.round(x) === sx && Math.round(y) === sy)
          from.add(`${Math.floor(x / TILE)}_${Math.floor(y / TILE)}`)
      }
    return from.size === 2
  })
  assert.equal(pairs.length, 2)
  const scatter = treeScatter(FEATURES, LUCIDO)
  const tiles = [-1, 0, 1].flatMap((j) => [-1, 0, 1].map((i) => scatter(tileBox(i, j))))
  const whole = scatter([-2000, -2000, 4000, 4000])
  const merged = mergeTrees(tiles)
  assert.deepEqual(Array.from(merged.ids), Array.from(whole.ids))
  assert.deepEqual(Array.from(merged.trees), Array.from(whole.trees))
  // Each pair's spot holds one tree, owned by the tile of its rounded point.
  for (const [sx, sy] of pairs) {
    const at: Array<number> = []
    for (let k = 0; k < whole.ids.length; k++)
      if (whole.trees[3 * k] === sx && whole.trees[3 * k + 1] === sy) at.push(k)
    assert.equal(at.length, 1, `${sx}, ${sy}`)
  }
  // Ids ascend without repeats: the second stream's bank trees left the first one's cells alone.
  assert.ok(whole.ids.every((id, k) => k === 0 || id > whole.ids[k - 1]!))
  const banks = Array.from(whole.ids).filter((id) => id >= 2 ** 28).length
  assert.ok(banks > 40, `${banks} bank trees`)
})

test("a tree keeps its place and id as the region's box grows: the lattice starts at the anchor, not the bounds", () => {
  const grown = {
    anchor: LUCIDO.anchor,
    bounds: { minX: -8900, minY: -10100, maxX: 8900, maxY: 7900 },
  }
  for (const [i, j] of [
    [1, 0],
    [0, -1],
  ] as const) {
    const before = treeScatter(FEATURES, LUCIDO)(tileBox(i, j)),
      after = treeScatter(FEATURES, grown)(tileBox(i, j))
    assert.ok(before.ids.length > 100)
    assert.deepEqual(Array.from(after.ids), Array.from(before.ids))
    assert.deepEqual(Array.from(after.trees), Array.from(before.trees))
  }
})

test("bank trees count their steps from the start of the way: a piece the outline cut keeps the whole stream's", () => {
  const whole = stream(5, [
    [-1000, -1500],
    [-1000, -500],
  ])
  const piece = stream(
    5,
    [
      [-1000, -1200],
      [-1000, -500],
    ],
    300,
  )
  const banks = (w: WaterF) => {
    const { trees, ids } = treeScatter({ ...FEATURES, water: [w] }, LUCIDO)(tileBox(-1, -1))
    const out: Array<string> = []
    for (let k = 0; k < ids.length; k++)
      if (trees[3 * k + 1]! >= -1195)
        out.push(`${trees[3 * k]},${trees[3 * k + 1]},${trees[3 * k + 2]},${ids[k]}`)
    return out
  }
  assert.ok(banks(whole).length > 50)
  assert.deepEqual(banks(piece), banks(whole))
})

test("scatterTrees covers the region's tiles: a stream's banks in every tile it crosses, none in a tile left out", () => {
  const water = [
    stream(9, [
      [100, LUCIDO.bounds.minY + 50],
      [100, LUCIDO.bounds.maxY - 50],
    ]),
  ]
  const tiles = [-4, -3, -2, -1, 0, 1].map((j) => ({ i: 0, j }))
  const rowsOf = (listed: ReadonlyArray<{ readonly i: number; readonly j: number }>) => {
    const { trees } = scatterTrees({ ...FEATURES, water }, { ...LUCIDO, tiles: listed })
    const rows = new Set<number>()
    for (let k = 0; k < trees.length; k += 3)
      if (Math.abs(trees[k]! - 100) <= 4 + 2 + 3 + 1) rows.add(Math.floor(trees[k + 1]! / TILE))
    return [...rows].sort((a, b) => a - b)
  }
  assert.deepEqual(rowsOf(tiles), [-4, -3, -2, -1, 0, 1])
  assert.deepEqual(rowsOf(tiles.filter(({ j }) => j !== -2)), [-4, -3, -1, 0, 1])
})

test("the last bank cell's tree gets the largest id, whose look's seeds stay below 2^32, where hash01 tells them apart", () => {
  // Bank cells number 16384 each way from the anchor: (16383, 16383) is the last, 65532–65536 m
  // north-east of it. A stream east of it keeps its 60th step's west bank tree there (by search).
  const far = { anchor: { x: 0, y: 0 }, bounds: { minX: 0, minY: 0, maxX: 65536, maxY: 65536 } }
  const features = {
    ...FEATURES,
    water: [
      stream(2, [
        [65540, 64993],
        [65540, 65600],
      ]),
    ],
  }
  const window: Rect = [64000, 64000, 66000, 66000]
  const { trees, ids } = treeScatter(features, far)(window)
  const last = ids.length - 1
  assert.deepEqual([trees[3 * last], trees[3 * last + 1]], [65533, 65533])
  assert.equal(ids[last], 2 ** 28 + 2 ** 30 - 1)
  // The render seeds a look from 3 * id (a mirror's from one more), past int32 for bank trees:
  // hash01 takes each number through ToInt32, so seeds 2^32 apart look alike, and below 2^32 none do.
  const seed = 3 * ids[last] + 1
  assert.ok(seed > 2 ** 31 && seed < 2 ** 32, `${seed}`)
  assert.equal(hash01(seed, 11), hash01(seed - 2 ** 32, 11))
  // A cell further would wrap, so the scatter throws there.
  assert.throws(
    () => treeScatter(features, { ...far, anchor: { x: -4, y: -4 } })(window),
    /past the 16384 cells the ids number/,
  )
})
