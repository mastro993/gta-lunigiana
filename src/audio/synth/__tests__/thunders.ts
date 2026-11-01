/**
 * The thunder tests' renders: twelve seeds of a flash at a distance, heard from ear height, and how
 * loud each starts. Shared by `thunder.test.ts` and `thunder.long-test.ts`.
 *
 * @module audio/synth/__tests__/thunders
 */
import { renderThunder, THUNDER_RATE } from "../thunder.ts"

/** The rate the thunder renders at, Hz. */
export const RATE = THUNDER_RATE
/** Twelve draws of each thunder: every bound below holds on seeds 1–96 too, twelve (or 24) at a time. */
export const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1)

/** The median of `values`. */
export const median = (values: ReadonlyArray<number>): number =>
  [...values].sort((a, b) => a - b)[values.length >> 1]!

/** Ear height over level ground, m. */
export const EARS = 1.6

/** Every seed's render of a thunder `distance` m away, a `bolt` or an in-cloud flash, heard from `ears` m over the ground under it. */
export const renders = (distance: number, bolt = true, rate = RATE, seeds = SEEDS, ears = EARS) =>
  seeds.map((seed) => renderThunder({ kind: "thunder", distance, ears, bolt, seed }, rate))

/** How loud the first 50 ms are against the loudest moment, dB (10 ms RMS): a crack starts at its loudest, a rumble far under it. */
export const onset = (x: Float32Array): number => {
  const win = Math.round(RATE / 100),
    hop = Math.round(RATE / 1000),
    env: Array<number> = []
  for (let i = 0; i + win <= x.length; i += hop) {
    let s = 0
    for (let j = i; j < i + win; j++) s += x[j]! * x[j]!
    env.push(Math.sqrt(s / win))
  }
  return 20 * Math.log10(Math.max(...env.slice(0, 50)) / Math.max(...env))
}
