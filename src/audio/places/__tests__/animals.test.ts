import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../../sim/map/index.ts"
import { anchorOf } from "../../../sim/map/kinds.ts"
import { residentAround } from "../../testing.ts"
import { owlsNear } from "../animals.ts"

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }

// Regression: the squares counted from the box's south-west corner, so when Fivizzano grew it 2400 m west (not a whole number of
// 500 m squares) every owl of lucido moved to another tree.
test("owls: the 500 m squares count from the region's anchor, never the box's corner, so a part that grows the box moves no owl", () => {
  const { x: ax, y: ay } = anchorOf(MAP.heightmap)
  residentAround([STATION], 1500)
  const owls = owlsNear(STATION.x, STATION.y, 1000)
  assert.ok(owls.length > 5, `${owls.length} owls`)
  for (const owl of owls) {
    const [i, j] = owl.key.slice("owl:".length).split(",").map(Number)
    assert.deepEqual(
      [Math.floor((owl.x - ax) / 500), Math.floor((owl.y - ay) / 500)],
      [i, j],
      `${owl.key} at ${owl.x.toFixed(1)}, ${owl.y.toFixed(1)}: in its square from the anchor (${ax}, ${ay})`,
    )
  }
})
