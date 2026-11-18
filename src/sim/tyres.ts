/**
 * The tyre: how much grip each surface gives, and the force one tyre's contact patch makes from its
 * load, its slip and what the driver asks of it. Sideways, the force rises with the slip angle to a
 * peak and falls toward sliding friction past it; along the tyre it is the drive, the brakes and the
 * rolling resistance, all inside one friction ellipse. A wheel asked for more than its grip spins
 * (drive) or locks (brakes, the handbrake) and slides; ABS and traction control hold it at the peak
 * instead. Nearly standing, the patch grips like static friction: it holds the car on a slope. Wet
 * ground and snow cover take grip away (`weathered`).
 *
 * @module tyres
 */
import { Ops } from "@typeonce/ritmo-math"

import type { Surface } from "./map/surface.ts"
import type { GroundWeather } from "./sky/local.ts"

/** Grip of one surface: peak friction coefficient, sliding friction as a share of it, rolling resistance coefficient. */
export interface Grip {
  readonly mu: number
  readonly slide: number
  readonly roll: number
}

/**
 * Per surface, for a car tyre (the model's `tyres.grip` scales it): dry asphalt (peak about 1.1,
 * a locked wheel 0.7–0.9 of it), stone setts and paving, loose gravel, dirt tracks, grass, the
 * forest floor and a beach's dry sand. Loose ground slides almost as well as it grips (a flat peak);
 * rolling resistance from 0.013 on asphalt to 0.07 in a field and 0.3 in sand.
 */
const GRIP = {
  asphalt: { mu: 1.1, slide: 0.7, roll: 0.013 },
  stone: { mu: 0.9, slide: 0.75, roll: 0.016 },
  gravel: { mu: 0.62, slide: 0.9, roll: 0.03 },
  dirt: { mu: 0.6, slide: 0.85, roll: 0.045 },
  grass: { mu: 0.45, slide: 0.8, roll: 0.07 },
  leaves: { mu: 0.5, slide: 0.8, roll: 0.06 },
  // A tyre in dry sand grips by shearing it: its peak is the sand's own friction, tan φ with φ 28–30° for
  // the Land Locomotion Laboratory's dry sand (Wong, Theory of Ground Vehicles; c ≈ 1 kPa adds nothing at a
  // tyre's 200 kPa). Loose sand's shear stress climbs to that and holds it as the slip grows (the
  // Janosi–Hanamoto curve, in Wong), with no peak to fall from, so a sliding tyre keeps 0.95 of it. The
  // tyre sinks and ploughs: 0.30 for car tyres in sand against 0.015 on concrete (Wong, 2nd ed. 1993, p. 17).
  sand: { mu: 0.55, slide: 0.95, roll: 0.3 },
} as const satisfies Record<Surface, Grip>

/**
 * Per surface, wet: asphalt keeps about 0.72 of its dry peak (a wet road's 0.7–0.8 against about 1.1
 * dry) and a locked wheel slides on less of it; wet setts and paving keep 0.65, gravel 0.9 (it drains),
 * a dirt track turned to mud 0.65, wet grass 0.7 and wet leaves 0.65, rolling a little harder. Sand
 * alone firms up: the water binds its grains, so the tyre sinks less and rolls easier.
 */
const WET = {
  asphalt: { mu: GRIP.asphalt.mu * 0.72, slide: 0.65, roll: 0.015 },
  stone: { mu: GRIP.stone.mu * 0.65, slide: 0.7, roll: 0.018 },
  gravel: { mu: GRIP.gravel.mu * 0.9, slide: 0.9, roll: 0.033 },
  dirt: { mu: GRIP.dirt.mu * 0.65, slide: 0.85, roll: 0.06 },
  grass: { mu: GRIP.grass.mu * 0.7, slide: 0.75, roll: 0.075 },
  leaves: { mu: GRIP.leaves.mu * 0.65, slide: 0.75, roll: 0.065 },
  // Wet sands carry vehicles better than dry-to-moist ones, beach or desert alike (WES Technical Memorandum
  // 3-240, 15th supplement, 1959): the same peak (it drains, nothing greases it) and half the rolling
  // resistance, between dry sand's 0.30 and medium-hard soil's 0.08 (Wong, p. 17). Estimated: no tyre measured.
  sand: { mu: GRIP.sand.mu, slide: 0.95, roll: 0.15 },
} as const satisfies Record<Surface, Grip>

