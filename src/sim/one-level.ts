/**
 * Whether two bodies, or a body and a wall, are on one level where they meet: their levels stand within `ONE_LEVEL` (2 m) of
 * each other, so what stands on a bridge's deck and what stands under it pass each other as if the other were not there. A
 * person's or an animal's level is its `Footing`, a train car's its rail head under its middle, a wall's its own: one height
 * over the whole body (a point level). A road vehicle's is pitched: the ground under its middle, carried along its pitch out to
 * its bumpers, so the two ends of a truck on a steep lane each read their own ground; past a bumper, rolled on over the ground
 * along its heading (`rolledTo`), as its wheels would find their way, so a car's way through a sag or onto a deck reads the
 * deck. Never rolled sideways: the ground beside a vehicle (an embankment's foot, under a deck's edge, under one thrown into
 * the air) is not what its wheels stand on. Pure functions of the levels and the ground.
 *
 * @module one-level
 */
import { Ops, type Vec2 } from "@typeonce/ritmo-math"

import { wheelsAt } from "./chassis.ts"
import { rolledTo } from "./map/ground.ts"
import { ONE_LEVEL } from "./map/kinds.ts"
import type { ChassisValue, PoseValue } from "./schema.ts"
import { VEHICLES, type VehicleModel } from "./vehicles.ts"

/**
 * A road vehicle's level: its middle (x, y) and heading, its wheels' ground there (`ground`, m a.s.l., `wheelsAt`), how far
 * that rises a metre ahead (`rise`, its pitch's tangent), and how far its body reaches either way of its middle (`reach`, m:
 * half its length, to its bumpers).
 */
export interface Pitched {
  readonly x: number
  readonly y: number
  readonly angle: number
  readonly ground: number
  readonly rise: number
  readonly reach: number
}

/** A body's level: one height over its whole body (m a.s.l.: a `Footing`, a rail head, a wall's level), or a road vehicle's `Pitched` level. */
export type Level = number | Pitched

/** The `Pitched` level of a `model` at `pose` on `chassis`. */
export const pitched = (model: VehicleModel, pose: PoseValue, chassis: ChassisValue): Pitched => ({
  x: pose.x,
  y: pose.y,
  angle: pose.angle,
  ground: wheelsAt(VEHICLES[model], chassis),
  rise: Ops.tan(chassis.pitch),
  reach: VEHICLES[model].length / 2,
})

/**
 * `level` read toward (x, y), m a.s.l.: a point level as it is; a pitched one along its pitch to (x, y)'s place along its
 * heading, out to a bumper, and past it rolled on along its heading to there.
 */
const toward = (
  level: Level,
  x: number,
  y: number,
  surface?: (x: number, y: number, near: number) => number,
): number => {
  if (typeof level === "number") return level
  const fx = Ops.cos(level.angle),
    fy = Ops.sin(level.angle)
  const ahead = (x - level.x) * fx + (y - level.y) * fy,
    along = Math.max(-level.reach, Math.min(level.reach, ahead)),
    ground = level.ground + along * level.rise
  if (ahead === along) return ground
  return rolledTo(
    level.x + fx * along,
    level.y + fy * along,
    ground,
    level.x + fx * ahead,
    level.y + fy * ahead,
    surface,
  )
}

/** Where two point levels are read: nowhere in particular. */
const NOWHERE: Vec2.Vec2 = { x: 0, y: 0 }

/**
 * Whether `a` and `b` are on one level: within ONE_LEVEL of each other, a pitched level read toward `at`, where they meet, over
 * `surface` (the map's ground with the decks and tunnels out to their walkers' verges, by default). A point on a vehicle's body
 * reads no ground; one past its bumper reads it once a metre past it.
 */
export const onOneLevel: {
  (a: number, b: number): boolean
  (
    a: Level,
    b: Level,
    at: Vec2.Vec2,
    surface?: (x: number, y: number, near: number) => number,
  ): boolean
} = (
  a: Level,
  b: Level,
  at: Vec2.Vec2 = NOWHERE,
  surface?: (x: number, y: number, near: number) => number,
): boolean => Math.abs(toward(a, at.x, at.y, surface) - toward(b, at.x, at.y, surface)) < ONE_LEVEL
