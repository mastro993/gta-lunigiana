/**
 * A train on its rails: the wheels' roar, pink noise in a band that follows the speed over the
 * rails' roughness (2.5 cm: 890 Hz at 80 km/h) with a low rumble under it, both rising 30 dB per
 * decade of speed as rolling noise does (CNOSSOS-EU's rail model), and a clack as each axle runs
 * over a rail joint or a switch, scheduled a little ahead from where the axles and the joints are
 * (as the fire's crackle is): a train's eight axles give the joints' "ta-tak, ta-tak" in bogie
 * pairs. The axles and the joints (`axleOffsets`, `JOINT`) are here too, so the audition page
 * rolls a train with no map. Its disc brakes squeal in the last metres to a stand: three narrow
 * bands of noise at 2.8–5.6 kHz, juddering. How loud a train rolls is the director's (`ROLLING`, a
 * line source); the voice peaks near 0.5 at `RAILS_TOP`.
 *
 * @module audio/synth/rail
 */
import { TRAINS, trainLength, type TrainModel } from "../../sim/rail/models.ts"
import { loop, smoothstep } from "../buffers.ts"
import type { Continuous, VoiceFactory } from "../types.ts"
import { burst, fadeOut, glide, jitter, ping, unit } from "./graph.ts"

type RailsSound = Extract<Continuous, { readonly kind: "rails" }>
type BrakesSound = Extract<Continuous, { readonly kind: "brakes" }>

/** The rolling voice's nominal speed, m/s: 130 km/h, the fastest a train runs (the ATR 220 Tr's top speed). */
export const RAILS_TOP = 130 / 3.6
/** The rails' roughness wavelength the roar's band follows, m (TUNED: rolling noise peaks where v / λ meets the wheel's and rail's resonances, λ 1–5 cm). */
const ROUGHNESS = 0.025
/** Below this speed, m/s, the axles run over the joints unheard. */
const CLACK_FROM = 0.5
/** Clacks are scheduled this far ahead, s. */
export const LOOKAHEAD = 0.3
/**
 * Layer gains at `RAILS_TOP`, MEASURED with "Render all" so the loudest row (at the top speed, a joint under it) peaks near 0.5:
 * the roar's band, the rumble under it, and each clack's crack and thump (a clack rises 20 dB per decade of speed, slower than
 * the roar, so a slow train's clacks stand out of it).
 */
const ROAR = 0.425,
  RUMBLE = 0.51,
  CRACK = 1.1,
  THUMP = 0.21

/**
 * The rails' joints are this far apart, m: 36 m bars, the longest of the FS standard rail lengths (12, 18, 36 m). TUNED: the
 * line's own track is unverified, and long welded rail would clack only at its insulated joints and its switches.
 */
export const JOINT = 36
/** Each bogie's two axles stand this far apart, m (TUNED: a regional unit's bogie wheelbase, 2.5–2.7 m). */
const WHEELBASE = 2.6

/** A `model` train's axles, m back from its active cab's nose: two per bogie, the outer bogies `bogie` m in from the noses and the Jacobs bogies at the joints. */
export const axleOffsets = (model: TrainModel): ReadonlyArray<number> => {
  const { cars, bogie } = TRAINS[model]
  let joint = 0
  const joints = cars.slice(0, -1).map((car) => (joint += car))
  return [bogie, ...joints, trainLength(model) - bogie].flatMap((at) => [
    at - WHEELBASE / 2,
    at + WHEELBASE / 2,
  ])
}

/** How many dB the rolling voice plays under its nominal at `v` m/s: 30 per decade under `RAILS_TOP` (masking and the caps count it). */
export const railsQuiet = (v: number): number =>
  30 * Math.log10(RAILS_TOP / Math.max(0.1, Math.abs(v)))

/** Where the rolling voice's params head at `v` m/s: the roar's and rumble's gains and the roar's band, and a clack's peak. */
export const railsTargets = (v: number) => {
  const share = Math.min(1.2, Math.abs(v) / RAILS_TOP)
  return {
    roar: ROAR * share ** 1.5,
    rumble: RUMBLE * share ** 1.5,
    band: Math.min(2500, Math.max(200, Math.abs(v) / ROUGHNESS)),
    clack: share,
  }
}

/**
 * Each axle's clacks over the next `lookahead` s: for axles at s `axles` moving `v` m/s toward +s, the joints and switches at
 * `joints` each one runs over past `from` (its own s up to which clacks were scheduled, none the first time) and up to where it
 * will be, as seconds from now (0 for one just passed). Also each axle's new `from`. An axle that `from` lies behind (a stall, a
 * reversal) carries on from where it is, so each joint clacks once per pass; a train too slow to clack carries none.
 */