/** Packed snow over any surface: a peak of about 0.3, sliding almost as well, rolling through it harder. */
const SNOW: Grip = { mu: 0.3, slide: 0.85, roll: 0.03 }

/** One surface's grip dry and wet. */
export interface SurfaceGrip {
  readonly dry: Grip
  readonly wet: Grip
}

/** `a` toward `b` by `share`. */
const mix = (a: Grip, b: Grip, share: number): Grip => ({
  mu: a.mu + (b.mu - a.mu) * share,
  slide: a.slide + (b.slide - a.slide) * share,
  roll: a.roll + (b.roll - a.roll) * share,
})

/** Every surface's grip, dry and wet, with loose ground's difference from asphalt scaled by `loose`: 1 is real, 0 grips and rolls like asphalt everywhere. */
export const gripsFor = (loose: number): Readonly<Record<Surface, SurfaceGrip>> => {
  const blend = (surface: Surface): SurfaceGrip => ({
    dry: mix(GRIP.asphalt, GRIP[surface], loose),
    wet: mix(WET.asphalt, WET[surface], loose),
  })
  return {
    asphalt: blend("asphalt"),
    stone: blend("stone"),
    gravel: blend("gravel"),
    dirt: blend("dirt"),
    grass: blend("grass"),
    leaves: blend("leaves"),
    sand: blend("sand"),
  }
}

/**
 * A surface's grip on `ground`: dry toward wet by its wetness, then toward packed snow by its snow cover,
 * the weather's difference from dry scaled by `share` (the handling's weather grip loss: 1 real, 0 dry
 * whatever the weather).
 */
export const weathered = (grip: SurfaceGrip, ground: GroundWeather, share: number): Grip =>
  ground.wet === 0 && ground.snow === 0
    ? grip.dry
    : mix(grip.dry, mix(mix(grip.dry, grip.wet, ground.wet), SNOW, ground.snow), share)

/** How much of a road's dry grip `ground` leaves under weather grip loss `share`: 1 dry, about 0.72 wet, 0.27 on snow (real). */
export const weatherFactor = (ground: GroundWeather, share: number): number =>
  weathered({ dry: GRIP.asphalt, wet: WET.asphalt }, ground, share).mu / GRIP.asphalt.mu

/** A tyre grips this much less per unit of load over its static load (and more under less): a loaded tyre's friction coefficient falls. */
const LOAD_SENSITIVITY = 0.12

/** Friction coefficient `mu` of a tyre carrying `load` against its static `rest` load. */
export const loaded = (mu: number, load: number, rest: number): number =>
  mu * Math.max(0.6, Math.min(1.15, 1 - LOAD_SENSITIVITY * (load / rest - 1)))

/** Below this patch speed (m/s) a tyre grips like static friction, blending into the slip model up to it. */
const STATIC = 0.5
/** Slip angles are taken against at least this rolling speed (m/s), so a crawling car does not divide by zero. */
const CRAWL = 1.5
/** A spinning wheel keeps this share of its sideways grip. */
const SPIN_SIDE = 0.4
/** ABS and traction control hold the tyre at this share of its grip, leaving some to steer with. */
const ABS = 0.85

/** What a tyre is asked for this substep. Forces in N, speeds in m/s, in the wheel's frame (x along it, y to its left). */
export interface TyreIn {
  /** Normal load, N. */
  readonly load: number
  /** Peak friction coefficient here (surface × tyre) and the sliding share of it. */
  readonly mu: number
  readonly slide: number
  /** Rolling resistance coefficient. */
  readonly roll: number
  /** Slip angle of peak sideways force, rad. */
  readonly peak: number
  /** Contact patch velocity. */
  readonly vx: number
  readonly vy: number
  /** Drive force from the engine (+x forward). */
  readonly drive: number
  /** Brake force available (≥ 0), and whether the handbrake locks this wheel. */
  readonly brake: number
  readonly locked: boolean
  readonly abs: boolean
  readonly traction: boolean
  /** The force that would bring the patch to rest this substep, slope included (static friction's demand). */
  readonly holdX: number
  readonly holdY: number
}

/** The tyre's force, and how far past its grip it slides: `amount` 0…1 and the sliding speed `slip`, m/s. */
interface TyreOut {
  readonly fx: number
  readonly fy: number
  readonly amount: number
  readonly slip: number
}

/** Sideways force as a share of the peak at `x` = slip angle / peak slip angle: a smooth rise to 1 at the peak, then a fall toward `slide`. */
export const lateralCurve = (x: number, slide: number): number =>
  x <= 1 ? x * (1.5 - 0.5 * x * x) : slide + (1 - slide) / (1 + 0.5 * (x - 1) * (x - 1))

