import assert from "node:assert/strict"
import { test } from "node:test"

import { CELL, LATTICE, type Cells, type DtmTile, decodeTile, tileGrid } from "../dtm-tiles.ts"
import { tileCrop, writeTiles } from "../fetch-dtm.ts"
import { NONE, OUT, fillStep } from "../fill-chain.ts"
import { SOURCES } from "../terrain-sources.ts"

/** A tile file over `cells`, holding `h(c, r)` dm from source `code` where it gives a number. */
const held = (cells: Cells, h: (c: number, r: number) => number, code = 0): DtmTile => {
  const dm = new Int16Array(cells.cols * cells.rows),
    codes = new Uint8Array(cells.cols * cells.rows).fill(NONE)
  for (let r = 0; r < cells.rows; r++)
    for (let c = 0; c < cells.cols; c++) {
      const v = h(c, r)
      if (Number.isNaN(v)) continue
      dm[r * cells.cols + c] = v
      codes[r * cells.cols + c] = code
    }
  return { ...cells, names: SOURCES, dm, codes }
}

const at = (a: number, b: number, cols: number, rows: number): Cells => ({
  e0: LATTICE.e + CELL * a,
  n0: LATTICE.n + CELL * b,
  cols,
  rows,
})

test("tileCrop seeds the cells a file holds, leaves those a need lacks empty, and the rest out", () => {
  // Two needs side by side with a gap row between their tops; a file holds the first need's west half.
  const needs = [at(0, 0, 4, 3), at(4, 0, 2, 2)]
  const file = held(at(-1, 0, 3, 3), (c, r) => 1000 + 10 * c + r, 2)
  const { crop, mosaic, block, empty } = tileCrop(needs, [file])
  assert.deepEqual(block, at(0, 0, 6, 3))
  assert.deepEqual(crop, { e0: LATTICE.e - 0.5, n0: LATTICE.n - 0.5, cols: 12, rows: 6 })
  const cell = (c: number, r: number) => {
    const k = 2 * r * crop.cols + 2 * c
    return [mosaic.dm[k]!, mosaic.src[k]!] as const
  }
  // The file's cells 1 and 2 of each row are the block's 0 and 1.
  assert.deepEqual(cell(0, 2), [1012, 2])
  assert.deepEqual(cell(1, 0), [1020, 2])
  assert.ok(Number.isNaN(cell(2, 1)[0]) && cell(2, 1)[1] === NONE)
  assert.deepEqual(cell(5, 2), [0, OUT])
  // Each 2 m cell is four equal 1 m cells.
  assert.equal(mosaic.dm[1]!, 1010)
  assert.equal(mosaic.dm[crop.cols + 1]!, 1010)
  assert.equal(empty, 4 * (4 * 3 - 2 * 3 + 2 * 2))
})

test("the chain fills a crop's empty cells without taking an out cell or meeting one", () => {
  const needs = [at(0, 0, 3, 3)]
  const { mosaic } = tileCrop(needs, [held(at(0, 0, 3, 1), () => 500)])
  // Mark one empty column out, as a cell past the region's box.
  for (let r = 0; r < mosaic.rows; r++) {
    mosaic.dm[r * mosaic.cols + 5] = 0
    mosaic.src[r * mosaic.cols + 5] = OUT
  }
  const report = fillStep(mosaic, { source: 2, at: () => 400 })
  assert.equal(report.cells, 2 * 4 * 2 + 4 * 1)
  for (let r = 0; r < mosaic.rows; r++) assert.equal(mosaic.src[r * mosaic.cols + 5], OUT)
  // Bent onto the held row, never onto the out column's 0.
  for (let k = 0; k < mosaic.dm.length; k++)
    if (mosaic.src[k] === 2) assert.ok(mosaic.dm[k]! > 450, `cell ${k}: ${mosaic.dm[k]}`)
})

test("writeTiles keeps the cells a file holds and adds the means of those it needs", () => {
  const g = tileGrid(0, 0)
  const need = at((g.e0 - LATTICE.e) / CELL, (g.n0 - LATTICE.n) / CELL, 2, 2)
  const file = held(g, (c, r) => (c === 0 && r === 0 ? 777 : Number.NaN), 0)
  const { mosaic, block } = tileCrop([need], [file])
  for (let k = 0; k < mosaic.dm.length; k++)
    if (Number.isNaN(mosaic.dm[k]!)) {
      mosaic.dm[k] = 100 + (k % 2)
      mosaic.src[k] = 2
    }
  const out = new Map<string, Buffer>()
  writeTiles(
    "dtm",
    [{ i: 0, j: 0, need }],
    new Map([["0_0", file]]),
    block,
    mosaic,
    ["test"],
    (path, bytes) => out.set(path, bytes),
  )
  const t = decodeTile(out.get("dtm/0_0.bin")!, "0_0")
  assert.deepEqual([t.dm[0], t.codes[0]], [777, 0])
  // The mean of 100, 101, 100, 101 rounds to 101 (Math.round of 100.5).
  assert.deepEqual([t.dm[1], t.codes[1]], [101, 2])
  assert.deepEqual([t.dm[g.cols], t.codes[g.cols]], [101, 2])
  assert.equal(t.codes[2], NONE)
  assert.equal(t.codes.filter((c) => c !== NONE).length, 4)
})
