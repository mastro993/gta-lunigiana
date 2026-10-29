/**
 * What a pedestrian makes of the vehicles around it (Perceive's senses): whether one is about to hit them, whether that alarms
 * them, whether a horn is meant for them, which verge gets them out of a car's path, and whether a wall hides a point.
 *
 * @module senses
 */
import { Ops, type Vec2 } from "@typeonce/ritmo-math"

import { crossesAny, wallsAlong } from "../body.ts"
import { alongLane, laneOf, lanePoint, roadOf, walkSide } from "../route.ts"
import type { PoseValue, RouteValue } from "../schema.ts"
import { KNOCK_SPEED, PERSON_RADIUS } from "../tuning.ts"
import { VEHICLES, type VehicleModel } from "../vehicles.ts"

/**
 * Danger (TUNED): a vehicle faster than SLOWEST m/s (`KNOCK_SPEED`: any that could knock them down) whose body, both keeping
 * their velocities, passes within BRUSH m of the person in the next HORIZON s (it would hit or brush them); or one faster than FAST m/s, closing, that passes within CLOSE m
 * plus STARTLE s of its speed over the street's usual pace (USUAL × `cruiseSpeed`): a car at 100 km/h on a 12 m/s street
 * startles a walker 2.1 m from its body, while a Panda in its lane passes a walker on the verge with 0.88 m or more between its
 * body and them on 95 % of the 12 m/s (tertiary) lanes, 0.62–0.67 m on most 9 m/s ones (measured over the map's traffic
 * lanes), and nobody runs from that. Checked every SAMPLES-th of the horizon. A vehicle behind them (TUNED) they only hear,
 * BEHIND s before it would be on them.
 */
export const DANGER = {
  slowest: KNOCK_SPEED,
  brush: 0.5,
  fast: 10,
  close: 0.75,
  startle: 0.1,
  horizon: 1.5,
  behind: 0.6,
  samples: 15,
} as const
/** A vehicle faster than USUAL × its street's own traffic (`cruiseSpeed`) is going fast for that street (TUNED). */
export const USUAL = 1.2
/** A horn is meant for whoever stands in front of the honking car within this many metres of its axis: the traffic AI's cone. */
const HORN_AIM = 1.8

/** A moving vehicle (or a train's car) as perceived: its body's length and width and its full braking (m, m/s²), where, which way, how fast. */
export interface Car {
  readonly id: number
  readonly length: number
  readonly width: number
  readonly decel: number
  readonly x: number
  readonly y: number
  readonly angle: number
  readonly vx: number
  readonly vy: number
  readonly speed: number
  /** The pace of ordinary traffic on the street it drives, or a train's line speed (m/s). */
  readonly usual: number
}

/** A vehicle of `model` as perceived, from its pose, velocity and its street's pace. */
export const carOf = (
  id: number,
  model: VehicleModel,
  pose: PoseValue,
  vx: number,
  vy: number,
  usual: number,
): Car => {
  const { length, width, brakes } = VEHICLES[model]
  return {
    id,
    length,
    width,
    decel: brakes.decel,
    x: pose.x,
    y: pose.y,
    angle: pose.angle,
    vx,
    vy,
    speed: Math.sqrt(vx * vx + vy * vy),
    usual,
  }
}

/**
 * The narrowest gap (m) between a person at `at` moving at `velocity` and `car`'s body (the capsule around its axis) over the
 * next `horizon` seconds, both keeping their velocities.
 */
const nearMiss = (at: Vec2.Vec2, velocity: Vec2.Vec2, car: Car, horizon: number): number => {
  const { length, width } = car
  const k = length / 2 - width / 2,
    fx = Ops.cos(car.angle),
    fy = Ops.sin(car.angle)
  let least = Number.MAX_VALUE
  for (let i = 0; i <= DANGER.samples; i++) {
    const t = (horizon * i) / DANGER.samples
    const rx = at.x - car.x + (velocity.x - car.vx) * t,
      ry = at.y - car.y + (velocity.y - car.vy) * t
    const along = rx * fx + ry * fy,
      across = ry * fx - rx * fy
    const beyond = along - Math.max(-k, Math.min(k, along))
    least = Math.min(least, beyond * beyond + across * across)
  }
  return Math.sqrt(least) - width / 2 - PERSON_RADIUS
}

