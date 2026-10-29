/**
 * Entity drafts shared by the systems that spawn: parked and traffic
 * vehicles, pedestrians and animals, and random looks for the people and
 * paint for the cars. Every draft sets PrevPose = Pose so the first
 * rendered frame does not smear.
 *
 * @module spawning
 */
import { Ops, type Random } from "@typeonce/ritmo-math"

import { settle } from "./chassis.ts"
import { UNDAMAGED } from "./damage.ts"
import { gearFor } from "./drivetrain.ts"
import { groundZ, roadLevel } from "./map/ground.ts"
import { ELDERS, lookOf } from "./population/looks.ts"
import { roadOf, type Step } from "./route.ts"
import {
  Animal,
  type AnimalValue,
  Autopilot,
  CarInput,
  Chassis,
  type ChassisValue,
  Damage,
  Game,
  type Look,
  type Mood,
  Motion,
  Pedestrian,
  Person,
  Pose,
  type PoseValue,
  PrevPose,
  Roam,
  Route,
  type RouteValue,
  Traffic,
  Vehicle,
} from "./schema.ts"
import { CAR_COLORS, type VehicleModel, VEHICLES } from "./vehicles.ts"

/** A random grown-up's look (an adult or an elder, as many as live here): a driver, someone out alone. */
export const randomLook = (random: Random.Random): Look =>
  lookOf(random, random.next() < ELDERS ? "elder" : "adult")

/** A random civilian paint colour. */
export const randomColor = (random: Random.Random): number =>
  random.pick(CAR_COLORS) ?? CAR_COLORS[0]

/** A vehicle at rest at `pose` on `chassis` (settled on the ground there unless given): no driver, handbrake on. */
export const parkedCar = (
  model: VehicleModel,
  color: number,
  pose: PoseValue,
  chassis: ChassisValue = settle(model, pose),
) =>
  Game.Command.spawn(
    [Vehicle, { model, color }],
    [Pose, pose],
    [PrevPose, pose],
    [Motion, { vx: 0, vy: 0, spin: 0 }],
    [CarInput, { throttle: 0, steer: 0, handbrake: true }],
    [Chassis, chassis],
    [Damage, UNDAMAGED],
  )

/**
 * A vehicle of `model` on its springs at `pose`, rolling at `speed` (m/s) along its heading, in the gear for that speed: on the
 * level `level` (m a.s.l., its road's: a deck, a tunnel's floor), or at grade.
 */
export const rollingChassis = (
  model: VehicleModel,
  pose: PoseValue,
  speed: number,
  level?: number,
) => ({
  ...settle(model, pose, level === undefined ? undefined : (x, y) => groundZ(x, y, level)),
  gear: gearFor(VEHICLES[model], speed),
})

/** An AI vehicle on `edge` (travelled a -> b when `forward`) moving at `speed` along its heading. */
export const trafficCar = (
  model: VehicleModel,
  color: number,
  pose: PoseValue,
  speed: number,
  route: RouteValue,
  next: Step,
) =>
  Game.Command.spawn(
    [Vehicle, { model, color }],
    [Pose, pose],
    [PrevPose, pose],
    [Motion, { vx: Ops.cos(pose.angle) * speed, vy: Ops.sin(pose.angle) * speed, spin: 0 }],
    [CarInput, { throttle: 0, steer: 0, handbrake: false }],
    [Chassis, rollingChassis(model, pose, speed, roadLevel(roadOf(route.edge), pose.x, pose.y))],
    [Damage, UNDAMAGED],
    [Traffic, {}],
    [Route, route],
    [
      Autopilot,
      { next: next.edge, nextForward: next.forward, stuck: 0, reverseUntil: 0, tries: 0 },
    ],
  )

/** An animal of `species` standing at `pose`, at home there. */
export const animal = (look: AnimalValue, pose: PoseValue) =>
  Game.Command.spawn(
    [Animal, look],
    [Roam, { mood: "idle", until: 0, hx: pose.x, hy: pose.y, tx: pose.x, ty: pose.y }],
    [Pose, pose],
    [PrevPose, pose],
    [Motion, { vx: 0, vy: 0, spin: 0 }],
  )

/** A pedestrian on `route` in `mood` until step `until`, about the point (fx, fy) (see `Pedestrian`). */
export const pedestrian = (
  look: Look,
  pose: PoseValue,
  route: RouteValue,
  mood: { readonly mood: Mood; readonly until: number; readonly fx: number; readonly fy: number },
) =>
  Game.Command.spawn(
    [Pedestrian, { ...mood, blocked: 0 }],
    [Person, look],
    [Pose, pose],
    [PrevPose, pose],
    [Motion, { vx: 0, vy: 0, spin: 0 }],
    [Route, route],
  )
