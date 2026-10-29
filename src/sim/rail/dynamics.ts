/**
 * A train's longitudinal dynamics, one rigid body along its line (as OpenRails and TrainRuns.jl model it):
 * `m·ξ·dv/dt = traction − brakes − (A + B·v + C·v²) − m·g·grade − m·g·curve`. Traction is the least of
 * the starting force, the power over the speed and the driven axles' adhesion (Curtius–Kniffler,
 * lowered by wet rail and snow); brakes are a share of the emergency rate, held to the rail's adhesion;
 * the curve's drag is Röckl's. Brakes, the running resistance and the curve's drag never reverse a
 * train: they act like static friction at a standstill, where only the grade (and traction) can move
 * it. The controls ease: power over `POWER_EASE`, brakes over `BRAKE_EASE`. Pure functions of the
 * spec and the step; `TrainPhysics` (./systems.ts) runs them.
 *
 * Sources: OpenRails' Curtius–Kniffler constants (7.5, 44, 0.161), its rain factor and RAIB Report
 * 25/2006's adhesion figures for the wet rail, Wikipedia "Curve resistance (railroad)" for Röckl's
 * formula, Dittus et al. 2011 for the Davis terms (in models.ts).
 *
 * @module rail/dynamics
 */
import type { GroundWeather } from "../sky/local.ts"
import type { TrainSpec } from "./models.ts"

/** Gravity, m/s². */
export const G = 9.81
/** Seconds the power takes from none to full (and back): the engines spooling and the converters filling. */
const POWER_EASE = 2
/** Seconds the brakes take from released to full: the brake cylinders filling. */
export const BRAKE_EASE = 1.5
/** Below this speed (m/s) with the lever at rest the brakes hold the train, as a driver's would. */
export const HOLD_SPEED = 0.5
/** The fastest a train backs up, m/s (30 km/h, SCMT's release speed): its power cuts out past it, and a driven train's SCMT brakes it (rail/collisions.ts). */
export const REVERSE_MAX = 30 / 3.6
/** The share of the rail's adhesion the brakes can use before the wheel-slide protection sheds them. */
const BRAKE_ADHESION = 0.9
/** Below this speed traction takes its force from the starting effort (P/v would blow up), m/s. */
const CRAWL = 0.1

/** Wheel–rail adhesion on clean, dry rail at `v` m/s (Curtius–Kniffler): 0.33 at rest, 0.23 at 60 km/h. */
export const adhesion = (v: number): number => 7.5 / (3.6 * Math.abs(v) + 44) + 0.161

/** How much of its dry adhesion the rail keeps under the weather: 1 dry, 0.6 soaked (OpenRails' rain floor), half under snow. */
export const railGrip = (ground: GroundWeather): number =>
  (1 - 0.4 * ground.wet) * (1 - 0.5 * ground.snow)

/** Röckl's curve resistance at `curvature` (1/m) as a share of the weight: 650/(R − 55) N/kN from 300 m up, 500/(R − 30) under. */
export const curveDrag = (curvature: number): number => {
  const r = 1 / Math.max(1e-6, Math.abs(curvature))
  return r >= 300 ? 0.65 / (r - 55) : 0.5 / Math.max(r - 30, 10)
}

/** The running resistance at `v` m/s, N (always ≥ 0: it opposes the motion). */
export const resistance = (spec: TrainSpec, v: number): number => {
  const speed = Math.abs(v)
  return spec.davis.a + spec.davis.b * speed + spec.davis.c * speed * speed
}

/** The most traction at `v` m/s with the power at `share` (0…1) of full, on rail that keeps `grip` of its adhesion, N. */
export const tractionAt = (spec: TrainSpec, v: number, share: number, grip: number): number =>
  Math.min(
    spec.startForce * share,
    (spec.power * share) / Math.max(Math.abs(v), CRAWL),
    adhesion(v) * grip * spec.adhesive * spec.mass * G,
  )

