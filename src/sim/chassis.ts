/**
 * A vehicle as a rigid body on springs: per-model rigs derived once from `VEHICLES` (static wheel
 * loads, springs and dampers, inertias, the steering lock, the body's corners), the body's turn
 * (yaw, then pitch nose-up about its right axis, then roll left-side-up about its forward axis), and
 * the pose a vehicle settles into at rest on the ground.
 *
 * @module chassis
 */
import { Ops } from "@typeonce/ritmo-math"

import { HANDLING_KEYS, type HandlingValue, REAL_HANDLING, tuned } from "./handling.ts"
import { atGrade, groundZ } from "./map/ground.ts"
import type { Surface } from "./map/surface.ts"
import type { ChassisValue, PoseValue } from "./schema.ts"
import { gripsFor, type SurfaceGrip } from "./tyres.ts"
import { VEHICLE_MODELS, VEHICLES, type VehicleModel, type VehicleSpec } from "./vehicles.ts"

/** Gravity, m/s². */
export const GRAVITY = 9.81

/** An offset from the centre of mass in the heading frame: forward, left, up (m). */
export interface Offset {
  readonly f: number
  readonly l: number
  readonly u: number
}

/** One wheel of a rig: where it touches at rest (body frame), its static load (N), spring (N/m) and damper (N·s/m). */
interface RigWheel {
  readonly at: Offset
  readonly load: number
  readonly spring: number
  readonly damper: number
  readonly steered: boolean
  readonly driven: boolean
  /** Share of the brakes' force on this wheel. */
  readonly brake: number
  /** Anti-roll bar stiffness against the other wheel on its axle, N/m. */
  readonly antiRoll: number
}

/** What the physics needs of a model, derived from its spec under a handling. */
export interface Rig {
  /** The model's spec with the handling applied (`tuned`). */
  readonly spec: VehicleSpec
  readonly wheels: ReadonlyArray<RigWheel>
  /** Static spring compression, m (the same at every wheel: one ride frequency). */
  readonly sag: number
  /** Moments of inertia about the roll, pitch and yaw axes, kg·m². */
  readonly ix: number
  readonly iy: number
  readonly iz: number
  /** Front-to-rear axle distance and the rear axle's distance behind the centre of mass, m. */
  readonly wheelbase: number
  readonly rear: number
  /** Steering lock, rad. */
  readonly lock: number
  /** Static rollover threshold, g: the centre of mass's distance inside the nearest edge of the wheels' footprint over its height. */
  readonly tipping: number
  /** For each wheel, the other wheel on its axle (anti-roll bar), or −1. */
  readonly partner: ReadonlyArray<number>
  /** The body box's eight corners (body frame): the underbody's four, then the roof's four. */
  readonly corners: ReadonlyArray<Offset>
  /** Each surface's grip dry and wet, loose ground's loss scaled by the handling, and the share of the weather's loss of grip that counts (1 real). */
  readonly grips: Readonly<Record<Surface, SurfaceGrip>>
  readonly weatherGrip: number
  /** Share of a tyre force's lever about the centre of mass that tilts the body (1 real: the weight transfer). */
  readonly transfer: number
  /** Multipliers of the steering lock at speed and of the steering's speed. */
  readonly steering: number
  readonly steeringRate: number
  /** The arcade assists (`assists.ts`): the stability assist's strength (0 off … 1), and self-righting (0 off, 1 on). */
  readonly stability: number
  readonly selfRighting: number
}

