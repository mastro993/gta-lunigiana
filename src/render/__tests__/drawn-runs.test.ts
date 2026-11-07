import assert from "node:assert/strict"
import { test } from "node:test"

import { RAIL_LIFT } from "../../sim/map/index.ts"
import { DRAWN_RUN, makeLine } from "../../sim/rail/lines.ts"
import { drawnRun } from "../drawn-runs.ts"

test("drawnRun: the track past a terminal as its trains ride it, over the drawn run, walked away from it in stretches of one level, at the bed under the rail head", () => {
  // East along y 0, its rail head at 10.2 m; past x 1000 its run-out runs 100 m on, then bridges 141.4 m north-east.
  const line = makeLine(
    0,
    [{ pts: [0, 0, 1000, 0], z: [10.2, 10.2] }],
    [],
    [],
    [
      [],
      [
        { pts: [1000, 0, 1100, 0], z: [10.2, 11.2] },
        { pts: [1100, 0, 1200, 100], z: [11.2, 12.2], bridge: true },
      ],
    ],
  )
  const rounded = (values: ReadonlyArray<number>) => values.map((v) => +v.toFixed(6))
  const [ground, bridge, ...more] = drawnRun(line, 1)
  assert.deepEqual(more, [])
  assert.deepEqual(
    [ground!.pts, rounded(ground!.z), ground!.bridge],
    [[1000, 0, 1100, 0], rounded([10.2 - RAIL_LIFT, 11.2 - RAIL_LIFT]), undefined],
  )
  const across = (DRAWN_RUN - 100) / Math.SQRT2
  assert.deepEqual(rounded(bridge!.pts), rounded([1100, 0, 1100 + across, across]))
  assert.equal(bridge!.bridge, true)
  assert.ok(
    Math.abs(bridge!.z.at(-1)! - (11.2 + (DRAWN_RUN - 100) / (100 * Math.SQRT2) - RAIL_LIFT)) <
      1e-9,
  )
  // Past x 0 none is stored: straight on west, level.
  assert.deepEqual(
    drawnRun(line, 0).map((t) => [t.pts, rounded(t.z)]),
    [[[0, 0, -DRAWN_RUN, 0], rounded([10.2 - RAIL_LIFT, 10.2 - RAIL_LIFT])]],
  )
})
