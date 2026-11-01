// The terrain's source seams (issue #10), on the build's own 4 m grid (`dtmDem`, the nodes the
// heightmap starts from) of each terrain fetch-rt's chain wrote: lucido's, where the 10 m DTM fills
// three patches, and the Bagnone ridge test region's, where the LiDAR stops 1–2 km below the crest
// and the 2021 surface model, the 10 m DTM and Emilia-Romagna's DTM 5x5 fill the rest. A map test:
// it walks every node of both.
import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"

import { loadDtm } from "../dtm.ts"
import { dtmDir, regionFromArgs } from "../region.ts"
import { gridLattice } from "../terrain.ts"
import { seamSteps } from "./seam-steps.ts"

const ROOT = join(import.meta.dirname, "../../..")

/** A region's terrain on its whole 4 m grid: heights and each node's source. */
const terrainOf = (key: string) => {
  const region = regionFromArgs(["--region", key])
  const dem = loadDtm(join(ROOT, dtmDir(region)), region)
  const g = gridLattice(region)
  const z = dem.grid({ i0: 0, j0: 0, cols: g.cols, rows: g.rows }).z
  const src: Array<string> = []
  for (let j = 0; j < g.rows; j++)
    for (let i = 0; i < g.cols; i++) src.push(dem.source!(g.x0 + i * g.cell, g.y0 + j * g.cell))
  return { g, z, src }
}

for (const [key, pairs] of [
  ["lunigiana", ["dsm2021-dtm10", "dsm2021-lidar", "dtm10-lidar"]],
  ["bagnone-ridge", ["dsm2021-dtm10", "dsm2021-lidar", "dtm10-lidar", "dtm10-rer"]],
] as const)
  test(`${key}: no seam between terrain sources steps over 1 m more than the terrain round it`, () => {
    const { g, z, src } = terrainOf(key)
    const seams = seamSteps(g.cols, g.rows, z, src)
    assert.deepEqual([...new Set(seams.map((s) => s.pair))].sort(), pairs)
    const worst = seams.reduce((a, b) => (b.excess > a.excess ? b : a))
    const x = g.x0 + (worst.at % g.cols) * g.cell,
      y = g.y0 + Math.floor(worst.at / g.cols) * g.cell
    assert.ok(
      worst.excess <= 1,
      `${worst.pair} at (${x}, ${y}): a step of ${worst.step.toFixed(2)} m, ${worst.excess.toFixed(2)} m more than the terrain's own within 20 m`,
    )
  })

test("bagnone-ridge: Monte Sillara's summit is within 5 m of its 1861 m", () => {
  const { g, z } = terrainOf("bagnone-ridge")
  // The highest node within 100 m of the summit (#22's place for it, on OSM's peak): the bent 10 m
  // DTM's, as the canopy filter clears the bare rock round it, whose surface model stands metres
  // over the survey (docs/map.md, "Sources").
  let top = -Infinity
  for (let j = 0; j < g.rows; j++)
    for (let i = 0; i < g.cols; i++)
      if (Math.hypot(g.x0 + i * g.cell + 5336, g.y0 + j * g.cell - 22825) <= 100)
        top = Math.max(top, z[j * g.cols + i]!)
  assert.ok(Math.abs(top - 1861) <= 5, `the summit at ${top.toFixed(1)} m`)
})
