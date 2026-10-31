import assert from "node:assert/strict"
import { test } from "node:test"

import { coverName } from "../cover.ts"
import { AREA_KINDS } from "../index.ts"
import { coverBlocks } from "../raster.ts"

// 10 × 10 cells of 4 m from (0, 0); row 0 = south.
const heightmap = {
  cell: 4,
  cols: 11,
  rows: 11,
  x0: 0,
  y0: 0,
  data: Array.from({ length: 121 }, () => 2000),
}
const at = (raster: Uint8Array, x: number, y: number) =>
  coverName(raster[Math.floor(y / 4) * 10 + Math.floor(x / 4)]!)
const bare = { roads: [], buildings: [] }

test("areas fill even-odd (holes stay meadow) and later kinds draw over forest", () => {
  const raster = coverBlocks({
    ...bare,
    heightmap,
    water: [],
    areas: [
      { kind: "parking", rings: [[20, 20, 28, 20, 28, 28, 20, 28]] },
      {
        kind: "forest",
        rings: [
          [0, 0, 40, 0, 40, 40, 0, 40],
          [4, 4, 4, 12, 12, 12, 12, 4],
        ],
      },
    ],
  })()
  assert.equal(at(raster, 2, 2), "forest")
  assert.equal(at(raster, 6, 6), "meadow")
  assert.equal(at(raster, 22, 22), "parking")
})

test("wide water gets a pebble bed, narrow streams none", () => {
  const raster = coverBlocks({
    ...bare,
    heightmap,
    areas: [],
    water: [
      {
        id: 1,
        kind: "river",
        w: 14,
        bed: 11,
        depth: 2.5,
        pts: [0, 30, 40, 30],
        z: [200, 200],
        area: [40, 40],
      },
      {
        id: 2,
        kind: "stream",
        w: 2,
        bed: 3,
        depth: 1,
        pts: [0, 6, 40, 6],
        z: [200, 200],
        area: [1, 1],
      },
    ],
  })()
  assert.equal(at(raster, 10, 30), "pebble")
  assert.equal(at(raster, 10, 37), "pebble") // cell centre 8 m out: past the water (7 m), inside the bed (12 m)
  assert.equal(at(raster, 10, 6), "meadow")
})

test("every area kind paints as its own cover", () => {
  for (const kind of AREA_KINDS)
    assert.equal(
      at(
        coverBlocks({
          ...bare,
          heightmap,
          water: [],
          areas: [{ kind, rings: [[0, 0, 8, 0, 8, 8, 0, 8]] }],
        })(),
        2,
        2,
      ),
      kind,
    )
})

test("open ground between a house and a road is paved; a garden behind the house stays meadow", () => {
  // A road along y = 10 (4 m wide), a house from y = 15 to y = 25, nothing else.
  const house = {
    id: 1,
    kind: "house",
    h: 6,
    z0: 200,
    style: "plaster",
    tint: 0,
    outer: [8, 15, 32, 15, 32, 25, 8, 25],
  }
  const road = {
    id: 1,
    cls: "residential",
    w: 4,
    surface: "asphalt",
    pts: [0, 10, 40, 10],
    z: [200, 200],
  }
  const raster = coverBlocks({
    heightmap,
    water: [],
    areas: [],
    roads: [road],
    buildings: [house],
  })()
  assert.equal(at(raster, 18, 13), "paved") // the 3 m between the road edge and the house
  assert.equal(at(raster, 18, 35), "meadow") // 10 m behind it
  assert.equal(at(raster, 38, 38), "meadow")
})

