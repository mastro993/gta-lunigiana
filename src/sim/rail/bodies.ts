/**
 * Trains as the world meets them: each car a capsule along its axis (the body `carsOf` places, round at
 * the train's two noses and square at the joints, where the next car goes on), moving with the train at
 * its line's pace; and the level every rule between a train and a body on the ground keeps to: they meet
 * only where the body's ground stands within `LEVEL` m of the rail head, so a train on a bridge over a
 * road, under a road bridge or in a tunnel under fields meets nothing there. Also where a body fouls a
 * line's track (the AI driver's look-out), which side of a line a point lies on (the animals keep to
 * theirs) and where off the track an animal may be brought out. Pure functions of the trains and the map.
 *
 * @module rail/bodies
 */
import { Ops } from "@typeonce/ritmo-math"

import { segDist2 } from "../collide.ts"
import { platformTop } from "../map/ground.ts"
import type { TrainMotionValue } from "../schema.ts"
import { carsOf } from "./consist.ts"
import { LINES, linesNear, pointAt, SHARED, sharedPart, speedAt } from "./lines.ts"
import { spanOf, TRAIN_MODELS, TRAINS, trainLength, type TrainModel } from "./models.ts"

/** A body meets a train only when its ground stands this near the rail head there, m: a bridge, an underpass or a tunnel's roof keeps them apart. */
export const LEVEL = 2
/** The envelope a train sweeps reaches this far past its body either side, m: what its driver sees on the track. */
export const CLEARANCE = 0.3
/** The widest train's half-width, m: on a platform, only what reaches in that far stands in a train's way. */
const BODY = Math.max(...TRAIN_MODELS.map((model) => TRAINS[model].width)) / 2

/** Whether ground at `z` (m a.s.l.) is on the level of a rail head at `rail`. */
export const onLevel = (z: number, rail: number): boolean => Math.abs(z - rail) < LEVEL

/** A train as the world sees it: its entity id, line and motion, and model. */
export interface SeenTrain {
  readonly id: number
  readonly motion: TrainMotionValue
  readonly model: TrainModel
}

/**
 * One car of a train as a body: whose (`train`, of `model`), on which line, its middle (x, y and the rail head's z under it),
 * heading toward the train's front, length and width (m), its velocity (m/s), its line's speed there (`usual`, m/s), and its
 * axis from (ax, ay) at the front to (bx, by) at the rear, round with radius `r` (half its width) at a nose, square at a joint.
 */
export interface TrainCar {
  readonly train: number
  readonly model: TrainModel
  readonly line: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly angle: number
  readonly length: number
  readonly width: number
  readonly vx: number
  readonly vy: number
  readonly speed: number
  readonly usual: number
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
  readonly r: number
}

/** Every car of every train in `trains`, each moving along the track at its train's speed. */
export const trainCars = (trains: ReadonlyArray<SeenTrain>): Array<TrainCar> =>
  trains.flatMap(({ id, motion, model }) => {
    const line = LINES[motion.line]
    if (line === undefined) return []
    const cars = carsOf(line, motion.s, motion.facing, model),
      r = TRAINS[model].width / 2,
      speed = Math.abs(motion.v)
    let back = 0
    return cars.map((car, k) => {
      const fx = Ops.cos(car.angle),
        fy = Ops.sin(car.angle)
      // Its velocity: the speed toward +s, and the car's heading points toward the train's front, +facing along s.
      const along = motion.v * motion.facing,
        front = car.length / 2 - (k === 0 ? r : 0),
        rear = car.length / 2 - (k === cars.length - 1 ? r : 0)
      const mid = motion.s - motion.facing * (back + car.length / 2)
      back += car.length
      return {
        train: id,
        model,
        line: motion.line,
        x: car.x,
        y: car.y,
        z: car.z,
        angle: car.angle,
        length: car.length,
        width: car.width,
        vx: fx * along,
        vy: fy * along,
        speed,
        usual: speedAt(line, mid),
        ax: car.x + fx * front,
        ay: car.y + fy * front,
        bx: car.x - fx * rear,
        by: car.y - fy * rear,
        r,
      }
    })
  })

/**
 * The ends (lo, hi) along `line`, the speed toward its +s and the way its active cab faces along it of every train but `except` on
 * its track: those on the line, and those of other lines where they run on track it shares (`SHARED`).
 */
