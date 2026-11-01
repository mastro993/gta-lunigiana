/**
 * Via Riolo's crossing and the traffic round it, as the crossing traffic tests stage it, shared by `trains-traffic.test.ts` and `trains-traffic.long-test.ts`.
 *
 * @module sim/__tests__/crossing-traffic
 */
import { Ops, type Vec2 } from "@typeonce/ritmo-math"

import { carCircles, carRadius } from "../body.ts"
import { graph } from "../map/index.ts"
import { CLEARANCE } from "../rail/bodies.ts"
import { linesNear } from "../rail/lines.ts"
import { TRAINS } from "../rail/models.ts"
import { RIOLO, wayInto } from "../rail/testing.ts"
import { laneOf, lanePoint, laneSide, roadOf, type Step } from "../route.ts"
import { trafficCar } from "../spawning.ts"
import type { VehicleModel } from "../vehicles.ts"
import { waterUnder } from "../water/rivers.ts"
import { SPATE } from "./flows.ts"
import { box, line } from "./railway.ts"

/** How far a train's envelope reaches either side of the centreline, m: the ATR 220's half-width and 0.3 m. */
export const ENVELOPE = TRAINS.atr220.width / 2 + CLEARANCE

/** The side of Via Riolo whose way in starts at a junction short of its stop line (the north-west one, from Via delle Cave). */
export const SIDE = ([0, 1] as const).find((k) => wayInto(RIOLO, k).stop > 0)!

/** The way into the box from that side. */
export const way = wayInto(RIOLO, SIDE)

/** The junction the way in starts at, and the half-width of the widest road crossing the way there. */
export const JUNCTION = graph.nodes[way.from]!,
  CROSSING_ROAD = Math.max(
    ...graph.adjacency[way.from]!.filter(
      (e) => e !== way.step.edge && e !== way.before.edge && graph.trafficEdges.includes(e),
    ).map((e) => roadOf(e).w / 2),
  )

/** Far from the box: the player watches from 85 m off, on the first corner of a square round it dry in a spate (the Torrente Lucido runs by). */
export const AWAY = (
  [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const
)
  .map(([sx, sy]) => ({ x: box.x + 60 * sx, y: box.y + 60 * sy, angle: 0 }))
  .find(({ x, y }) => waterUnder(x, y, false, SPATE) === undefined)!

/** A traffic car of `model` (a Panda by default) on `step`, `along` m down its lane, heading on to `next`, at `speed` m/s. */
export const panda = (
  step: Step,
  along: number,
  next: Step,
  speed = 5,
  model: VehicleModel = "panda",
) => {
  const lane = laneOf(step.edge, step.forward),
    side = laneSide(step, model)
  return trafficCar(
    model,
    0x8b8170,
    { ...lanePoint(lane, along, side), angle: Ops.atan2(lane.dy, lane.dx) },
    speed,
    { ...step, side },
    next,
  )
}

/** How near a vehicle of model `model` at `pose` comes to the line's centreline, its body's edge (m). */
export const offTrack = (
  model: VehicleModel,
  pose: { readonly x: number; readonly y: number; readonly angle: number },
) =>
  Math.min(
    ...carCircles(model, pose.angle).map((o) => {
      const near = linesNear(pose.x + o.x, pose.y + o.y, 30).find((p) => p.line === line.index)
      return (near?.distance ?? 30) - carRadius(model)
    }),
  )

/** How far past the box's near entry on side `k` (along the way in) a point lies, m: over 0 inside the box or beyond it. */
export const pastEntry = (k: 0 | 1, p: Vec2.Vec2) => {
  const { entry, heading } = box.approaches[k]!
  return (p.x - entry.x) * Ops.cos(heading) + (p.y - entry.y) * Ops.sin(heading)
}

/** The box's length along the way in from side `SIDE`, entry to entry, m. */
export const BOX = pastEntry(SIDE, box.approaches[1 - SIDE]!.entry)
