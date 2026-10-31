// The render's chunk plan on Lunigiana with its north-east tiles unlisted and an L outline
// (`notchMap`): every chunk planned once, the notch's on the listed tiles round it.
import assert from "node:assert/strict"
import { test } from "node:test"

import { AROUND, notchMap } from "../../sim/map/__tests__/edit-map.ts"

notchMap()
const { MAP } = await import("../../sim/map/index.ts")
const { chunkTiles } = await import("../chunk-tiles.ts")
const { CHUNKS, chunkRect, exactBox } = await import("../chunks.ts")
const { bucketTileTrees } = await import("../trees.ts")

test("an L: the render plans every chunk once, the notch's on the listed tiles round it, its box round the exact one", () => {
  const { maxX, maxY } = MAP.bounds
  const count = CHUNKS.x * CHUNKS.y
  const plan = chunkTiles(
    [],
    Array.from({ length: count }, () => []),
  )
  assert.deepEqual(
    plan.keys,
    MAP.tiles.map(({ i, j }) => `${i}_${j}`),
  )
  assert.equal(new Set(plan.owned.flat()).size, count)
  assert.equal(plan.owned.flat().length, count)
  const exact = new Float32Array(count * 6)
  let notch = 0
  for (let key = 0; key < count; key++) {
    assert.ok(plan.terrain[key]!.length > 0, `chunk ${key}`)
    const { minX: x0, minY: y0, maxX: x1, maxY: y1 } = chunkRect(key)
    if (x0 < 2000 + 50 || y0 < 50 || x1 > maxX || y1 > maxY) continue
    notch++
    const read = plan.terrain[key]!.map((t) => plan.keys[t]!)
    assert.ok(
      read.every((k) => AROUND.includes(k)),
      `chunk ${key} reads ${read.join(" ")}`,
    )
    if (notch % 37 !== 0) continue
    exactBox(exact, key)
    assert.ok(plan.boxes[key * 6 + 4]! <= exact[key * 6 + 4]!, `chunk ${key}'s low`)
    assert.ok(plan.boxes[key * 6 + 5]! >= exact[key * 6 + 5]!, `chunk ${key}'s high`)
  }
  assert.ok(notch > 400, `${notch} chunks in the notch`)
  // the trees of the tiles round the notch, mirrored past the bounds' edges, fall in chunks of the grid
  for (const key of AROUND)
    for (const chunk of bucketTileTrees(key).keys()) assert.ok(chunk >= 0 && chunk < count, key)
})
