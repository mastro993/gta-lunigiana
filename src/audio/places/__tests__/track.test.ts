import assert from "node:assert/strict"
import { test } from "node:test"

import { MAP } from "../../../sim/map/index.ts"
import { LINES, pointAt } from "../../../sim/rail/lines.ts"
import { JOINT } from "../../synth/rail.ts"
import { jointsBetween, portalsOf } from "../track.ts"

test("the rails clack at a joint every 36 m along a line, and at its switches: where a loop or siding the line does not run on meets it", () => {
  for (const line of LINES) {
    const joints = jointsBetween(line.index, -100, line.length + 100)
    const switches = joints.filter((s) => s % JOINT !== 0)
    assert.ok(
      joints.filter((s) => s % JOINT === 0).length === Math.floor((line.length + 100) / JOINT) + 3,
    )
    // Every piece of track off the line ends on it at a switch, and nowhere else.
    const runs = new Set(line.runs.map((run) => run.key))
    const ends = MAP.rail.flatMap((piece, index) =>
      runs.has(index)
        ? []
        : [0, piece.z.length - 1].map((k) => ({ x: piece.pts[2 * k]!, y: piece.pts[2 * k + 1]! })),
    )
    for (const s of switches) {
      const at = pointAt(line, s)
      assert.ok(
        ends.some((end) => Math.hypot(end.x - at.x, end.y - at.y) < 0.1),
        `${s}`,
      )
    }
    if (ends.some((end) => line.x.some((x, k) => x === end.x && line.y[k] === end.y)))
      assert.ok(switches.length > 0, "a loop on the line has its switches")
  }
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
