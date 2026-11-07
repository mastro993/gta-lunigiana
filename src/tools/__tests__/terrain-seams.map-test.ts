// The terrain's source seams (issue #10), on the build's own 4 m grid (`dtmDem`, the nodes the
// heightmap starts from) of each terrain fetch-rt's chain wrote, over the nodes its listed tiles
// hold: Lunigiana's, where the 10 m DTM fills three patches of lucido, Carrara's ground past
// Fosdinovo's LiDAR (its edge as far as 130 m into Luni) and, with the 2021 surface model,
// Fivizzano's past its own, Liguria's DTM ed. 2023 Castelnuovo Magra's and Luni's past both (issue
// #18), and Emilia-Romagna's DTM 5x5 its strip along the Emilian border; the Bagnone ridge test region's, where the LiDAR stops 1–2 km below
// the crest and the 2021 surface model, the 10 m DTM and Emilia-Romagna's DTM 5x5 fill the rest;
// and the Sarzana test region's, where Liguria's DTM ed. 2023 meets a corner of LiDAR (issue #12).
// A map test: it walks every node of each.
import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"

import { loadDtm } from "../dtm.ts"
import { listedNodes } from "../grid-tiles.ts"
import { dtmDir, regionFromArgs } from "../region.ts"
import { gridLattice } from "../terrain.ts"
import { seamSteps } from "./seam-steps.ts"

const ROOT = join(import.meta.dirname, "../../..")

/** The source of a node no listed tile holds (an L's notch). */
const UNLISTED = "unlisted"

/**
 * A region's terrain on its whole 4 m grid: heights and each node's source, UNLISTED where no
 * listed tile holds it: the build reads no terrain there, and the DTM draws its edge on into it.
 */
const terrainOf = (key: string) => {
  const region = regionFromArgs(["--region", key])
  const dem = loadDtm(join(ROOT, dtmDir(region)), region)
  const g = gridLattice(region)
  const z = dem.grid({ i0: 0, j0: 0, cols: g.cols, rows: g.rows }).z
  const listed = listedNodes(g, region.tiles)
  const src: Array<string> = []
  for (let j = 0; j < g.rows; j++)
    for (let i = 0; i < g.cols; i++)
      src.push(
        listed[j * g.cols + i] === 1 ? dem.source!(g.x0 + i * g.cell, g.y0 + j * g.cell) : UNLISTED,
      )
  return { g, z, src }
}

/** How far round a scarp's place its seams are its own, m: two nodes. */
const SCARP_REACH = 8

/**
 * Seams where the real ground steps and the check cannot see it, by region: the LiDAR's step at
 * its last node has no LiDAR node past it to bound it, so it never counts among the terrain's own
 * steps round a seam. Under Fivizzano's ridge the 2010 flight's strip ends at the foot of a rock
 * band, which its last metres climb: the 2021 orthophoto (`pnpm ortho 9770,10410,9850,10480
 * rt_ofc.5k21.32bit --px 0.2`) shows its grey rock and boulders, its west face in shadow, and the
 * 2021 surface model climbs 7–8 m over 3 m along it, as the LiDAR's last cells do where they reach
 * it; the 10 m DTM past the strip has no band. A seam within SCARP_REACH of one may step as far as
 * the band's own face (the steepest climb between two LiDAR nodes there), no further.
 */
const SCARPS: Readonly<
  Record<string, ReadonlyArray<{ readonly pair: string; readonly x: number; readonly y: number }>>
> = { lunigiana: [{ pair: "dtm10-lidar", x: 9808, y: 10444 }] }

for (const [key, pairs] of [
  [
    "lunigiana",
    [
      "dsm2021-dtm10",
      "dsm2021-lidar",
      "dtm10-lidar",
      "dtm10-lig",
      "dtm10-rer",
      "lidar-lig",
      "lidar-rer",
    ],
  ],
  ["bagnone-ridge", ["dsm2021-dtm10", "dsm2021-lidar", "dtm10-lidar", "dtm10-rer"]],
  ["sarzana-town", ["lidar-lig"]],
] as const)
  test(`${key}: no seam between terrain sources steps over 1 m more than the terrain round it`, () => {
    const { g, z, src } = terrainOf(key)
    const all = seamSteps(g.cols, g.rows, z, src).filter((s) => !s.pair.includes(UNLISTED))
    assert.deepEqual([...new Set(all.map((s) => s.pair))].sort(), pairs)
    /** Whether node k lies within SCARP_REACH of (x, y). */
    const near = (k: number, x: number, y: number) =>
      Math.hypot(g.x0 + (k % g.cols) * g.cell - x, g.y0 + Math.floor(k / g.cols) * g.cell - y) <=
      SCARP_REACH
    const excused = new Set<(typeof all)[number]>()
    for (const { pair, x, y } of SCARPS[key] ?? []) {
      const own = all.filter((s) => s.pair === pair && near(s.at, x, y))
      assert.ok(
        own.length > 0,
        `no ${pair} seam within ${SCARP_REACH} m of the scarp at (${x}, ${y})`,
      )
      let face = 0
      for (let k = 0; k < z.length; k++)
        for (const q of [k + 1, k + g.cols])
          if (src[k] === "lidar" && src[q] === "lidar" && near(k, x, y) && near(q, x, y))
            face = Math.max(face, Math.abs(z[q]! - z[k]!))
      for (const s of own) {
        assert.ok(
          s.step <= face,
          `${pair} by the scarp at (${x}, ${y}): a step of ${s.step.toFixed(2)} m, past its face's ${face.toFixed(2)} m`,
        )
        excused.add(s)
      }
    }
    const seams = all.filter((s) => !excused.has(s))
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
