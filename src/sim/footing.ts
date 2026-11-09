/**
 * A body's footing (`Footing`, GLOSSARY.md): the ground a person or an animal stands on, on the level it is on, and for the player
 * driving, the ground under what they drive. One brought out takes its first footing (`firstFooting`): its way's road where that is
 * a bridge's deck or a tunnel's floor, else the ground at the terrain's level. Each step, once everything has moved, it is settled
 * again where the body now is (`settleFooting`), keeping to the level it was on (`footZ`, the decks and tunnels out to their
 * verges), so it walks onto a bridge's deck or into a tunnel along the road, and stays on the track over a road tunnel or under a
 * road bridge. The render stands a figure on the ground at its drawn place through `settleFooting` too.
 *
 * @module footing
 */
import { wheelsAt } from "./chassis.ts"
import { atGrade, footZ, groundZ, roadLevel } from "./map/ground.ts"
import { graph, MAP } from "./map/index.ts"
import { cabOf } from "./rail/boarding.ts"
import type { Line } from "./rail/lines.ts"
import type { TrainModel } from "./rail/models.ts"
import type { ChassisValue, PoseValue, RouteValue, TrainMotionValue } from "./schema.ts"
import { VEHICLES, type VehicleModel } from "./vehicles.ts"

/** Where a body brought out at (x, y) stands, m a.s.l.: on `route`'s road when that is lifted (a deck, a tunnel's floor), else at the terrain's level. */
export const firstFooting = (x: number, y: number, route?: RouteValue): number => {
  if (route === undefined) return atGrade(x, y)
  const road = graph.edges[route.edge]!.road,
    { bridge, tunnel } = MAP.roads[road]!
  return bridge === true || tunnel === true
    ? (roadLevel(road, x, y) ?? atGrade(x, y))
    : atGrade(x, y)
}

/** The footing of a body at (x, y) whose footing was `was`, m a.s.l.: the ground there on the level nearest it (`footZ`). */
export const settleFooting = (x: number, y: number, was: number): number => footZ(x, y, was)

/** The footing of the player driving a car of `model` at `pose` on `chassis`, m a.s.l.: the ground under it on its wheels' ground. */
export const carFooting = (pose: PoseValue, model: VehicleModel, chassis: ChassisValue): number =>
  groundZ(pose.x, pose.y, wheelsAt(VEHICLES[model], chassis))

/** The footing of the player driving a train of `model` on `line`, m a.s.l.: the rail head under its active cab (on a rail bridge too, which the map's ground has not). */
export const trainFooting = (line: Line, motion: TrainMotionValue, model: TrainModel): number =>
  cabOf(line, motion, model).z