export const clacksAhead = (
  from: ReadonlyArray<number> | undefined,
  axles: ReadonlyArray<number>,
  joints: ReadonlyArray<number>,
  v: number,
  lookahead = LOOKAHEAD,
): { readonly times: ReadonlyArray<number>; readonly from: ReadonlyArray<number> } => {
  if (Math.abs(v) < CLACK_FROM) return { times: [], from: axles }
  const way = Math.sign(v),
    times: Array<number> = []
  const next = axles.map((axle, k) => {
    const was = from?.[k],
      start = was === undefined || (was - axle) * way < 0 ? axle : was,
      ahead = axle + v * lookahead
    for (const joint of joints)
      if ((joint - start) * way > 0 && (joint - ahead) * way <= 0)
        times.push(Math.max(0, (joint - axle) / v))
    return (ahead - start) * way > 0 ? ahead : start
  })
  return { times, from: next }
}

/** A train rolling: the roar and rumble from `io.cents`'s Doppler, and the clacks it schedules. */
export const rails: VoiceFactory<RailsSound> = (io) => {
  const { ctx, kit } = io,
    output = new GainNode(ctx, { gain: 1 })
  output.connect(io.out)
  const pink = loop(ctx, kit.pink),
    band = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 800, Q: 0.7 }),
    roar = new GainNode(ctx, { gain: 0 })
  pink.connect(band).connect(roar).connect(output)
  const brown = loop(ctx, kit.brown),
    rumble = new GainNode(ctx, { gain: 0 })
  brown
    .connect(new BiquadFilterNode(ctx, { type: "lowpass", frequency: 160 }))
    .connect(rumble)
    .connect(output)
  for (const source of [pink, brown]) io.cents.connect(source.detune)
  let from: ReadonlyArray<number> | undefined,
    first = true
  return {
    update: (sound, now) => {
      const t = railsTargets(sound.v),
        jump = first
      first = false
      glide(roar.gain, t.roar, now, false)
      glide(rumble.gain, t.rumble, now, false)
      glide(band.frequency, t.band, now, jump, 0.1)
      const ahead = clacksAhead(from, sound.axles, sound.joints, sound.v)
      from = ahead.from
      for (const dt of ahead.times) {
        // The wheel's crack off the rail end, and the thump of the axle dropping into the gap.
        const at = now + dt,
          peak = t.clack * jitter(0.2)
        burst(ctx, kit.white, output, at, 0.0005, 0.006, 1900 * jitter(0.15), 1.2, CRACK * peak)
        ping(ctx, output, at, 130 * jitter(0.1), THUMP * peak, 0.02)
      }
    },
    stop: (now) => fadeOut(output, [pink, brown], now),
  }
}

/** The squeal's bands, Hz: disc brakes squeal at 2–6 kHz, as the pads excite the disc's modes. */
const SQUEAL = [2850, 4100, 5600] as const
/** The squeal's gain at its loudest, MEASURED with "Render all" to peak near 0.5 (the narrow bands pass a little of the noise). */
const SQUEAL_GAIN = 5

/** How loud a train's brakes squeal (0…1): only braking harder than a tenth of the emergency rate, opening up from 6 m/s to a stand. */
export const brakesTargets = (sound: BrakesSound): number =>
  unit((sound.brake - 0.1) / 0.4) *
  (1 - smoothstep(1.5, 6, sound.speed)) *
  smoothstep(0.05, 0.6, sound.speed)

/** How many dB the brakes' voice plays under its nominal (masking counts it): 0 at its loudest; 60 when it is silent. */
export const brakesQuiet = (sound: BrakesSound): number =>
  -20 * Math.log10(Math.max(1e-3, brakesTargets(sound)))

/** A train's brakes squealing as it stops, juddering with the gust signal sped up. */
export const brakes: VoiceFactory<BrakesSound> = (io) => {
  const { ctx, kit } = io,
    output = new GainNode(ctx, { gain: 0 })
  output.connect(io.out)
  const white = loop(ctx, kit.white),
    judder = loop(ctx, kit.gust, 40),
    shake = new GainNode(ctx, { gain: 0.3 })
  const level = new GainNode(ctx, { gain: 1 })
  judder.connect(shake).connect(level.gain)
  for (const [i, frequency] of SQUEAL.entries()) {
    const peak = new BiquadFilterNode(ctx, { type: "bandpass", frequency, Q: 50 })
    io.cents.connect(peak.detune)
    white
      .connect(peak)
      .connect(new GainNode(ctx, { gain: 1 / (i + 1) }))
      .connect(level)
  }
  level.connect(output)
  io.cents.connect(white.detune)
  return {
    update: (sound, now) => glide(output.gain, SQUEAL_GAIN * brakesTargets(sound), now, false),
    stop: (now) => fadeOut(output, [white, judder], now),
  }
}
