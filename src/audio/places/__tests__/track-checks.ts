// The check track.test.ts (the line by Monzone station) and track.map-test.ts (every line of the
// map, end to end) share: where the rails clack.
import assert from "node:assert/strict"

import { MAP } from "../../../sim/map/index.ts"
import { LINES, pointAt } from "../../../sim/rail/lines.ts"
import { JOINT } from "../../synth/rail.ts"
import { jointsBetween } from "../track.ts"

/**
 * Along line `index` from s `lo` to `hi`: a joint every `JOINT` m, and a switch wherever an end of a
 * piece of track the line does not run on lies on it, and nowhere else; of the switches and piece
 * ends, those at a point `holds` takes (all of them with none).
 */
export const checkJoints = (
  index: number,
  lo: number,
  hi: number,
  holds: (x: number, y: number) => boolean = () => true,
): void => {
  const line = LINES[index]!,
    joints = jointsBetween(index, lo, hi)
  const switches = joints.filter((s) => s % JOINT !== 0)
  assert.equal(
    joints.length - switches.length,
    Math.floor(hi / JOINT) - Math.ceil(lo / JOINT) + 1,
    "a joint every 36 m",
  )
  // Every piece of track off the line ends on it at a switch, and nowhere else.
  const runs = new Set(line.runs.map((run) => run.key))
  const ends = MAP.rail
    .flatMap((piece, i) =>
      runs.has(i)
        ? []
        : [0, piece.z.length - 1].map((k) => ({ x: piece.pts[2 * k]!, y: piece.pts[2 * k + 1]! })),
    )
    .filter(({ x, y }) => holds(x, y))
  for (const s of switches) {
    const at = pointAt(line, s)
    if (!holds(at.x, at.y)) continue
    assert.ok(
      ends.some((end) => Math.hypot(end.x - at.x, end.y - at.y) < 0.1),
      `${s}`,
    )
  }
  if (ends.some((end) => line.x.some((x, k) => x === end.x && line.y[k] === end.y)))
    assert.ok(switches.length > 0, "a loop on the line has its switches")
}
