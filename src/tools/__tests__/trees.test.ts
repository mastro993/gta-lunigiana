import assert from "node:assert/strict"
import { test } from "node:test"

import { TILE } from "../../sim/map/kinds.ts"
import { BOUNDS } from "../geometry.ts"
import { scatterTrees } from "../trees.ts"

test("scatterTrees plants the banks of a river through every row of tiles, making each row's masks once", () => {
  // A 6 m stream up the whole map at x = 100, a wood west of it, and nothing else: the bank trees
  // stand in every row of tiles the lattice lets go of before it ends.
  const forest = [-300, -1000, 0, -1000, 0, 1000, -300, 1000]
  const trees = scatterTrees(
    [{ kind: "forest", rings: [forest] }],
    [],
    [],
    [
      {
        id: 1,
        kind: "stream",
        w: 6,
        bed: 4,
        depth: 1,
        pts: [
          { x: 100, y: BOUNDS.minY + 50 },
          { x: 100, y: BOUNDS.maxY - 50 },
        ],
      },
    ],
    [],
  )
  const banks = new Set<number>(),
    wood: Array<number> = []
  for (let k = 0; k < trees.length; k += 3) {
    const [x, y] = [trees[k]!, trees[k + 1]!]
    if (Math.abs(x - 100) <= 4 + 2 + 3 + 1) banks.add(Math.floor(y / TILE))
    else wood.push(x)
  }
  const rows = Math.floor((BOUNDS.maxY - 50) / TILE) - Math.floor((BOUNDS.minY + 50) / TILE) + 1
  assert.equal(banks.size, rows)
  assert.ok(wood.length > 0 && wood.every((x) => x >= -300 && x <= 0))
})
