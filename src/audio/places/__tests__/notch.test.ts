// The owls on Lunigiana with its north-east tiles unlisted and an L outline (`notchMap`): none
// perches on an unlisted tile.
import "../../../sim/map/__tests__/use-notch.ts"
import assert from "node:assert/strict"
import { test } from "node:test"

import { AROUND } from "../../../sim/map/__tests__/edit-map.ts"
import { tileFromDisk } from "../../../sim/map/source.ts"
import * as tiles from "../../../sim/map/tiles.ts"
import { owlsNear } from "../animals.ts"

test("an L: owls perch only on listed tiles, none in the notch's borrowed woods", () => {
  for (const key of AROUND) if (!tiles.isResident(key)) tiles.provideTile(tileFromDisk(key))
  const owls = owlsNear(3400, 1950, 2500)
  assert.ok(owls.length > 10, `${owls.length} owls`)
  for (const owl of owls)
    assert.ok(
      tiles.isListed(Math.floor(owl.x / 2000), Math.floor(owl.y / 2000)),
      `${owl.key} at ${owl.x.toFixed(0)}, ${owl.y.toFixed(0)}`,
    )
})
