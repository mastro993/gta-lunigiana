/**
 * Collision bodies shared by the movement and contact systems: a person is one
 * circle, a vehicle a row of circles along its axis (radius width/2, centres
 * evenly spaced between ±(length/2 − width/2), at most one radius apart).
 *
 * @module body
 */
import { Ops, Vec2 } from "@typeonce/ritmo-math"

import { overturned } from "./chassis.ts"
import { moveCircles, segmentDistance } from "./collide.ts"
import { destroyed } from "./damage.ts"
import { atGrade } from "./map/ground.ts"
import { inPlay, type Segment, type Wall, type WallKind, wallsNear } from "./map/index.ts"
import { indoors } from "./population/farms.ts"
import { onLevel } from "./rail/bodies.ts"
import type { ChassisValue, PoseValue } from "./schema.ts"
import { ENTER_GAP, PERSON_RADIUS } from "./tuning.ts"
import { VEHICLES, type VehicleModel } from "./vehicles.ts"

/** Radius of a vehicle's body circles, m. */
export const carRadius = (model: VehicleModel): number => VEHICLES[model].width / 2

/**
 * World-frame offsets of a vehicle's body circles from its centre, for heading `angle`: at least
 * three, spaced at most one radius apart, so the waists between them stay shallow (≤ 0.14 r).
 */
export const carCircles = (model: VehicleModel, angle: number): ReadonlyArray<Vec2.Vec2> => {
  const { length, width } = VEHICLES[model]
  const k = length / 2 - width / 2
  const n = Math.max(3, Math.ceil((2 * k) / (width / 2)) + 1)
  const fx = Ops.cos(angle),
    fy = Ops.sin(angle)
  return Array.from({ length: n }, (_, i) => {
    const along = k * ((2 * i) / (n - 1) - 1)
    return { x: fx * along, y: fy * along }
  })
}

/** How far (x, y) is from the body of `model` at `pose`, m, 0 inside it: the hull its circles sweep along its axis. */
export const offBody = (model: VehicleModel, pose: PoseValue, x: number, y: number): number => {
  const r = carRadius(model),
    k = VEHICLES[model].length / 2 - r,
    fx = Ops.cos(pose.angle) * k,
    fy = Ops.sin(pose.angle) * k
  const axis = { ax: pose.x - fx, ay: pose.y - fy, bx: pose.x + fx, by: pose.y + fy }
  return Math.max(0, segmentDistance(axis, x, y) - r)
}

/** Whether a body whose ground stands at `z` (m a.s.l.) meets `wall`: any wall without a level, one with a level within `LEVEL` of it. */
export const meets = (wall: Wall, z: number): boolean =>
  wall.level === undefined || onLevel(z, wall.level)

/** Scratch for `wallsAlong`'s answer on a body's level, one per kind (reused by the next call of the same kind, as `wallsNear`'s). */
const onItsLevel: Readonly<Record<WallKind, Array<Wall>>> = {
  walk: [],
  land: [],
  drive: [],
  traffic: [],
}

/**
 * Wall segments that may touch a body of half-extent `pad` moving from (x, y) by (dx, dy): those it
 * meets (`meets`) when its ground stands at `z` (m a.s.l.: a car's wheels, `chassis.z − cg`), every
 * one when `z` is left out. Reused by the next call of the same kind.
 */
export const wallsAlong = (
  kind: WallKind,
  x: number,
  y: number,
  dx: number,
  dy: number,
  pad: number,
  z?: number,
): ReadonlyArray<Wall> => {
  const near = wallsNear(
    kind,
    Math.min(x, x + dx) - pad,
    Math.min(y, y + dy) - pad,
    Math.max(x, x + dx) + pad,
    Math.max(y, y + dy) + pad,
  )
  if (z === undefined) return near
  const out = onItsLevel[kind]
  out.length = 0
  for (const wall of near) if (meets(wall, z)) out.push(wall)
  return out
}

/** Whether a circle of radius `r` at (x, y) overlaps no segment (by more than `slack`). */
export const clearOf = (
  segs: ReadonlyArray<Segment>,
  x: number,
  y: number,
  r: number,
  slack = 0,
): boolean => segs.every((s) => segmentDistance(s, x, y) >= r - slack)

