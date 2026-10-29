/**
 * Getting into and out of trains, for the action key (`EnterExit`) and the HUD's prompt (`PlayerView`),
 * which ask the same `boardingAt`: a train has a crew door on each side `door` m behind each nose, and
 * is boarded at one while it moves slower than `BOARD_SPEED`, by someone within `ENTER_GAP` of the door
 * whose ground is on the rail's level, with no walk wall between. Boarded at the far cab, that cab
 * becomes the active one. Its driver, or the player, gets out beside a door of the active cab where
 * that door is at grade between the line's terminals and the ground beside it on the rail's level:
 * never on a bridge, in a tunnel, under a road bridge or past the map's edge. The player rides in the
 * active cab, at its driver's place.
 *
 * @module rail/boarding
 */
import { Ops, type Vec2 } from "@typeonce/ritmo-math"

import { crossesAny, standClear, vehicleInReach, walkBy, wallsAlong, wrapAngle } from "../body.ts"
import { footZ } from "../map/ground.ts"
import { MAP } from "../map/index.ts"
import type { ChassisValue, PoseValue, TrainMotionValue } from "../schema.ts"
import { DOOR_GAP, ENTER_GAP } from "../tuning.ts"
import type { VehicleModel } from "../vehicles.ts"
import { onLevel } from "./bodies.ts"
import { type Line, LINES, pointAt } from "./lines.ts"
import { spanOf, TRAINS, trainLength, type TrainModel } from "./models.ts"

/** A train moving slower than this, m/s, can be got into or out of: someone walking keeps up with its door. */
export const BOARD_SPEED = 1.5
/** Whether a train moving at `v` m/s is slow enough to get into or out of: `EnterExit` and the HUD's prompt both ask it. */
export const boardable = (v: number): boolean => Math.abs(v) < BOARD_SPEED

/** The active cab's driver's place: on the line `door` m behind the nose (x, y, the rail head's z), facing the cab's way (`angle`), the line's heading toward +s there (`track`), rad. */
export const cabOf = (line: Line, motion: TrainMotionValue, model: TrainModel) => {
  const at = pointAt(line, motion.s - motion.facing * TRAINS[model].door)
  return {
    x: at.x,
    y: at.y,
    z: at.z,
    angle: motion.facing > 0 ? at.angle : wrapAngle(at.angle + Math.PI),
    track: at.angle,
  }
}

/** One of a train's crew doors: at which `end` (0 the active cab, 1 the far one), on which `side` of the line (as a station's: +1 right of +s, −1 left), its s, and where it is on the body's side (x, y, the rail head's z). */
export interface CabDoor {
  readonly end: 0 | 1
  readonly side: 1 | -1
  readonly s: number
  readonly x: number
  readonly y: number
  readonly z: number
}

/** A train's four crew doors, `door` m behind each nose on each side. */
export const doorsOf = (
  line: Line,
  motion: TrainMotionValue,
  model: TrainModel,
): ReadonlyArray<CabDoor> => {
  const { door, width } = TRAINS[model],
    length = trainLength(model)
  return ([0, 1] as const).flatMap((end) => {
    const s = motion.s - motion.facing * (end === 0 ? door : length - door),
      at = pointAt(line, s)
    // The right of +s.
    const nx = Ops.sin(at.angle) * (width / 2),
      ny = -Ops.cos(at.angle) * (width / 2)
    return ([1, -1] as const).map((side) => ({
      end,
      side,
      s,
      x: at.x + nx * side,
      y: at.y + ny * side,
      z: at.z,
    }))
  })
}

/** A train as boarding sees it: its motion and model. */
interface Boardable {
  readonly motion: TrainMotionValue
  readonly model: TrainModel
}

/**
 * Of `trains`, the door a person at `at` standing on `ground` (m a.s.l.) gets in at with the action key, and how far off it is: the
 * nearest within ENTER_GAP of a train moving slower than BOARD_SPEED, their ground on the rail's level there, with no walk wall
 * between them.
 */
export const trainInReach = <T>(
  at: Vec2.Vec2,
  ground: number,
  trains: ReadonlyArray<T>,
  of: (train: T) => Boardable,
): { readonly train: T; readonly door: CabDoor; readonly gap: number } | undefined => {
  let found: { readonly train: T; readonly door: CabDoor; readonly gap: number } | undefined
  for (const train of trains) {
    const { motion, model } = of(train),
      line = LINES[motion.line]
    if (line === undefined || !boardable(motion.v)) continue
    for (const door of doorsOf(line, motion, model)) {
      const gap = Ops.hypot(door.x - at.x, door.y - at.y)
      if (gap > (found?.gap ?? ENTER_GAP) || !onLevel(ground, door.z)) continue
      const walls = wallsAlong("walk", at.x, at.y, door.x - at.x, door.y - at.y, 0.5)
      if (crossesAny(walls, at, door)) continue
      found = { train, door, gap }
    }
  }
  return found
}

