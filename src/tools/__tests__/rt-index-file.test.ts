import assert from "node:assert/strict"
import { test } from "node:test"

import { WFS_PAD } from "../cartoteca.ts"
import { CELL, blockOf, partTiles } from "../dtm-tiles.ts"
import { gaussBoagaBox } from "../geometry.ts"
import { type Part, partOf, regionFromArgs, rectsBox } from "../region.ts"
import { checkIndexBox, indexBox } from "../rt-index-file.ts"

/** The box rt-index asked over before the tiles: the rectangles' EPSG:3003 box + WFS_PAD, on whole metres outwards. */
const rectsIndexBox = (part: Part): Array<number> =>
  gaussBoagaBox(part.rects, WFS_PAD).map((v, k) => (k < 2 ? Math.floor(v) : Math.ceil(v)))

/** Fivizzano's rectangles (issue #17): north of lucido, a leg down its east side to y −900. */
const NORTH: Part = {
  key: "north",
  title: "north of lucido",
  rects: [
    [-5300, 3900, 10100, 13000],
    [4900, -900, 5700, 3900],
  ],
}
/** Lunigiana with that part beside lucido: the box round both. */
const [minX, minY, maxX, maxY] = rectsBox([...partOf("lucido").rects, ...NORTH.rects])
const GROWN = { ownTerrain: false, bounds: { minX, minY, maxX, maxY } }

test("the index box of a part that fills its tiles to the region's edge is its rectangles' box, as before the tiles", () => {
  const lucido = partOf("lucido")
  assert.deepEqual(indexBox(lucido), [1586928, 4883839, 1595866, 4894945])
  assert.deepEqual(indexBox(lucido), rectsIndexBox(lucido))
})

test("the index box holds every cell the part's tiles need, past where its rectangles stop short of them", () => {
  const box = indexBox(NORTH, GROWN),
    rects = rectsIndexBox(NORTH)
  // It holds the rectangles' box, and reaches past it south, where the leg's tiles run to y −2000.
  assert.ok(box[0] <= rects[0]! && box[1] < rects[1]! - 1000 && box[2] >= rects[2]!)
  assert.ok(box[3] >= rects[3]!)
  // Every 1 m cell of the cells the tiles need lies at least WFS_PAD − 40 m inside it: they reach
  // HALO (32 m) and a lattice cell past the tiles' cuts.
  const block = blockOf(partTiles(NORTH.rects, GROWN.bounds).map((t) => t.need))
  const e1 = block.e0 + CELL * block.cols,
    n1 = block.n0 + CELL * block.rows
  assert.ok(block.e0 - 1 - box[0] >= WFS_PAD - 40 && block.n0 - 1 - box[1] >= WFS_PAD - 40)
  assert.ok(box[2] - e1 >= WFS_PAD - 40 && box[3] - n1 >= WFS_PAD - 40)
})

test("a test region with terrain of its own keeps its rectangles' box: it mosaics them, not tiles", () => {
  assert.deepEqual(indexBox(NORTH, { ...GROWN, ownTerrain: true }), rectsIndexBox(NORTH))
  const sarzana = partOf("sarzana-town")
  assert.deepEqual(indexBox(sarzana), rectsIndexBox(sarzana))
  assert.equal(regionFromArgs(["--region", "sarzana-town"]).ownTerrain, true)
})

test("checkIndexBox takes an index over today's box or more, and refuses one over its rectangles' box alone", () => {
  const box = indexBox(NORTH, GROWN)
  checkIndexBox(box, NORTH, GROWN)
  checkIndexBox([box[0] - 1, box[1], box[2], box[3] + 1], NORTH, GROWN)
  assert.throws(
    () => checkIndexBox(rectsIndexBox(NORTH), NORTH, GROWN),
    /^Error: the index of north is over EPSG:3003 [\d,]+, short of [\d,]+ round the cells its fetch fills: run pnpm rt-index north$/,
  )
  // A metre short on any one side.
  for (const [k, step] of [
    [0, 1],
    [1, 1],
    [2, -1],
    [3, -1],
  ] as const)
    assert.throws(() => checkIndexBox(box.with(k, box[k] + step), NORTH, GROWN), /rt-index north/)
})