/** Whether a person can stand at `at`: clear of the walk walls they meet standing at `z` (m a.s.l.; every one when left out). */
export const standClear = (at: Vec2.Vec2, z?: number): boolean =>
  clearOf(wallsAlong("walk", at.x, at.y, 0, 0, PERSON_RADIUS + 0.5, z), at.x, at.y, PERSON_RADIUS)

/** How deep (m) circles of radius `r` at `at` + each of `offsets` reach into `segs`; 0 when clear. */
const depthIn = (
  segs: ReadonlyArray<Segment>,
  at: Vec2.Vec2,
  offsets: ReadonlyArray<Vec2.Vec2>,
  r: number,
): number => {
  let depth = 0
  for (const o of offsets)
    for (const s of segs) depth = Math.max(depth, r - segmentDistance(s, at.x + o.x, at.y + o.y))
  return depth
}

/** Whether the straight path `p` -> `q` crosses one of `segs` (a body centre passing through a wall). */
export const crossesAny = (segs: ReadonlyArray<Segment>, p: Vec2.Vec2, q: Vec2.Vec2): boolean =>
  segs.some((s) => {
    const wall = (x: number, y: number) => (s.bx - s.ax) * (y - s.ay) - (s.by - s.ay) * (x - s.ax)
    const path = (x: number, y: number) => (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x)
    return wall(p.x, p.y) * wall(q.x, q.y) < 0 && path(s.ax, s.ay) * path(s.bx, s.by) < 0
  })

/**
 * Of `vehicles`, the one a person at `at` gets into with the action key: the nearest body (the
 * capsule around its circles) within `reach` m (ENTER_GAP), the later one on a tie, with no walk wall
 * between the person and its axis that they meet standing at `z` (m a.s.l.; every one when left
 * out); never one lying on its side or roof, nor a destroyed one. The action (EnterExit) and the HUD
 * prompt (PlayerView) both ask this, through `boardingAt` (rail/boarding.ts).
 */
export const vehicleInReach = <T>(
  at: Vec2.Vec2,
  vehicles: ReadonlyArray<T>,
  bodyOf: (vehicle: T) => {
    readonly model: VehicleModel
    readonly pose: PoseValue
    readonly chassis: ChassisValue
    readonly damage: number
  },
  reach = ENTER_GAP,
  z?: number,
): T | undefined => {
  let best = reach,
    found: T | undefined
  for (const vehicle of vehicles) {
    const { model, pose, chassis, damage } = bodyOf(vehicle)
    if (overturned(chassis) || destroyed(damage)) continue
    const { length, width } = VEHICLES[model]
    const k = length / 2 - width / 2
    const fx = Ops.cos(pose.angle),
      fy = Ops.sin(pose.angle)
    const along = Math.max(-k, Math.min(k, (at.x - pose.x) * fx + (at.y - pose.y) * fy))
    const axis = { x: pose.x + fx * along, y: pose.y + fy * along }
    const dx = at.x - axis.x,
      dy = at.y - axis.y
    const gap = Math.sqrt(dx * dx + dy * dy) - width / 2
    if (gap > best || crossesAny(wallsAlong("walk", at.x, at.y, -dx, -dy, 0.5, z), at, axis))
      continue
    best = gap
    found = vehicle
  }
  return found
}

/**
 * A vehicle may end a move this deep in a wall (m), scrape a little deeper
 * per step up to CAR_DEEPEST (through a tight bend), or stay as deep as it
 * already was; a push-out may carry it at most CAR_PUSH beyond its move (m).
 */
const CAR_SLACK = 0.05
const CAR_SCRAPE = 0.01
const CAR_DEEPEST = 0.1
const CAR_PUSH = 0.25

/**
 * Moves a vehicle at `pose` by `delta`, turned to `heading`, sliding along
 * `segs` (moveCircles); undefined when that is unsound: deeper in a wall than
 * allowed, pushed out too far (a squeeze), or a body circle through a wall.
 */
