/**
 * Spots down Via Cesare Battisti's lane, shared by `explosions.test.ts` and `explosions.long-test.ts`.
 *
 * @module sim/__tests__/battisti-lane
 */
import { laneOf, lanePoint, laneSide } from "../route.ts"
import { BATTISTI, ON_BATTISTI } from "../testing.ts"

/** The lane of Via Cesare Battisti the tests drive. */
export const lane = laneOf(BATTISTI.edge, BATTISTI.forward)
/** A spot `along` m down the Battisti lane, `out` m to its left (toward the north verge). */
export const on = (along: number, out = 0) => {
  const p = lanePoint(lane, along, laneSide(BATTISTI, "panda")),
    left = { x: -lane.dy, y: lane.dx }
  return { x: p.x + left.x * out, y: p.y + left.y * out, angle: ON_BATTISTI.angle }
}