const rig = (model: VehicleModel, handling: HandlingValue): Rig => {
  const spec = tuned(VEHICLES[model], handling)
  const xs = spec.wheels.map((w) => w.x),
    front = Math.max(...xs),
    back = Math.min(...xs),
    wheelbase = front - back
  const onFront = spec.wheels.filter((w) => w.x === front).length,
    onRear = spec.wheels.length - onFront
  const omega = 2 * Math.PI * spec.ride.hz
  const wheels = spec.wheels.map((w): RigWheel => {
    const isFront = w.x === front
    // Lever rule between the two axles, split evenly across each axle.
    const share = (isFront ? -back / wheelbase : front / wheelbase) / (isFront ? onFront : onRear)
    const mass = spec.mass * share
    const spring = mass * omega * omega
    return {
      at: { f: w.x, l: w.y, u: -spec.cg },
      load: mass * GRAVITY,
      spring,
      damper: 2 * spec.ride.damping * Math.sqrt(spring * mass),
      steered: w.steered,
      driven: w.driven,
      brake: (isFront ? spec.brakes.front : 1 - spec.brakes.front) / (isFront ? onFront : onRear),
      antiRoll: spring * spec.ride.antiRoll[isFront ? 0 : 1],
    }
  })
  const { length: l, width: w, height: h, mass: m } = spec
  const rear = -back
  const corners: Array<Offset> = []
  for (const u of [spec.clearance - spec.cg, h - spec.cg])
    for (const [f, s] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const)
      corners.push({ f: (f * l) / 2, l: (s * w) / 2, u })
  // The footprint's edges, the wheels taken round the centre of mass.
  const ring = [...spec.wheels].sort((a, b) => Ops.atan2(a.y, a.x) - Ops.atan2(b.y, b.x))
  let inside = Number.MAX_VALUE
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!,
      ex = b.x - a.x,
      ey = b.y - a.y
    inside = Math.min(inside, Math.abs(a.x * ey - a.y * ex) / Math.sqrt(ex * ex + ey * ey))
  })
  const partner = spec.wheels.map((w, i) => spec.wheels.findIndex((o, j) => j !== i && o.x === w.x))
  return {
    spec,
    wheels,
    sag: GRAVITY / (omega * omega),
    tipping: inside / spec.cg,
    partner,
    ix: (m * (w * w + h * h)) / 12,
    iy: (m * (l * l + h * h)) / 12,
    iz: (m * (l * l + w * w)) / 12,
    wheelbase,
    rear,
    lock: Ops.atan(
      wheelbase / Math.sqrt(Math.max(0.25, spec.turnRadius * spec.turnRadius - rear * rear)),
    ),
    corners,
    grips: gripsFor(handling.looseGround),
    weatherGrip: handling.weatherGrip,
    transfer: handling.weightTransfer,
    steering: handling.steering,
    steeringRate: handling.steeringRate,
    stability: handling.stability,
    selfRighting: handling.selfRighting,
  }
}

/** Every model's rig as its data says (`REAL_HANDLING`). */
export const RIGS = {
  panda: rig("panda", REAL_HANDLING),
  ape: rig("ape", REAL_HANDLING),
  truck: rig("truck", REAL_HANDLING),
  carabinieri: rig("carabinieri", REAL_HANDLING),
} satisfies Record<VehicleModel, Rig>

/** The last tuned rigs, by model and handling: the handling changes rarely, and a rig is cheap but not free to derive every step. */
const tunedRigs = new Map<string, Rig>()
const TUNED_KEPT = 16
/** A handling as a cache key, its knobs in menu order. */
const keyOf = (handling: HandlingValue): string =>
  HANDLING_KEYS.map((key) => handling[key]).join(" ")
const REAL_KEY = keyOf(REAL_HANDLING)

/** Model `model`'s rig under `handling`: `RIGS` while every knob is real. */
export const rigFor = (model: VehicleModel, handling: HandlingValue): Rig => {
  const knobs = keyOf(handling)
  if (knobs === REAL_KEY) return RIGS[model]
  const key = `${model} ${knobs}`,
    found = tunedRigs.get(key)
  if (found !== undefined) return found
  if (tunedRigs.size >= TUNED_KEPT * VEHICLE_MODELS.length) tunedRigs.clear()
  const made = rig(model, handling)
  tunedRigs.set(key, made)
  return made
}

/** The trig of a body's pitch and roll, computed once per use. */
interface Tilt {
  readonly cp: number
  readonly sp: number
  readonly cr: number
  readonly sr: number
}

/** `pitch` and `roll` as a Tilt. */
export const tiltOf = (pitch: number, roll: number): Tilt => ({
  cp: Ops.cos(pitch),
  sp: Ops.sin(pitch),
  cr: Ops.cos(roll),
  sr: Ops.sin(roll),
})

/** Body-frame offset `b` turned by the body's pitch and roll: the same offset in the heading frame. */
export const turn = (b: Offset, t: Tilt): Offset => {
  const l = b.l * t.cr - b.u * t.sr,
    u = b.l * t.sr + b.u * t.cr
  return { f: b.f * t.cp - u * t.sp, l, u: b.f * t.sp + u * t.cp }
}

