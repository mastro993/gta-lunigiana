// The terrain chain's sea step (sea-fill.ts) on a crop round the local origin: a coastline along
// y = 0 with the sea south of it, land at 5 m north of an empty shore 30 m wide, an empty corridor
// running inland from the shore and an empty pocket the shore never reaches.
import assert from "node:assert/strict"
import { test } from "node:test"

import type { CoastLine } from "../coast.ts"
import { gaussBoagaToLatLon } from "../crs.ts"
import { cropOf } from "../dtm-mosaic.ts"
import { fillStep, NONE } from "../fill-chain.ts"
import { toLocal } from "../geometry.ts"
import { SEA_REACH, seaFiller } from "../sea-fill.ts"
import { codeOf } from "../terrain-sources.ts"

const crop = cropOf([[-100, -100, 100, 300]])
/** Each crop cell's centre in local metres. */
const local = Array.from({ length: crop.cols * crop.rows }, (_, k) =>
  toLocal(...gaussBoagaToLatLon(crop.e0 + (k % crop.cols), crop.n0 + Math.floor(k / crop.cols))),
)
/** The crop cell nearest local (x, y). */
const cellAt = (x: number, y: number) => {
  let best = -1,
    d = Infinity
  local.forEach(([u, v], k) => {
    const e = Math.hypot(u - x, v - y)
    if (e < d) [best, d] = [k, e]
  })
  return best
}
const east: CoastLine = {
  pts: [
    [-1000, 0],
    [1000, 0],
  ],
  closed: false,
}

/** The crop's heights: land at 5 m north of y = 30, but a corridor |x| < 10 and a pocket round (60, 70) left empty. */
const mosaic = () => {
  const dm = new Float32Array(crop.cols * crop.rows).fill(Number.NaN),
    src = new Uint8Array(crop.cols * crop.rows).fill(NONE)
  local.forEach(([x, y], k) => {
    const corridor = Math.abs(x) < 10,
      pocket = Math.abs(x - 60) < 10 && Math.abs(y - 70) < 10
    if (y > 30 && !corridor && !pocket) {
      dm[k] = 50
      src[k] = codeOf("lig")
    }
  })
  return { cols: crop.cols, rows: crop.rows, dm, src }
}

test("the sea fills its own cells and the empty shore it reaches through empty cells, never a pocket inland", () => {
  const m = mosaic()
  const sea = seaFiller([east], crop, m.dm)!
  assert.equal(sea.source, codeOf("sea"))
  const where = (x: number, y: number) => sea.where!(cellAt(x, y))
  assert.ok(where(50, -60), "the sea")
  assert.ok(where(-50, 15), "the empty shore")
  assert.ok(!where(-50, 60), "the land")
  assert.ok(!where(60, 70), "the pocket")
  // Up the corridor as far as SEA_REACH from the shore's sea edge, and no farther.
  assert.ok(where(0, SEA_REACH - 10), "the corridor near the shore")
  assert.ok(!where(0, SEA_REACH + 10), "the corridor past the reach")
})

test("the sea is bent onto the land at the shore and falls toward 0 m out to sea", () => {
  const m = mosaic()
  const report = fillStep(m, seaFiller([east], crop, m.dm)!)
  assert.ok(report.cells > 0 && report.rim > 0)
  const at = (x: number, y: number) => m.dm[cellAt(x, y)]! / 10
  const heights = [29, 0, -40, -80, -120].map((y) => at(-50, y))
  assert.ok(heights[0]! > 3.5, `the shore by the land at 5 m: ${heights[0]} m`)
  for (let k = 1; k < heights.length; k++) assert.ok(heights[k]! < heights[k - 1]!, `${heights}`)
  assert.ok(heights.at(-1)! < 1, `150 m from the land: ${heights.at(-1)} m`)
  assert.ok(Number.isNaN(at(60, 70)), "the pocket stays empty")
})

test("a crop wholly on the land's side of the coastline has no sea step", () => {
  const far: CoastLine = {
    pts: [
      [-1000, -5000],
      [1000, -5000],
    ],
    closed: false,
  }
  assert.equal(seaFiller([far], crop, mosaic().dm), undefined)
})