test("a block of the raster has the cells the whole raster has there", () => {
  const map = {
    heightmap,
    areas: [
      { kind: "forest" as const, rings: [[0, 0, 40, 0, 40, 6, 0, 6]] },
      { kind: "parking" as const, rings: [[13, 9, 31, 11, 27, 33, 9, 22]] },
    ],
    water: [
      {
        id: 1,
        kind: "river" as const,
        w: 8,
        bed: 6,
        depth: 1,
        pts: [3, 37, 37, 3],
        z: [200, 199],
        area: [1, 1],
      },
    ],
    roads: [
      { id: 1, cls: "residential", w: 4, surface: "asphalt", pts: [0, 21, 40, 19], z: [200, 200] },
    ],
    buildings: [
      {
        id: 1,
        kind: "house",
        h: 6,
        z0: 200,
        style: "plaster",
        tint: 0,
        outer: [6, 25, 14, 25, 14, 31, 6, 31],
      },
    ],
  }
  const whole = coverBlocks(map)()
  for (const block of [
    { c0: 0, r0: 0, cols: 10, rows: 10 },
    { c0: 3, r0: 4, cols: 5, rows: 2 },
    { c0: 7, r0: 0, cols: 3, rows: 10 },
  ]) {
    const part = coverBlocks(map)(block)
    part.forEach((v, k) =>
      assert.equal(
        v,
        whole[(block.r0 + Math.floor(k / block.cols)) * 10 + block.c0 + (k % block.cols)],
      ),
    )
  }
  assert.deepEqual([...new Set(whole)].map(coverName).sort(), [
    "forest",
    "meadow",
    "parking",
    "paved",
    "pebble",
  ])
})

test("every block coverBlocks fills has the cells the whole raster has there, areas beside it skipped", () => {
  const map = {
    heightmap,
    // Areas each in a corner or a stripe of the cells, so most blocks meet some and miss others.
    areas: [
      { kind: "forest" as const, rings: [[0, 0, 40, 0, 40, 6, 0, 6]] },
      { kind: "parking" as const, rings: [[13, 9, 31, 11, 27, 33, 9, 22]] },
      { kind: "rock" as const, rings: [[0.5, 33, 4.1, 33, 4.1, 40, 0.5, 40]] },
      { kind: "farmland" as const, rings: [[35.9, 30, 40, 30, 40, 34.2, 35.9, 34.2]] },
    ],
    water: [],
    roads: [],
    buildings: [],
  }
  const cover = coverBlocks(map),
    whole = cover()
  for (let c0 = 0; c0 < 10; c0++)
    for (let r0 = 0; r0 < 10; r0++)
      for (const [cols, rows] of [
        [1, 1],
        [2, 3],
        [10 - c0, 1],
        [1, 10 - r0],
      ] as const) {
        if (c0 + cols > 10 || r0 + rows > 10) continue
        const part = cover({ c0, r0, cols, rows })
        part.forEach((v, k) =>
          assert.equal(v, whole[(r0 + Math.floor(k / cols)) * 10 + c0 + (k % cols)], `${c0} ${r0}`),
        )
      }
})

// Regression: the scanline measured a crossing from the heightmap's corner, so where a polygon's edge
// passes a cell's centre to within a few ulps the cell came out filled on one box and not on another:
// three cells inside lucido differed on the 3x test region, this edge's among them.
test("the cover is the same on two heightmaps round one anchor where an edge grazes a cell's centre", () => {
  // A grassland whose west edge crosses row y = −5274 at x = −390 less 4e-13 m, the centre of a cell.
  const areas = [
    {
      kind: "grassland" as const,
      rings: [[-398.5, -5272.3, -386.5, -5274.7, -370, -5276, -370, -5270, -398.5, -5270]],
    },
  ]
  /** The cells x −412…−364 by y −5280…−5268 on a heightmap from (x0, −5280) round the anchor (−2900, −5280). */
  const cells = (x0: number) => {
    const map = {
      ...bare,
      water: [],
      areas,
      heightmap: { cell: 4, cols: 4001, rows: 4, x0, y0: -5280, ax: -2900, ay: -5280 },
    }
    return coverBlocks(map)({ c0: (-412 - x0) / 4, r0: 0, cols: 12, rows: 3 })
  }
  assert.deepEqual(cells(-10700), cells(-2900))
})