/** The brake force with the brakes at `share` of the emergency rate, held to the rail's adhesion, N. */
const brakeForce = (spec: TrainSpec, v: number, share: number, grip: number): number =>
  Math.min(
    share * spec.mass * spec.rotating * spec.emergency,
    BRAKE_ADHESION * adhesion(v) * grip * spec.mass * G,
  )

/** The full service brake as a share of the emergency rate (the lever's full brake). */
export const serviceShare = (spec: TrainSpec): number => spec.service / spec.emergency

/** A train's motion along its line: the active cab's nose at `s`, speed `v` toward +s, the cab's `facing`, eased `power` (−1…1, + toward the facing) and `brake` (0…1 of the emergency rate). */
export interface Longitudinal {
  readonly s: number
  readonly v: number
  readonly facing: 1 | -1
  readonly power: number
  readonly brake: number
}

/** The driver's lever: `throttle` −1…1 (+ toward the cab's facing, against the motion the brake, from rest backwards), `handbrake` the emergency brake. */
export interface Lever {
  readonly throttle: number
  readonly handbrake: boolean
}

/** The track under the train this step: its `grade` (rise per metre toward +s over its length), `curvature` (1/m) and the rail's `grip`. */
export interface TrackUnder {
  readonly grade: number
  readonly curvature: number
  readonly grip: number
}

/** Where the lever sends the power and the brakes: the throttle along the motion (or from rest) is power, against it the brake. */
const targets = (spec: TrainSpec, motion: Longitudinal, lever: Lever) => {
  if (lever.handbrake) return { power: 0, brake: 1 }
  const t = Math.max(-1, Math.min(1, lever.throttle))
  if (t === 0) return { power: 0, brake: Math.abs(motion.v) < HOLD_SPEED ? serviceShare(spec) : 0 }
  const moving = Math.abs(motion.v) < HOLD_SPEED ? 0 : Math.sign(motion.v),
    pushes = Math.sign(t) * motion.facing
  if (moving !== 0 && pushes !== moving)
    return { power: 0, brake: Math.abs(t) * serviceShare(spec) }
  return { power: t, brake: 0 }
}

/** `value` moved toward `target` by at most `most`. */
const ease = (value: number, target: number, most: number): number =>
  value + Math.max(-most, Math.min(most, target - value))

/**
 * One step of `dt` s: the lever eases the power and the brakes, the forces move the train, and the
 * new s and v. A train the resisting forces bring to a stop stays stopped this step.
 */
export const stepTrain = (
  spec: TrainSpec,
  motion: Longitudinal,
  lever: Lever,
  track: TrackUnder,
  dt: number,
): Longitudinal => {
  const target = targets(spec, motion, lever)
  const power = ease(motion.power, target.power, dt / POWER_EASE),
    brake = ease(motion.brake, target.brake, dt / BRAKE_EASE)
  const { v, facing } = motion,
    toward = Math.sign(power) * facing,
    fwd = v * toward
  // Traction cuts out past the top speed, and backing up past REVERSE_MAX.
  const cut = fwd > spec.vmax || (power < 0 && fwd > REVERSE_MAX)
  const traction =
    cut || power === 0 ? 0 : toward * tractionAt(spec, v, Math.abs(power), track.grip)
  const drive = traction - spec.mass * G * track.grade
  const resist = (speed: number) =>
    brakeForce(spec, speed, brake, track.grip) +
    resistance(spec, speed) +
    spec.mass * G * curveDrag(track.curvature)
  const inertia = spec.mass * spec.rotating
  let next: number
  if (v === 0) {
    // At rest the resisting forces hold it like static friction: only a stronger push moves it.
    const held = resist(0)
    next = Math.abs(drive) > held ? ((drive - Math.sign(drive) * held) / inertia) * dt : 0
  } else {
    next = v + ((drive - Math.sign(v) * resist(v)) / inertia) * dt
    if (Math.sign(next) !== Math.sign(v)) next = 0
  }
  return { s: motion.s + next * dt, v: next, facing, power, brake }
}