export const moveCar = (
  model: VehicleModel,
  pose: PoseValue,
  heading: number,
  delta: Vec2.Vec2,
  segs: ReadonlyArray<Segment>,
) => {
  const r = carRadius(model)
  const from = carCircles(model, pose.angle)
  const circles = carCircles(model, heading)
  const { position, blocked } = moveCircles(pose, circles, delta, r, segs)
  const was = depthIn(segs, pose, from, r)
  const sound =
    Vec2.distance(position, pose) <= Vec2.length(delta) + CAR_PUSH &&
    depthIn(segs, position, circles, r) <=
      Math.max(CAR_SLACK, Math.min(was + CAR_SCRAPE, CAR_DEEPEST), was) &&
    circles.every((o, i) => !crossesAny(segs, Vec2.add(pose, from[i]!), Vec2.add(position, o)))
  return sound ? { position, blocked } : undefined
}

/**
 * Whether a vehicle of `model` at `pose`, its wheels at `z` (m a.s.l.), overlaps no wall traffic
 * keeps to on its level, the water's edge included (by more than `slack`).
 */
export const carClear = (model: VehicleModel, pose: PoseValue, z: number, slack = 0): boolean => {
  const segs = wallsAlong("traffic", pose.x, pose.y, 0, 0, VEHICLES[model].length / 2 + 1, z)
  return depthIn(segs, pose, carCircles(model, pose.angle), carRadius(model)) <= slack
}

const CENTRE: ReadonlyArray<Vec2.Vec2> = [Vec2.zero]

/** How far (m) `clearSpot` looks from its goal: past the walls of the largest house round it. */
const CLEAR_WITHIN = 60

/**
 * The spot nearest `at` (to the metre) in the play area, which `SetPlayer` keeps to, where the
 * player fits clear of every structure on the ground there (`atGrade`, where `SetPlayer` sets
 * them): on foot (`model` undefined) standing clear of walk walls and out of every building; in a
 * vehicle of `model` facing `at.angle`, its body clear of the walls traffic keeps to and each of its
 * circles' centres out of every building. `at` itself when it fits; undefined when nothing within
 * `CLEAR_WITHIN` m does. It reads the map within `CLEAR_WITHIN` m and a body's length of `at`: the
 * dev teleport (`main.ts`) asks it.
 */
export const clearSpot = (
  at: PoseValue,
  model: VehicleModel | undefined,
): Vec2.Vec2 | undefined => {
  const circles = model === undefined ? CENTRE : carCircles(model, at.angle)
  const fits = (p: Vec2.Vec2) =>
    inPlay(p.x, p.y) &&
    (model === undefined
      ? standClear(p, atGrade(p.x, p.y))
      : carClear(model, { ...p, angle: at.angle }, atGrade(p.x, p.y))) &&
    circles.every((o) => !indoors(p.x + o.x, p.y + o.y))
  if (fits(at)) return { x: at.x, y: at.y }
  // Rings a metre apart, each sampled about every metre round, from the east anticlockwise.
  for (let r = 1; r <= CLEAR_WITHIN; r++) {
    const n = Math.ceil(2 * Math.PI * r)
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n,
        p = { x: at.x + r * Ops.cos(a), y: at.y + r * Ops.sin(a) }
      if (fits(p)) return p
    }
  }
  return undefined
}

/**
 * Moves a body's circle of radius `r` (a person's by default) from `at` by `delta`, sliding along the
 * walk walls it meets standing at `z` (m a.s.l.; every one when left out) and never through them.
 */
export const walkBy = (at: Vec2.Vec2, delta: Vec2.Vec2, r = PERSON_RADIUS, z?: number) =>
  moveCircles(at, CENTRE, delta, r, wallsAlong("walk", at.x, at.y, delta.x, delta.y, r + 0.5, z))

/** Speed along the heading `angle` (negative when reversing). */
export const forwardSpeed = (
  motion: { readonly vx: number; readonly vy: number },
  angle: number,
): number => motion.vx * Ops.cos(angle) + motion.vy * Ops.sin(angle)

/** `angle` wrapped into [−π, π). */
export const wrapAngle = (angle: number): number => {
  const turns = Math.round(angle / (2 * Math.PI))
  return angle - turns * 2 * Math.PI
}