/** Whether `car`, closing on someone standing at `at` (facing its angle) and moving at `velocity`, is about to hit them (see DANGER). */
export const endangers = (at: PoseValue, velocity: Vec2.Vec2, car: Car): boolean => {
  const closing =
    (at.x - car.x) * (car.vx - velocity.x) + (at.y - car.y) * (car.vy - velocity.y) > 0
  if (!closing) return false
  const ahead = (car.x - at.x) * Ops.cos(at.angle) + (car.y - at.y) * Ops.sin(at.angle) >= 0
  const gap = nearMiss(at, velocity, car, ahead ? DANGER.horizon : DANGER.behind)
  return (
    gap < DANGER.brush ||
    (car.speed > DANGER.fast &&
      gap < DANGER.close + DANGER.startle * Math.max(0, car.speed - car.usual * USUAL))
  )
}

/**
 * How a car about to hit someone at `at`, moving at `velocity`, strikes them: `alarming` when it is faster than its street's
 * traffic, or they stand in its path too close for it to stop short at its full braking; `fresh` when they came that close in
 * the last `dt` s. Traffic at its usual pace with room to stop, or passing beside them (a car slowing for people on a narrow
 * village street), only makes them step aside: crying out at it made an idle Gragnola scream 5 times a minute.
 */
export const alarm = (at: Vec2.Vec2, velocity: Vec2.Vec2, car: Car, dt: number) => {
  const { length, width } = car
  const fx = Ops.cos(car.angle),
    fy = Ops.sin(car.angle),
    stop = (car.speed * car.speed) / (2 * car.decel)
  const rx = at.x - car.x,
    ry = at.y - car.y,
    ahead = rx * fx + ry * fy - length / 2 - PERSON_RADIUS
  const before = ahead + ((car.vx - velocity.x) * fx + (car.vy - velocity.y) * fy) * dt
  const close =
    Math.abs(ry * fx - rx * fy) < width / 2 + PERSON_RADIUS && ahead >= 0 && ahead < stop
  return { alarming: car.speed > car.usual * USUAL || close, fresh: close && before >= stop }
}

/** Whether someone at `at` stands in front of the honking `car`, within its cone: the one it honks at. */
export const honkedAt = (at: Vec2.Vec2, car: PoseValue): boolean => {
  const fx = Ops.cos(car.angle),
    fy = Ops.sin(car.angle),
    rx = at.x - car.x,
    ry = at.y - car.y
  return rx * fx + ry * fy > 0 && Math.abs(ry * fx - rx * fy) < HORN_AIM
}

/** Whether no walk wall stands between `a` and `b`. */
export const inSight = (a: Vec2.Vec2, b: Vec2.Vec2): boolean =>
  !crossesAny(wallsAlong("walk", a.x, a.y, b.x - a.x, b.y - a.y, 0), a, b)

/**
 * The verge of `route` on the person's own side of a vehicle's path, so they never cross in front of it (either, when they stand
 * right in it), the farther from the path.
 */
export const vergeAway = (
  route: RouteValue,
  at: Vec2.Vec2,
  car: Vec2.Vec2,
  velocity: Vec2.Vec2,
): RouteValue => {
  const lane = laneOf(route.edge, route.forward),
    along = alongLane(lane, at.x, at.y),
    verge = walkSide(roadOf(route.edge))
  const left = (p: Vec2.Vec2) => velocity.x * (p.y - car.y) - velocity.y * (p.x - car.x)
  const here = left(at)
  const sides = [verge, -verge].map((side) => ({ side, off: left(lanePoint(lane, along, side)) }))
  const mine = sides.filter(({ off }) => off * here > 0)
  const best = (mine.length > 0 ? mine : sides).reduce((a, b) =>
    Math.abs(b.off) > Math.abs(a.off) ? b : a,
  )
  return { ...route, side: best.side }
}
