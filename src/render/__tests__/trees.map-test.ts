import assert from "node:assert/strict"
import { test } from "node:test"

import { coverAt } from "../../sim/map/cover.ts"
import { heightAt, isWood, MAP } from "../../sim/map/index.ts"
import { tileTrees } from "../../sim/map/tiles.ts"
import { kindAt } from "../trees.ts"
import { assertChunkTrees } from "./chunk-trees.ts"

// Map checks (pnpm test:map): every tile's trees and every chunk; trees.test.ts checks a few tiles.
const KEYS = MAP.tiles.map(({ i, j }) => `${i}_${j}`)

test("trees: each tile's ids ascend, and no two trees of the map share one (a look's seed)", () => {
  for (const key of KEYS) {
    const { ids } = tileTrees(key)
    assert.ok(
      ids.every((id, k) => k === 0 || id > ids[k - 1]!),
      `${key}: ids in the whole map's order`,
    )
  }
  const ids = KEYS.flatMap((key) => Array.from(tileTrees(key).ids))
  assert.equal(new Set(ids).size, ids.length)
})

test("trees: each chunk's from the tiles it reads are the whole map's bucket for it, apron mirrors and order included", () => {
  const { checked, mirrored } = assertChunkTrees(KEYS)
  assert.ok(checked > 1000, `${checked} chunks hold trees`)
  assert.ok(mirrored > 100, `${mirrored} apron chunks hold mirrored trees`)
})

/**
 * The forest inventory's beech share of the forest per band of height, [from, to) m and % (issue
 * #14: Regione Toscana's IFT over the 14 Lunigiana comuni; 0–1% at 400–800 m).
 */
const IFT_BEECH = [
  [0, 200, 0],
  [200, 400, 0],
  [400, 800, 0.5],
  [800, 1000, 16],
  [1000, 1200, 55],
  [1200, 1400, 89],
  [1400, 1600, 100],
] as const

test("trees: the beech's share of the woods' trees in each band of height is within 10 points of the forest inventory's", () => {
  const bands = IFT_BEECH.map(() => ({ all: 0, beech: 0 }))
  for (const key of KEYS) {
    const { trees, ids } = tileTrees(key)
    for (let k = 0; k < ids.length; k++) {
      const x = trees[3 * k]!,
        y = trees[3 * k + 1]!
      // A bank tree out of the woods counts in no band.
      if (!isWood(coverAt(x, y))) continue
      const z = heightAt(x, y),
        band = bands[IFT_BEECH.findIndex(([from, to]) => z >= from && z < to)]
      if (band === undefined) continue
      band.all++
      if (kindAt(x, y, 3 * ids[k]!) === "beech") band.beech++
    }
  }
  IFT_BEECH.forEach(([from, to, share], b) => {
    const { all, beech } = bands[b]!
    assert.ok(all > 1000, `${from}–${to} m: ${all} trees`)
    const got = (100 * beech) / all
    assert.ok(
      Math.abs(got - share) <= 10,
      `${from}–${to} m: ${got.toFixed(1)}% beech, the IFT ${share}%`,
    )
  })
})
