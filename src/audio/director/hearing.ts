/**
 * One source's way to the listener (physics.md §0): every loss in dB, summed and converted once.
 * Spreading, the ground effect (more over snow), foliage, the worst edge in the way and the
 * listener's cabin set the level at the ears; the masking rule fades and culls it against the
 * ambient floor; air, the edge and the cabin set the lowpass; the motion of both ends sets the
 * Doppler shift; the street around the listener and the distance set the reverb send (none in the
 * open, half under snow). No map lookups here (the caller measures the ground and the obstacles),
 * so the audition page hears through the same chain.
 *
 * @module audio/director/hearing
 */
import {
  airCutoff,
  audibility,
  type Cabin,
  dbToGain,
  delayOf,
  diffraction,
  doppler,
  foliageLoss,
  groundLoss,
  mixGain,
  panOf,
  snowLoss,
  spreading,
} from "../acoustics.ts"
import type { Placement } from "../types.ts"
import { DELAY_FROM, REVERB } from "./levels.ts"

/** The listener's ears (z a.s.l., m) and velocity, m/s. */
export interface Ears {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  /** The screen's right axis on the ground, as the view is turned: what pans right. */
  readonly right: { readonly x: number; readonly y: number }
}

/** Where a sound comes from (z a.s.l., m), moving at (vx, vy) m/s. */
export interface Source {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx?: number
  readonly vy?: number
}

/** Everything about one source's way to the ears. */
export interface Path {
  readonly ears: Ears
  readonly source: Source
  /** dB(A) at 1 m at the synth's nominal peak, and the source's size, m. */
  readonly db: number
  readonly rMin: number
  /** The path's mean height over the ground under it, m (ISO 9613-2's ground effect); `aloft`: a source so high above it (thunder's channel) that the ground takes nothing. */
  readonly height: number
  readonly aloft?: boolean | undefined
  /** How much fresh snow covers the ground around the ears, 0…1: it absorbs (`snowLoss`) and hushes the street's reverb. */
  readonly snow?: number | undefined
  /** How many dB the synth itself plays under its nominal peak with these params: counts for masking, not for the gain. */
  readonly quiet?: number
  /** Any more loss on the way, dB (a tunnel's length between a source and its portal): counts for both. */
  readonly loss?: number | undefined
  /** Maekawa path difference over the worst edge in the way, m, and metres of forest on the way. */
  readonly delta: number
  readonly forest: number
  /** The masking floor at the ears, dB(A), and how enclosed they are, 0 (open) … 1 (a narrow street). */
  readonly ambient: number
  readonly street: number
  /** The listener's cabin when inside one, and whether the direct sound skips it (their own car's crash, scrape, doors). */
  readonly cabin?: Cabin | undefined
  readonly bare?: boolean
  /** Shift the pitch with the motion of both ends (vehicle voices). */
  readonly doppler?: boolean
}

/** How a source reaches the listener. */
export interface Hearing {
  readonly placement: Placement
  /** Level at the ears, dB(A). */
  readonly level: number
  /** Above the hard cull of the masking rule. */
  readonly audible: boolean
  /** Distance, m, and how long a one-shot travels (none inside `DELAY_FROM`), s. */
  readonly r: number
  readonly delay: number
  /** The cabin a `bare` sound skipped: its echoes come back from outside, through it. */
  readonly shell?: Cabin | undefined
}

/** Nothing reaches the listener. */
export const SILENT: Hearing = {
  placement: { gain: 0, pan: 0, cutoff: 20000, cents: 0, wet: 0 },
  level: -Infinity,
  audible: false,
  r: 0,
  delay: 0,
}

/** The acoustic chain of `path`. */
export const hear = (path: Path): Hearing => {
  const { ears, source, cabin } = path,
    through = path.bare === true ? undefined : cabin
  const dx = source.x - ears.x,
    dy = source.y - ears.y,
    r = Math.hypot(dx, dy, source.z - ears.z)
  const edge = diffraction(path.delta),
    snow = path.snow ?? 0
  const ground = path.aloft === true ? 0 : groundLoss(r, path.height) + snowLoss(r, snow)
  const loss =
    spreading(r, path.rMin) +
    ground +
    foliageLoss(path.forest) +
    edge.loss +
    (through?.loss ?? 0) +
    (path.loss ?? 0)
  const level = path.db - (path.quiet ?? 0) - loss
  const fade = audibility(level, path.ambient)
  const reach = Math.min(REVERB.far, Math.max(REVERB.near, r)) / REVERB.ref
  // The tail comes back from outside: through the cabin, even when the direct sound skips it.
  const muffle =
    cabin === undefined ? 1 : REVERB.cabin * (through === undefined ? dbToGain(-cabin.loss) : 1)
  const wet =
    path.street ** 2 * dbToGain(REVERB.db) * Math.sqrt(reach) * muffle * (1 - REVERB.snow * snow)
  return {
    placement: {
      gain: mixGain(path.db, loss) * fade,
      pan: panOf(dx, dy, ears.right),
      cutoff: Math.min(airCutoff(r), edge.cutoff, through?.cutoff ?? 20000),
      cents:
        path.doppler === true
          ? doppler(
              source.x,
              source.y,
              source.vx ?? 0,
              source.vy ?? 0,
              ears.x,
              ears.y,
              ears.vx,
              ears.vy,
            )
          : 0,
      wet,
    },
    level,
    audible: fade > 0,
    r,
    delay: r > DELAY_FROM ? delayOf(r) : 0,
    shell: through === undefined ? cabin : undefined,
  }
}