/** Height of the body's up axis (1 upright, 0 on its side, −1 on its roof). */
export const uprightness = (chassis: Pick<ChassisValue, "pitch" | "roll">): number =>
  Ops.cos(chassis.pitch) * Ops.cos(chassis.roll)

/** Past this uprightness (≈ 60°) the wheels no longer carry the body: it lies on its side or roof. */
export const WHEELS_DOWN = 0.5

/** Whether a vehicle lies on its side or roof: it cannot be driven or entered. */
export const overturned = (chassis: Pick<ChassisValue, "pitch" | "roll">): boolean =>
  uprightness(chassis) < WHEELS_DOWN

/**
 * Whether the body's box touches the ground (`ground` at the level the vehicle stands on): a corner at or under it, as the physics's
 * hull contacts take it, down on its belly, side or roof. The suspension at its bump stops keeps the underbody off the ground.
 */
export const hullDown = (
  model: VehicleModel,
  pose: PoseValue,
  chassis: ChassisValue,
  ground: (x: number, y: number, near?: number) => number = groundZ,
): boolean => {
  const tilt = tiltOf(chassis.pitch, chassis.roll),
    c = Ops.cos(pose.angle),
    s = Ops.sin(pose.angle),
    level = chassis.z - VEHICLES[model].cg
  return RIGS[model].corners.some((corner) => {
    const o = turn(corner, tilt)
    return chassis.z + o.u <= ground(pose.x + o.f * c - o.l * s, pose.y + o.f * s + o.l * c, level)
  })
}

/**
 * The plane through the ground under a vehicle's wheels at `pose` (least squares in the heading
 * frame) of `ground`: its elevation at the centre and its rise per metre forward and to the left.
 */
const groundPlane = (
  model: VehicleModel,
  pose: PoseValue,
  ground: (x: number, y: number) => number,
) => {
  const { wheels } = RIGS[model]
  const c = Ops.cos(pose.angle),
    s = Ops.sin(pose.angle)
  const zs = wheels.map((w) =>
    ground(pose.x + w.at.f * c - w.at.l * s, pose.y + w.at.f * s + w.at.l * c),
  )
  return fitPlane(
    wheels.map((w) => w.at),
    zs,
  )
}

/** Least-squares plane z = a + gf·f + gl·l through heights `zs` at the (f, l) of `at` (a lateral line of wheels gets no side slope). */
export const fitPlane = (at: ReadonlyArray<Offset>, zs: ReadonlyArray<number>) => {
  const n = at.length
  let mf = 0,
    ml = 0,
    mz = 0
  for (let i = 0; i < n; i++) [mf, ml, mz] = [mf + at[i]!.f / n, ml + at[i]!.l / n, mz + zs[i]! / n]
  let sff = 0,
    sll = 0,
    sfl = 0,
    sfz = 0,
    slz = 0
  for (let i = 0; i < n; i++) {
    const df = at[i]!.f - mf,
      dl = at[i]!.l - ml,
      dz = zs[i]! - mz
    sff += df * df
    sll += dl * dl
    sfl += df * dl
    sfz += df * dz
    slz += dl * dz
  }
  const det = sff * sll - sfl * sfl
  const gf = det > 1e-9 ? (sfz * sll - slz * sfl) / det : sff > 1e-9 ? sfz / sff : 0
  const gl = det > 1e-9 ? (slz * sff - sfz * sfl) / det : 0
  return { z: mz - gf * mf - gl * ml, gf, gl }
}

/** A vehicle of `model` at rest on `ground` (the map's at grade) at `pose`: on its springs, tilted with the ground, in first gear. */
export const settle = (
  model: VehicleModel,
  pose: PoseValue,
  ground: (x: number, y: number) => number = atGrade,
): ChassisValue => {
  const plane = groundPlane(model, pose, ground)
  const pitch = Ops.atan(plane.gf),
    roll = Ops.atan(plane.gl)
  return resting(plane.z + RIGS[model].spec.cg * Ops.cos(pitch) * Ops.cos(roll), pitch, roll)
}

/** A chassis standing still on its springs with its centre of mass at `z` (m a.s.l.), pitched and rolled (rad), in neutral. */
export const resting = (z: number, pitch: number, roll: number): ChassisValue => ({
  z,
  vz: 0,
  pitch,
  pitchRate: 0,
  roll,
  rollRate: 0,
  steer: 0,
  gear: 0,
  shiftUntil: 0,
})