export const bodiesOn = (trains: ReadonlyArray<SeenTrain>, line: number, except?: number) =>
  trains.flatMap(({ id, motion, model }) => {
    if (id === except) return []
    const { lo, hi } = spanOf(motion.s, motion.facing, trainLength(model))
    if (motion.line === line) return [{ lo, hi, v: motion.v, facing: motion.facing }]
    return sharedPart(SHARED[line]?.[motion.line] ?? [], lo, hi).map((part) => ({
      lo: part.lo,
      hi: part.hi,
      v: part.sign * motion.v,
      facing: part.sign === motion.facing ? (1 as const) : (-1 as const),
    }))
  })

/** The point of `car`'s axis nearest (x, y), and how far (x, y) lies from it, m. */
export const axisNear = (car: TrainCar, x: number, y: number) => {
  const { d2, t } = segDist2(x, y, car.ax, car.ay, car.bx, car.by)
  return { x: car.ax + (car.bx - car.ax) * t, y: car.ay + (car.by - car.ay) * t, d: Math.sqrt(d2) }
}

/** How far (x, y) lies from `car`'s body, m (0 inside it). */
export const offCar = (car: TrainCar, x: number, y: number): number =>
  Math.max(0, axisNear(car, x, y).d - car.r)

/** Whether (x, y) may be near `car` at all: within `reach` m of its body's bounding circle. */
export const nearCar = (car: TrainCar, x: number, y: number, reach: number): boolean =>
  (car.x - x) ** 2 + (car.y - y) ** 2 < (car.length / 2 + reach) ** 2

/** A body as a train's driver sees it: its middle, heading, half its length and width (m, rad), and its ground's height, asked only when it matters. */
export interface Sighted {
  readonly x: number
  readonly y: number
  readonly angle: number
  readonly long: number
  readonly wide: number
  readonly ground: () => number
}

/**
 * Where `body` fouls `line`'s envelope (a train's half-width of `half` m and `reach`, `CLEARANCE` unless asked): its s there, when
 * its edge lies inside it on the train's level, and, standing on a platform, inside a train's body itself (leaning over the edge);
 * else undefined.
 */
export const foulsAt = (
  line: number,
  body: Sighted,
  half: number,
  reach = CLEARANCE,
): number | undefined => {
  const near = linesNear(body.x, body.y, half + reach + body.long).find((p) => p.line === line)
  if (near === undefined) return undefined
  const at = pointAt(LINES[line]!, near.s),
    turn = body.angle - at.angle
  // How far its footprint reaches across the track from its middle.
  const across = Math.abs(Ops.sin(turn)) * body.long + Math.abs(Ops.cos(turn)) * body.wide,
    clear = near.distance - across
  if (clear >= half + reach || (clear >= BODY && platformTop(body.x, body.y) !== undefined))
    return undefined
  return onLevel(body.ground(), at.z) ? near.s : undefined
}

/** How far a body keeps off a line's centreline when it picks a place to go, m: outside a train's envelope and a little more. */
const KEEP_OFF = 3

/** Whether (x, y) lies clear of every line's track at grade, `KEEP_OFF` m or more off its centreline: where an animal may be brought out. */
export const offTrack = (x: number, y: number): boolean =>
  linesNear(x, y, KEEP_OFF).every((near) => {
    const at = pointAt(LINES[near.line]!, near.s)
    return at.bridge || at.tunnel
  })

/**
 * `to`, or, where it lies across a line's track at grade from `from` or within `KEEP_OFF` m of it, the point `KEEP_OFF` m off the
 * centreline on `from`'s side, beside where `to` is: a body picking a place to walk to stays on its side of the railway (a line on a
 * bridge or in a tunnel there is no barrier). The nearest line within reach of the walk counts.
 */
export const ownSide = (
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } => {
  const reach = Ops.hypot(to.x - from.x, to.y - from.y) / 2 + KEEP_OFF
  const mx = (from.x + to.x) / 2,
    my = (from.y + to.y) / 2
  for (const near of linesNear(mx, my, reach)) {
    const line = LINES[near.line]!
    // The line beside the target: its nearest point to it, as far as the walk reaches.
    const there = linesNear(to.x, to.y, 2 * reach).find((p) => p.line === near.line)
    const at = pointAt(line, there?.s ?? near.s)
    if (at.bridge || at.tunnel) continue
    const nx = -Ops.sin(at.angle),
      ny = Ops.cos(at.angle)
    const side = (p: { readonly x: number; readonly y: number }) =>
      (p.x - at.x) * nx + (p.y - at.y) * ny
    const mine = side(from) < 0 ? -1 : 1,
      off = side(to) * mine
    if (off >= KEEP_OFF) continue
    return { x: at.x + nx * mine * KEEP_OFF, y: at.y + ny * mine * KEEP_OFF }
  }
  return to
}
