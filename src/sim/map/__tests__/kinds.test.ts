import assert from "node:assert/strict"
import { test } from "node:test"

import { tileKey, tilesRound } from "../kinds.ts"

/** An L of tiles: i −2…1 by j 0…1 less its notch, tiles (0, 1) and (1, 1). */
const L = new Set(["-2_0", "-1_0", "0_0", "1_0", "-2_1", "-1_1"])
const inL = (i: number, j: number) => L.has(tileKey(i, j))

test("tilesRound: the listed tiles of the nearest ring round an unlisted tile holding any, in key order", () => {
  const keys = (i: number, j: number) => tilesRound(i, j, inL).map(([ti, tj]) => tileKey(ti, tj))
  assert.deepEqual(keys(0, 1), ["-1_0", "0_0", "1_0", "-1_1"])
  assert.deepEqual(keys(1, 1), ["0_0", "1_0"])
  // the first two rings round (3, 3) hold none
  assert.deepEqual(keys(3, 3), ["0_0", "1_0"])
  assert.throws(() => tilesRound(0, 0, () => false), /no listed tile/)
})