const clampTo = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v))

/** Static friction: the hold force, inside the friction circle; the free-rolling direction only resists by rolling resistance. */
const holding = (t: TyreIn, free: boolean): TyreOut => {
  const max = t.mu * t.load
  const hx = free ? clampTo(t.holdX, t.roll * t.load) + t.drive : t.holdX + t.drive
  const length = Math.sqrt(hx * hx + t.holdY * t.holdY),
    scale = length > max ? max / length : 1
  return { fx: hx * scale, fy: t.holdY * scale, amount: 0, slip: 0 }
}

/** Rolling or sliding: the slip model. */
const slipping = (t: TyreIn): TyreOut => {
  const max = t.mu * t.load,
    sliding = max * t.slide
  const speed = Math.sqrt(t.vx * t.vx + t.vy * t.vy)
  const angle = Ops.atan2(Math.abs(t.vy), Math.max(Math.abs(t.vx), CRAWL))
  const x = angle / t.peak
  const side = -Math.sign(t.vy) * max * lateralCurve(x, t.slide)
  const past = x > 1 ? Math.min(1, (x - 1) / 1.5) : 0
  const along = Math.sign(t.vx)
  // A locked wheel slides against its motion, whichever way that is.
  const lock = t.locked || (!t.abs && t.brake > max && Math.abs(t.vx) > STATIC)
  if (lock && speed > 1e-6)
    return { fx: (-sliding * t.vx) / speed, fy: (-sliding * t.vy) / speed, amount: 1, slip: speed }
  const brake = Math.min(t.brake, t.abs ? ABS * max : t.brake)
  // Traction control leaves the tyre what it needs to corner: the drive takes only the rest of the ellipse.
  const drive = t.traction
    ? clampTo(t.drive, ABS * Math.sqrt(Math.max(0, max * max - side * side)))
    : t.drive
  const fx = clampTo(drive - along * (brake + t.roll * t.load), max)
  const ellipse = Math.sqrt(Math.max(0, 1 - (fx / max) * (fx / max)))
  const abs = t.abs && t.brake > ABS * max && Math.abs(t.vx) > STATIC ? 0.25 : 0
  return {
    fx,
    fy: side * ellipse,
    amount: Math.max(past, abs),
    slip: past > 0 ? Math.abs(t.vy) : abs > 0 ? Math.abs(t.vx) * 0.1 : 0,
  }
}

/**
 * Wheelspin: the drive asks more than the grip, and the patch slips along the tyre at about the excess. It pushes with sliding
 * friction, less the rolling resistance of the ground it rolls over as the car moves: a wheel spinning in sand still sinks and
 * ploughs, so it digs in.
 */
const spinning = (t: TyreIn, speed: number): TyreOut => {
  const max = t.mu * t.load,
    sliding = max * t.slide
  const side =
    speed < STATIC
      ? clampTo(t.holdY, sliding * SPIN_SIDE)
      : -Math.sign(t.vy) *
        sliding *
        SPIN_SIDE *
        lateralCurve(Ops.atan2(Math.abs(t.vy), Math.max(Math.abs(t.vx), CRAWL)) / t.peak, t.slide)
  return {
    fx: clampTo(Math.sign(t.drive) * sliding - Math.sign(t.vx) * t.roll * t.load, max),
    fy: side,
    amount: 1,
    slip: Math.min(15, 2 + 8 * (Math.abs(t.drive) / max - 1)),
  }
}

/** The force of one tyre this substep. */
export const tyreForce = (t: TyreIn): TyreOut => {
  if (t.load <= 0) return { fx: 0, fy: 0, amount: 0, slip: 0 }
  const speed = Math.sqrt(t.vx * t.vx + t.vy * t.vy)
  if (!t.traction && !t.locked && Math.abs(t.drive) > t.mu * t.load) return spinning(t, speed)
  // Free along the tyre when neither braked nor locked: only rolling resistance holds it.
  const free = !t.locked && t.brake === 0
  if (speed >= STATIC) return slipping(t)
  const hold = holding(t, free)
  const blend = speed / STATIC
  if (blend === 0) return hold
  const slip = slipping(t)
  return {
    fx: hold.fx + (slip.fx - hold.fx) * blend,
    fy: hold.fy + (slip.fy - hold.fy) * blend,
    amount: slip.amount * blend,
    slip: slip.slip * blend,
  }
}
