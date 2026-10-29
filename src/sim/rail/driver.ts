/**
 * How an AI driver works its lever: the speed it may run at now is the least of the line speed and
 * the braking curves to everything ahead it must meet slower (a lower limit, a station's stop point, a
 * train ahead, a crossing not yet closed), each planned at the deceleration the rail allows there,
 * `min(PLAN_DECEL, 0.8·μ(v)·grip·g + g·rise/distance)`, and begun early by the brakes' ease time. It
 * follows that speed, or the curve it is on, by asking the dynamics for the force it needs.
 * Pure functions; `TrainAI` (./service.ts) gathers the targets.
 *
 * @module rail/driver
 */
import {
  adhesion,
  BRAKE_EASE,
  curveDrag,
  G,
  HOLD_SPEED,
  resistance,
  serviceShare,
  tractionAt,
  type TrackUnder,
} from "./dynamics.ts"
import type { TrainSpec } from "./models.ts"

/** The deceleration an AI driver plans its stops on, m/s²: RAIB's step 2 of 3, a regional train's usual stop. */
const PLAN_DECEL = 0.6
/** The share of the rail's adhesion a plan counts on (the wheel-slide protection sheds braking past 0.9 of it). */
const PLAN_ADHESION = 0.8
/** A plan's grade is taken over at least this much track ahead, m. */
const PLAN_REACH = 20
/** How fast the driver closes on the speed it wants, 1/s (a speed 2 m/s off asks for 1 m/s²). */
const GAIN = 0.5
/** How far under the speed it may run at (m/s) a driver on a braking curve already brakes along it. */
const SLACK = 0.5

/** Something ahead to meet at `v` m/s or slower, `d` m ahead of the head along its run, the rail rising `rise` m to it. */
export interface Target {
  readonly d: number
  readonly v: number
  readonly rise: number
}

/** How far a driver at `v` m/s plans to stop in on good rail, m: `PLAN_DECEL`, begun the brakes' ease time early (499 m from 85 km/h). */
export const brakingDistance = (v: number): number => (v * v) / (2 * PLAN_DECEL) + v * BRAKE_EASE

/** The deceleration a driver plans on to meet a target `d` m ahead rising `rise` m, at `fwd` m/s on rail keeping `grip`, m/s². */
const planDecel = (fwd: number, grip: number, d: number, rise: number): number =>
  Math.min(
    PLAN_DECEL,
    PLAN_ADHESION * adhesion(fwd) * grip * G + (G * rise) / Math.max(d, PLAN_REACH),
  )

/** How fast a train at `fwd` m/s on rail keeping `grip` may run now to meet `target` on its braking curve (begun `BRAKE_EASE` s early). */
export const curveSpeed = (fwd: number, grip: number, target: Target): number =>
  Math.sqrt(
    target.v * target.v +
      2 * planDecel(fwd, grip, target.d, target.rise) * Math.max(0, target.d - fwd * BRAKE_EASE),
  )

/**
 * The lever for an AI train running `fwd` m/s along its run under `limit` m/s with `targets` ahead,
 * on `track` (its grade and curvature toward +s, `dir` its run): −1 full service brake … 1 full power.
 */
export const leverFor = (
  spec: TrainSpec,
  fwd: number,
  dir: 1 | -1,
  limit: number,
  targets: ReadonlyArray<Target>,
  track: TrackUnder,
): number => {
  let allowed = limit,
    binding: Target | undefined
  for (const target of targets) {
    const v = curveSpeed(fwd, track.grip, target)
    if (v < allowed) [allowed, binding] = [v, target]
  }
  // Nearly there and nearly stopped: the lever at rest, and the brakes hold it.
  if (allowed < HOLD_SPEED && fwd < HOLD_SPEED) return 0
  // On a braking curve: the deceleration that meets its target from here; else close on the speed.
  const lead = binding === undefined ? 0 : binding.d - fwd * BRAKE_EASE
  const want =
    binding !== undefined && fwd > allowed - SLACK && lead > 0
      ? -Math.max(0, fwd * fwd - binding.v * binding.v) / (2 * lead)
      : GAIN * (allowed - fwd)
  // What the train does on its own: running resistance, the curve's drag and the grade along its run.
  const inertia = spec.mass * spec.rotating
  const natural =
    (resistance(spec, fwd) + spec.mass * G * (curveDrag(track.curvature) + track.grade * dir)) /
    inertia
  const force = (want + natural) * inertia
  if (force > 0) return Math.min(1, force / Math.max(1, tractionAt(spec, fwd, 1, track.grip)))
  return -Math.min(1, -force / (spec.mass * spec.rotating * spec.emergency) / serviceShare(spec))
}
