import assert from "node:assert/strict"
import { test } from "node:test"

import type { Road } from "../../sim/map/index.ts"
import { laneOffset } from "../../sim/map/kinds.ts"
import { roadLines } from "../lines.ts"

const road = (cls: string, w: number, oneway = false): Road => ({
  id: 1,
  cls,
  w,
  surface: "asphalt",
  ...(oneway ? { oneway } : {}),
  pts: [0, 0, 100, 0],
  z: [0, 0],
})

test("roadLines: a two-way main road's dashed centre line; a oneway carriageway's lanes laid from its right edge, a motorway's shoulder solid", () => {
  assert.deepEqual(roadLines(road("primary", 7)), [{ right: 0, dashed: true }])
  assert.deepEqual(roadLines(road("trunk", 7, true)), [{ right: 0, dashed: true }])
  assert.deepEqual(roadLines(road("primary", 6.5, true)), [])
  assert.deepEqual(roadLines(road("residential", 5)), [])
  // A two-lane motorway carriageway, 10 m: the shoulder's line 2 m right of the centreline, the
  // lanes' 1.5 m left of it, and traffic driving between them.
  const motorway = road("motorway", 10, true)
  assert.deepEqual(roadLines(motorway), [
    { right: 2, dashed: false },
    { right: -1.5, dashed: true },
  ])
  const side = laneOffset(motorway)
  assert.ok(side > -1.5 && side < 2, `the lane at ${side} m`)
})
