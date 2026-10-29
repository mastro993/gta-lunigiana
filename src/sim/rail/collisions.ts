/**
 * What a train runs into along its track, besides what stands on it (./strikes.ts): the buffer stops
 * that end a driven train's track at the drawn run past each terminal, and other trains. The player's
 * train is watched as SCMT watches a train toward a red signal (Lupi's railway course, University of
 * Pisa 2022–23: on overspeed a warning, the traction cut and braking, then the emergency brake): over
 * its braking curve to the buffer, or backing up faster than `REVERSE_MAX`, the traction is cut and
 * the full service brake applied, and `OVER` past it the emergency brake; a train that still reaches
 * the buffer stops dead against it. Trains on one track that meet do so in one dimension and
 * inelastically (restitution 0: a car struck wraps on the nose and is pushed, it is not bounced off):
 * both go on at their common speed, pushed apart to touch. Nothing derails. Pure functions;
 * `TrainPhysics` (./systems.ts) runs them.
 *
 * @module rail/collisions
 */
import { curveSpeed } from "./driver.ts"
import { type Lever, type Longitudinal, REVERSE_MAX } from "./dynamics.ts"
import { DRAWN_RUN, type Line, pointAt, SHARED, sharedPart } from "./lines.ts"
import { spanOf } from "./models.ts"

/** SCMT lets a train run this much over its braking curve before it pulls the emergency brake, m/s: 5 km/h, its continuous supervision's tolerance (segnalifs.it, "SCMT"). */
export const OVER = 5 / 3.6
/** Slower than this, m/s, a train meeting another or a buffer stop only touches it, as when trains couple at a walk: no Impact. */
export const TOUCH_SPEED = 0.5

/** Where a driven train's track ends on `line`: the buffer stops at the drawn run's end past each terminal, s. */
export const buffersOf = (line: Line) => ({ lo: -DRAWN_RUN, hi: line.length + DRAWN_RUN })

/** The end of a train of `length` m with its active cab's nose at s that leads its motion `moving` (±1). */
const leadingEnd = (motion: Longitudinal, length: number, moving: 1 | -1): number => {
  const { lo, hi } = spanOf(motion.s, motion.facing, length)
  return moving > 0 ? hi : lo
}

/**
 * The lever of a driven train of `length` m on `line` (rail keeping `grip`) once SCMT has watched it: the driver's own while under
 * the speed it allows, the least of the braking curve to the buffer stop ahead (the AI's plan: rail/driver.ts) and, backing up,
 * `REVERSE_MAX`; over it the full service brake and no power, and `OVER` past it the emergency brake.
 */
export const supervise = (
  line: Line,
  motion: Longitudinal,
  length: number,
  lever: Lever,
  grip: number,
): Lever => {
  if (motion.v === 0) return lever
  const moving = motion.v > 0 ? 1 : -1,
    lead = leadingEnd(motion, length, moving),
    buffers = buffersOf(line),
    buffer = moving > 0 ? buffers.hi : buffers.lo
  const speed = Math.abs(motion.v),
    rise = pointAt(line, buffer).z - pointAt(line, lead).z
  const curve = curveSpeed(speed, grip, { d: (buffer - lead) * moving, v: 0, rise }),
    allowed = moving === motion.facing ? curve : Math.min(curve, REVERSE_MAX)
  if (speed > allowed + OVER) return { throttle: 0, handbrake: true }
  if (speed > allowed) return { throttle: -moving * motion.facing, handbrake: lever.handbrake }
  return lever
}

/** A train of `length` m kept between `lo` and `hi`: stopped with its end there when it ran past, and how fast it was going then (m/s, 0 when it did not) and where (s). */
export const endStop = (
  motion: Longitudinal,
  length: number,
  lo: number,
  hi: number,
): { readonly s: number; readonly v: number; readonly hit: number; readonly at: number } => {
  const { lo: low, hi: high } = spanOf(motion.s, motion.facing, length)
  const shift = low < lo ? lo - low : high > hi ? hi - high : 0
  if (shift === 0) return { s: motion.s, v: motion.v, hit: 0, at: motion.s }
  return { s: motion.s + shift, v: 0, hit: Math.abs(motion.v), at: shift > 0 ? lo : hi }
}

/** A train as the meeting of trains sees it: whose, on which line, its nose's s, speed toward +s, facing, length (m) and mass (kg). */
export interface Moving {
  readonly id: number
  readonly line: number
  readonly s: number
  readonly v: number
  readonly facing: 1 | -1
  readonly length: number
  readonly mass: number
}

/** Two trains meeting faster than `TOUCH_SPEED`: the one that struck (`car`), the one struck (`other`), where (a line and its s), how hard (the closing speed, m/s) and the reduced mass behind it (tonnes). */
export interface Bump {
  readonly car: number
  readonly other: number
  readonly line: number
  readonly s: number
  readonly speed: number
  readonly mass: number
}

/**
 * Every pair of `trains` whose bodies overlap on the same track (the same line, or track their lines share: `SHARED`) meets: pushed
 * apart to touch, the lighter the more, and, closing, both go on at their common speed. Each meeting closing faster than
 * `TOUCH_SPEED` is a `Bump`, struck by the train that ran faster into the other.
 */
export const meet = (
  trains: ReadonlyArray<Moving>,
): { readonly trains: ReadonlyArray<Moving>; readonly bumps: ReadonlyArray<Bump> } => {
  const out = trains.map((t) => ({ ...t }))
  const bumps: Array<Bump> = []
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]!,
        b = out[j]!,
        mine = spanOf(a.s, a.facing, a.length),
        theirs = spanOf(b.s, b.facing, b.length)
      const parts =
        a.line === b.line
          ? [{ ...theirs, sign: 1 as const }]
          : sharedPart(SHARED[a.line]?.[b.line] ?? [], theirs.lo, theirs.hi)
      for (const part of parts) {
        if (part.hi <= mine.lo || part.lo >= mine.hi) continue
        // Along a's +s: a behind b (its high end into b's low one), or ahead of it.
        const behind = mine.lo + mine.hi < part.lo + part.hi,
          away = behind ? -1 : 1
        const depth = behind ? mine.hi - part.lo : part.hi - mine.lo,
          total = a.mass + b.mass
        const vb = part.sign * b.v,
          intoB = behind ? a.v : -a.v,
          intoA = behind ? -vb : vb,
          closing = intoB + intoA
        a.s += away * depth * (b.mass / total)
        b.s -= part.sign * away * depth * (a.mass / total)
        if (closing <= 0) continue
        const common = (a.mass * a.v + b.mass * vb) / total
        a.v = common
        b.v = part.sign * common
        if (closing > TOUCH_SPEED)
          bumps.push({
            car: intoB >= intoA ? a.id : b.id,
            other: intoB >= intoA ? b.id : a.id,
            line: a.line,
            s: behind ? mine.hi : mine.lo,
            speed: closing,
            mass: (a.mass * b.mass) / total / 1000,
          })
      }
    }
  return { trains: out, bumps }
}
