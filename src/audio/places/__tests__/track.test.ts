import assert from "node:assert/strict"
import { test } from "node:test"

import { LINES, pointAt } from "../../../sim/rail/lines.ts"
import { portalsOf } from "../track.ts"
import { checkJoints } from "./track-checks.ts"

/** Monzone station. */
const STATION = { x: -493.8, y: 436.9 }
/** Within 4 km of Monzone station: the line from Equi Terme to past Gragnola's loop; track.map-test.ts checks every line end to end. */
const holds = (x: number, y: number) => Math.hypot(x - STATION.x, y - STATION.y) <= 4000

test("the rails clack at a joint every 36 m along a line by Monzone station, and at its switches: where a loop or siding the line does not run on meets it", () => {
  let lines = 0
  for (const line of LINES) {
    const s = line.s.filter((_, k) => holds(line.x[k]!, line.y[k]!))
    if (s.length === 0) continue
    lines++
    checkJoints(line.index, Math.min(...s), Math.max(...s), holds)
  }
  assert.ok(lines > 0, "the Lucca–Aulla line")
})

test("a train in a tunnel reaches the open by its two portals, each as deep as the track from it; out of a tunnel by none", () => {
  const line = LINES[0]!,
    tunnel = line.tunnels.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))
  const s = tunnel.from + 100,
    portals = portalsOf(line.index, s)
  assert.equal(portals.length, 2)
  assert.ok(Math.abs(portals[0]!.depth - 100) < 1e-9)
  assert.ok(Math.abs(portals[0]!.depth + portals[1]!.depth - (tunnel.to - tunnel.from)) < 1e-9)
  const mouth = pointAt(line, tunnel.from)
  assert.ok(Math.hypot(portals[0]!.x - mouth.x, portals[0]!.y - mouth.y) < 1e-9)
  assert.deepEqual(portalsOf(line.index, tunnel.from - 50), [])
})
