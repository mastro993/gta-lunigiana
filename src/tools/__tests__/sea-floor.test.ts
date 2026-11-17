import assert from "node:assert/strict"
import { test } from "node:test"

import { coastIndex } from "../coast.ts"
import { seaFloor } from "../sea-floor.ts"

test("the sea's floor falls 8 % from the coastline to 0.6 m, then follows the shelf off Marinella (1 m at 450 m, 8 m at 1.1 km, 13 m at 2.2 km, 17 m at 7.8 km and on), whichever is deeper", () => {
  // A straight coastline running east along y = 0, the land on its left: the sea south of it.
  const floor = seaFloor(
    coastIndex([
      {
        pts: [
          [-20000, 0],
          [20000, 0],
        ],
        closed: false,
      },
    ]),
  )
  for (const [d, depth] of [
    [0, 0],
    [5, 0.4], // the beach's face
    [7.5, 0.6],
    [100, 0.6], // the face's foot, over the shelf's 0.22 m
    [270, 0.6], // where the shelf reaches it
    [450, 1],
    [775, 4.5],
    [1100, 8],
    [2200, 13],
    [5000, 15],
    [7800, 17],
    [9000, 17],
  ] as const) {
    const z = floor(1234, -d)
    assert.ok(Math.abs(z + depth) < 1e-9, `${d} m out: ${z}, want ${-depth}`)
  }
  // An islet's shore is coast too: 5 m off a rock 1 km out the floor rises to its face.
  const islet = seaFloor(
    coastIndex([
      {
        pts: [
          [-20000, 0],
          [20000, 0],
        ],
        closed: false,
      },
      {
        pts: [
          [0, -1000],
          [10, -1000],
          [10, -990],
          [0, -990],
          [0, -1000],
        ],
        closed: true,
      },
    ]),
  )
  assert.ok(Math.abs(islet(5, -1005) + 0.4) < 1e-9)
})
