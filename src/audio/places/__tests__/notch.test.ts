// The owls on Lunigiana with its north-east tiles unlisted and an L outline (`notchMap`): none
// perches on an unlisted tile.
import assert from "node:assert/strict"
import { test } from "node:test"

import { AROUND, notchMap } from "../../../sim/map/__tests__/edit-map.ts"
import { MAP_URL, readMapFile } from "../../../sim/map/packed.ts"

notchMap()
const { MAP } = await import("../../../sim/map/index.ts")
const tiles = await import("../../../sim/map/tiles.ts")
const { owlsNear } = await import("../animals.ts")

test("an L: owls perch only on listed tiles, none in the notch's borrowed woods", () => {
  for (const key of AROUND)
    if (!tiles.isResident(key))
      tiles.provideTile(readMapFile(new URL(`${MAP.name}/${key}.bin`, MAP_URL)))
  const owls = owlsNear(3400, 1950, 2500)
  assert.ok(owls.length > 10, `${owls.length} owls`)
  for (const owl of owls)
    assert.ok(
      tiles.isListed(Math.floor(owl.x / 2000), Math.floor(owl.y / 2000)),
      `${owl.key} at ${owl.x.toFixed(0)}, ${owl.y.toFixed(0)}`,
    )
})