/** What the action key would get someone into: a vehicle, or a train at one of its doors. */
export type Boarding<V, T> =
  | { readonly kind: "vehicle"; readonly vehicle: V }
  | { readonly kind: "train"; readonly train: T; readonly door: CabDoor }

/**
 * What a person at `at` standing on `ground` (m a.s.l.) gets into with the action key: the vehicle in reach (`vehicleInReach`)
 * nearer than any train's door in reach (`trainInReach`), else that train. The action (EnterExit) and the HUD's prompt
 * (PlayerView) both ask this.
 */
export const boardingAt = <V, T>(
  at: Vec2.Vec2,
  ground: number,
  vehicles: ReadonlyArray<V>,
  bodyOf: (vehicle: V) => {
    readonly model: VehicleModel
    readonly pose: PoseValue
    readonly chassis: ChassisValue
    readonly damage: number
  },
  trains: ReadonlyArray<T>,
  of: (train: T) => Boardable,
): Boarding<V, T> | undefined => {
  const door = trainInReach(at, ground, trains, of),
    vehicle = vehicleInReach(at, vehicles, bodyOf, door?.gap)
  if (vehicle !== undefined) return { kind: "vehicle", vehicle }
  return door === undefined ? undefined : { kind: "train", train: door.train, door: door.door }
}

/** The sides of the line (+1 right of +s) of a cab facing `facing` along it: its left first (the driver's, as in a car), then its right. */
export const cabSides = (facing: 1 | -1): readonly [1 | -1, 1 | -1] =>
  facing > 0 ? [-1, 1] : [1, -1]

/** A train's motion once boarded at its `end` cab: at the far one (1) that cab becomes the active one, its nose s and facing the other way, the power pulling as it did. */
export const boarded = (
  motion: TrainMotionValue,
  model: TrainModel,
  end: 0 | 1,
): TrainMotionValue => {
  if (end === 0) return motion
  const { tail } = spanOf(motion.s, motion.facing, trainLength(model))
  return {
    ...motion,
    s: tail,
    prev: tail,
    facing: motion.facing > 0 ? -1 : 1,
    power: -motion.power,
  }
}

/**
 * Where someone getting out of a train's `end` cab steps down, facing the cab's way: `DOOR_GAP` m out from the first of its doors
 * on `sides` (of the line, +1 right of +s) that is at grade (on no bridge, in no tunnel) between the line's terminals, with ground
 * on the rail's level there (whatever road runs under or over it), clear of walk walls with none between it and the track, or,
 * when `platform`, the one on the side of a station's platforms beside the door where that one is; undefined when none is.
 */
export const exitSpot = (
  line: Line,
  motion: TrainMotionValue,
  model: TrainModel,
  end: 0 | 1,
  sides: ReadonlyArray<1 | -1>,
  platform = false,
): PoseValue | undefined => {
  const doors = doorsOf(line, motion, model),
    { angle } = cabOf(line, motion, model)
  const spots = sides.flatMap((side) => {
    const door = doors.find((d) => d.end === end && d.side === side)!,
      at = pointAt(line, door.s)
    if (at.bridge || at.tunnel || door.s < 0 || door.s > line.length) return []
    const spot = {
      x: door.x + Ops.sin(at.angle) * side * DOOR_GAP,
      y: door.y - Ops.cos(at.angle) * side * DOOR_GAP,
    }
    if (!onLevel(footZ(spot.x, spot.y, at.z), at.z) || !standClear(spot)) return []
    if (walkBy(at, { x: spot.x - at.x, y: spot.y - at.y }).blocked) return []
    // Facing the way the train's end faces: the active cab's way, the far cab's the other.
    return [{ side, pose: { ...spot, angle: end === 0 ? angle : wrapAngle(angle + Math.PI) } }]
  })
  // The side of the station whose platforms the door is along, if any.
  const s =
      motion.s -
      motion.facing * (end === 0 ? TRAINS[model].door : trainLength(model) - TRAINS[model].door),
    station = platform
      ? MAP.railway.stations.find((st) => st.line === line.index && s >= st.s0 && s <= st.s1)
      : undefined
  return (spots.find((spot) => spot.side === station?.side) ?? spots[0])?.pose
}
