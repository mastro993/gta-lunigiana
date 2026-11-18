import assert from "node:assert/strict"
import { test } from "node:test"

import { builtTestMaps } from "../../../tools/__tests__/test-maps.ts"
import { type JoinedMap, readWholeMap, wholeMap } from "../../../tools/map-file.ts"
import { pointInRing, segDist2, staticGrid } from "../../collide.ts"
import { OLIVE_TREES } from "../index.ts"

// Map checks (pnpm test:map): every olive of every built map; src/tools/__tests__/trees.test.ts
// checks the scatter's rules.

/**
 * How far past its grove's outline an olive may stand, m: the scatter reads a point's 2 m mask
 * pixel, whose centre lies in the grove (the point √2 m off it at most), then rounds the point to
 * the metre (√0.5 m more).
 */
const REACH = Math.SQRT2 + Math.SQRT1_2

/** Each olive of `map` standing farther than REACH from every olive grove, as "x,y"; and how many olives it holds. */
const astray = (map: JoinedMap): { readonly olives: number; readonly astray: Array<string> } => {
  const groves = map.areas.filter((a) => a.kind === "olive")
  const boxes = groves.map(({ rings }) => {
    const xs = rings[0]!.filter((_, k) => k % 2 === 0),
      ys = rings[0]!.filter((_, k) => k % 2 === 1)
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const
  })
  const grid = staticGrid(groves.length, (k) => boxes[k]!, 64)
  /** Whether (x, y) lies in grove `k` (not in a hole) or within REACH of its outline. */
  const near = (k: number, x: number, y: number) => {
    const [outer, ...holes] = groves[k]!.rings
    if (pointInRing(x, y, outer!) && !holes.some((h) => pointInRing(x, y, h))) return true
    return groves[k]!.rings.some((ring) => {
      const n = ring.length / 2
      for (let i = 0, j = n - 1; i < n; j = i++)
        if (
          segDist2(x, y, ring[2 * j]!, ring[2 * j + 1]!, ring[2 * i]!, ring[2 * i + 1]!).d2 <=
          REACH * REACH
        )
          return true
      return false
    })
  }
  let olives = 0
  const out: Array<string> = []
  for (let k = 0; k < map.treeIds.length; k++) {
    if (map.treeIds[k]! < OLIVE_TREES) continue
    olives++
    const x = map.trees[3 * k]!,
      y = map.trees[3 * k + 1]!
    let found = false
    grid(x - REACH, y - REACH, x + REACH, y + REACH, (g) => {
      found ||= near(g, x, y)
    })
    if (!found) out.push(`${x},${y}`)
  }
  return { olives, astray: out }
}

test("olive groves: Lunigiana's grow olives, and every olive of Lunigiana, Cesena, the L and the coast stands in one", (t) => {
  // The test regions are built into test-maps/ by `pnpm maps`; CI, which sets CI=true, always builds them.
  const maps: ReadonlyArray<readonly [string, JoinedMap]> = [
    ["Lunigiana", wholeMap()],
    ["Cesena", wholeMap("cesena")],
    ...builtTestMaps(t).map(([name, url]) => [name, readWholeMap(url)] as const),
  ]
  for (const [name, map] of maps) {
    const { olives, astray: off } = astray(map)
    if (name !== "Cesena") assert.ok(olives > 10_000, `${name}: ${olives} olives`)
    assert.deepEqual(
      off.slice(0, 10),
      [],
      `${name}: ${off.length} of ${olives} olives out of the groves`,
    )
  }
})
