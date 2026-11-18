/**
 * Textures the layers share: grain streams (grit, glass cubes, dirt, leaves: Cook's PhISEM, every
 * collision a short noise burst, the stream's rate and level decaying together), click trains
 * (rattles, creaks, stick-slip) and pieces landing on the ground under the crash, by surface.
 *
 * @module audio/synth/crash/textures
 */
import type { Surface } from "../../types.ts"
import { between, type Mix, puff, rayleigh, type Spectrum, strike, tint } from "./dsp.ts"

/** What debris lands on (physics.md §2.7): its amplitude and tilt (dB per band) re asphalt, and how pieces bounce on it (none on soft ground). */
const GROUNDS = {
  asphalt: { gain: 1, tint: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bounce: 0.3 },
  // Stone setts: harder and ringier, the pieces rattle into the joints.
  stone: { gain: 1.1, tint: [0, 0, 0, 0, 0, 0, 0, 1, 2, 2], bounce: 0.45 },
  // Gravel, dirt, grass and leaves swallow small pieces: muffled, quieter (grass ≤ −14 dB re asphalt).
  gravel: { gain: 0.4, tint: [0, 0, 0, 0, 0, -1, -2, -4, -7, -10], bounce: 0 },
  dirt: { gain: 0.3, tint: [0, 0, 0, 0, -1, -2, -4, -7, -10, -14], bounce: 0 },
  grass: { gain: 0.15, tint: [0, 0, 0, 0, -1, -3, -6, -9, -12, -16], bounce: 0 },
  leaves: { gain: 0.22, tint: [0, 0, 0, 0, 0, -1, -3, -5, -8, -12], bounce: 0 },
  // Dry sand takes a piece in like grass, its loose grains damping the click and the ring: the softest landing of all.
  sand: { gain: 0.15, tint: [0, 0, 0, -1, -2, -4, -7, -10, -13, -17], bounce: 0 },
} as const satisfies Record<
  Surface,
  { readonly gain: number; readonly tint: Spectrum; readonly bounce: number }
>

/**
 * A grain stream from `from` to `until` s: grains (`grain` s long) at `rate` a second, rate and level
 * decaying with time constant `decay` s; each grain a burst of `spectrum` at up to about `level`.
 */
export const grains = (
  mix: Mix,
  from: number,
  until: number,
  rate: number,
  decay: number,
  grain: number,
  level: number,
  spectrum: Spectrum,
): void => {
  const { random } = mix
  for (let t = from; ;) {
    const k = Math.exp(-(t - from) / decay)
    // One a second at least, so the stream always reaches its end.
    t += -Math.log(1 - random()) / (rate * k + 1)
    if (t >= until) return
    puff(
      mix,
      t,
      0.0002,
      grain * between(random, 0.6, 1.4),
      level * k * -Math.log(1 - random()),
      spectrum,
    )
  }
}

/** `count` clicks from `from` s, about `period` s apart, fading with time constant `decay` s: each a burst of `spectrum` at up to `level`, the first `rung` of them ringing `modes` ([Hz, η]) at `ring`× its amplitude. */
export const train = (
  mix: Mix,
  from: number,
  count: number,
  period: number,
  decay: number,
  level: number,
  spectrum: Spectrum,
  modes: ReadonlyArray<readonly [number, number]> = [],
  ring = 0,
  rung = count,
): void => {
  const { random } = mix
  for (let i = 0, t = from; i < count; i++, t += period * between(random, 0.7, 1.3)) {
    const a = level * Math.exp(-(t - from) / decay) * between(random, 0.3, 1)
    puff(mix, t, 0.0002, 0.0006, a, spectrum)
    if (i < rung)
      for (const [hz, eta] of modes) strike(mix, t, hz, eta, ring * Math.sqrt(a) * rayleigh(random))
  }
}

/** A piece landing at `t` s on `surface`, bouncing on hard ground: a click of `spectrum` at `level`, ringing `modes` ([Hz, η]) at `ring`× its amplitude if it is metal or glass. */
export const land = (
  mix: Mix,
  t: number,
  surface: Surface,
  level: number,
  spectrum: Spectrum,
  modes: ReadonlyArray<readonly [number, number]> = [],
  ring = 0,
): void => {
  const { random } = mix,
    ground = GROUNDS[surface],
    tinted = tint(spectrum, ground.tint)
  let a = level * ground.gain ** 2,
    vy = between(random, 2.4, 5.1)
  for (let bounce = 0; bounce < 3; bounce++) {
    puff(mix, t, 0.0002, between(random, 0.001, 0.004), a, tinted)
    // Soft ground damps a piece's ring as well as its click; a bounce only clicks.
    if (bounce === 0)
      for (const [hz, eta] of modes)
        strike(
          mix,
          t,
          hz,
          ground.bounce > 0 ? eta : eta * 4,
          ring * Math.sqrt(a) * rayleigh(random),
        )
    if (ground.bounce === 0) return
    vy *= ground.bounce
    t += (2 * vy) / 9.81
    a *= ground.bounce ** 2
  }
}

/** `surface`'s amplitude and tilt for showers landing on it (glass cubes), as `land` gives a single piece. */
export const groundOf = (surface: Surface): { readonly gain: number; readonly tint: Spectrum } =>
  GROUNDS[surface]
