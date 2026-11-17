import assert from "node:assert/strict"
import { test } from "node:test"

import { useDiskMap } from "../../sim/map/source.ts"
import { skipUnbuilt, TEST_MAPS } from "../../tools/__tests__/test-maps.ts"

// Map check (pnpm test:map), on the coast test region (`magra-coast`): this process loads it from
// test-maps/ (`pnpm maps` builds it); without the build the check is skipped, but in CI, which
// builds it, a missing build fails.
const [NAME, URL_COAST] = TEST_MAPS.find(([name]) => name === "the coast")!
const skip = skipUnbuilt(NAME, URL_COAST)
if (skip === false) useDiskMap(URL_COAST)
const kit =
  skip === false
    ? {
        ...(await import("./face-colours.ts")),
        ...(await import("../chunks.ts")),
        ...(await import("../ground.ts")),
        ...(await import("../terrain.ts")),
        ...(await import("../testing.ts")),
        ...(await import("../../sim/map/cover.ts")),
        ...(await import("../../sim/map/index.ts")),
      }
    : undefined

/** Marinella di Sarzana's beach, between its groynes. */
const MARINELLA = { x: -9330, y: -12745 }

test(
  "terrainChunk, magra-coast: every face round Marinella's beach is in its cell's look, the sand wet only where its middle lies under the waterline's 0.2 m",
  { skip },
  () => {
    const k = kit!
    k.residentAround([MARINELLA], 200)
    const keys = new Set(
      [-48, 0, 48].flatMap((dx) =>
        [-48, 0, 48].map((dy) => k.chunkOf(MARINELLA.x + dx, MARINELLA.y + dy)),
      ),
    )
    const { faces, beach, wet, wrong } = k.faceColours(keys)
    assert.ok(beach > 500 && wet > 0 && wet < beach / 4, `${wet} of ${beach} faces of sand wet`)
    assert.equal(wrong, 0, `${wrong} of ${faces} faces in another colour than their cell's`)
  },
)

test(
  "the beaches, magra-coast: the sand is wet along the waterline alone (the orthophoto's wet band, about 6 m wide), under a tenth of its cells, their inner edge a median two cells or less from the sea",
  { skip },
  () => {
    const k = kit!
    const hm = k.MAP.heightmap,
      { minX, minY, maxX, maxY } = k.MAP.bounds
    k.residentAround(
      [{ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }],
      Math.hypot(maxX - minX, maxY - minY),
    )
    const below = k.COVER_LOOK.sand.wet.below,
      i0 = Math.floor((minX - hm.x0) / hm.cell),
      j0 = Math.floor((minY - hm.y0) / hm.cell),
      i1 = Math.floor((maxX - hm.x0) / hm.cell),
      j1 = Math.floor((maxY - hm.y0) / hm.cell)
    const coverOf = (i: number, j: number) =>
      k.coverAt(hm.x0 + (i + 0.5) * hm.cell, hm.y0 + (j + 0.5) * hm.cell)
    // Each sand cell's middle height as the terrain shades it.
    const sand = new Map<number, number>()
    for (let j = j0; j < j1; j++)
      for (let i = i0; i < i1; i++)
        if (coverOf(i, j) === "sand")
          sand.set(
            j * hm.cols + i,
            k.cellSlope(
              k.terrainNodeY(i, j),
              k.terrainNodeY(i + 1, j),
              k.terrainNodeY(i, j + 1),
              k.terrainNodeY(i + 1, j + 1),
            ).z,
          )
    /** How far (m) the nearest sea cell lies from cell (i, j)'s, within 25 cells. */
    const toSea = (i: number, j: number) => {
      let best = Number.POSITIVE_INFINITY
      for (let r = 1; r <= 25 && best > (r - 1) * hm.cell; r++)
        for (let dj = -r; dj <= r; dj++)
          for (let di = -r; di <= r; di++)
            if (Math.max(Math.abs(di), Math.abs(dj)) === r && coverOf(i + di, j + dj) === "sea")
              best = Math.min(best, Math.hypot(di, dj) * hm.cell)
      return best
    }
    let wet = 0
    const edge: Array<number> = []
    for (const [key, z] of sand) {
      if (z >= below) continue
      wet++
      const i = key % hm.cols,
        j = Math.floor(key / hm.cols)
      // The wet band's inner edge: a wet cell beside a dry one of the beach.
      if (
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([di, dj]) => (sand.get((j + dj!) * hm.cols + i + di!) ?? -1) >= below)
      )
        edge.push(toSea(i, j))
    }
    edge.sort((a, b) => a - b)
    const median = edge[edge.length >> 1]!
    assert.ok(sand.size > 10_000, `${sand.size} cells of sand`)
    assert.ok(wet < sand.size / 10, `${wet} of ${sand.size} sand cells wet`)
    assert.ok(
      edge.length > 100 && median <= 2 * hm.cell,
      `the wet band's inner edge (${edge.length} cells) a median ${median.toFixed(1)} m from the sea`,
    )
  },
)
