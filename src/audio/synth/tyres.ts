/**
 * Tyre voices (synthesis.md §3): rolling noise rising 30 dB per decade of speed, (v / 70 km/h)^1.5
 * as in CNOSSOS-EU; on stone setts an amplitude rumble at v / 0.14 m (one sett per 14 cm); a tonal
 * squeal from two very narrow bandpasses (980 and 1460 Hz) on asphalt and stone when the tyres skid
 * (the sim's `Skid`: sliding sideways, spinning or locked); a gravel crunch from noise grains on loose
 * ground that sprays instead of squealing. Heavy tyres (the truck) are darker and 6 dB louder; a
 * full slide at the Giulia's top speed peaks near 0.5.
 *
 * @module audio/synth/tyres
 */
import { loop, smoothstep } from "../buffers.ts"
import type { Continuous, Surface, VoiceFactory } from "../types.ts"
import { fadeOut, glide, shuffled, unit } from "./graph.ts"

type TyreSound = Extract<Continuous, { readonly kind: "tyres" }>

/** How a surface sounds under a tyre. */
interface Ground {
  /** Rolling level and lowpass factor. */
  readonly roll: number
  readonly tone: number
  /** Sett rumble depth (share of the rolling level). */
  readonly setts: number
  /** Grain crunch level. */
  readonly crunch: number
  /** Squeal level when sliding (only on hard, smooth-enough ground). */
  readonly squeal: number
}

const GROUND = {
  asphalt: { roll: 1, tone: 1, setts: 0, crunch: 0, squeal: 1 },
  stone: { roll: 1.2, tone: 1, setts: 0.8, crunch: 0.05, squeal: 0.8 },
  gravel: { roll: 0.8, tone: 0.8, setts: 0, crunch: 1, squeal: 0 },
  dirt: { roll: 0.7, tone: 0.6, setts: 0, crunch: 0.5, squeal: 0 },
  grass: { roll: 0.4, tone: 0.4, setts: 0, crunch: 0.15, squeal: 0 },
  leaves: { roll: 0.45, tone: 0.5, setts: 0, crunch: 0.35, squeal: 0 },
} as const satisfies Record<Surface, Ground>

/** The squeal's two tones, Hz. */
const SQUEAL = [980, 1460] as const
/**
 * Layer gains, calibrated by offline renders (the narrow squeal bands pass about 1/9 of the noise):
 * the loudest intended case, a full slide at the Giulia's top speed (40 m/s, skid 1 at 12 m/s, asphalt),
 * peaks near 0.5 (the director's tyres level). Louder by nature, the truck sliding at its top
 * speed (20 m/s) and cobbles at 40 m/s (the setts' rumble adds crest) peak up to 4 dB higher.
 */
const ROLL = 0.37,
  SQUEAL_GAIN = 6.75,
  CRUNCH = 1.15
/** Light tyres relative to heavy ones (−6 dB). */
const LIGHT = 0.5

/** Where every param of a tyre graph heads. */
interface TyreTargets {
  readonly roll: number
  readonly rollHz: number
  /** Sett rumble rate, Hz, and depth (gain units). */
  readonly settHz: number
  readonly setts: number
  readonly squeal: number
  /** Squeal pitch factor on the two tones. */
  readonly pitch: number
  readonly crunch: number
  /** Grain playback rate: grain density follows speed. */
  readonly grains: number
}

/**
 * The tyre law. Rolling follows the speed over the ground; the slide is the sim's skid, how far past
 * their grip the tyres are, faded in as they slide from 0.5 to 2.5 m/s (TUNED: a creep barely past
 * grip does not squeal), so wheelspin standing still and a locked wheel in a straight line squeal too.
 */
export const tyreTargets = (sound: TyreSound): TyreTargets => {
  const ground = GROUND[sound.surface],
    speed = Math.max(0, sound.speed),
    kmh = speed * 3.6,
    size = sound.heavy ? 1 : LIGHT
  const slide = unit(sound.skid) * smoothstep(0.5, 2.5, sound.slip)
  const roll = ROLL * size * ground.roll * (kmh / 70) ** 1.5
  return {
    roll,
    rollHz: Math.min(3000, 250 + 25 * kmh) * ground.tone * (sound.heavy ? 0.6 : 1),
    settHz: Math.max(1, speed / 0.14),
    setts: ground.setts * roll,
    squeal: SQUEAL_GAIN * size * ground.squeal * slide,
    pitch: (1 + 0.15 * (slide - 0.2)) * (sound.heavy ? 0.8 : 1),
    crunch: CRUNCH * size * ground.crunch * (0.15 * Math.min(1, kmh / 40) + 0.8 * slide),
    grains: 0.5 + Math.min(1.5, kmh / 50) + 0.5 * slide,
  }
}

/** Tyres on the ground under one vehicle. */
export const tyres: VoiceFactory<TyreSound> = (io) => {
  const { ctx, kit } = io,
    output = new GainNode(ctx, { gain: 1 })
  output.connect(io.out)
  const pink = loop(ctx, kit.pink),
    rollLp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 400 }),
    roll = new GainNode(ctx, { gain: 0 })
  pink.connect(rollLp).connect(roll).connect(output)
  const setts = new OscillatorNode(ctx, { type: "triangle", frequency: 50 }),
    settDepth = new GainNode(ctx, { gain: 0 })
  setts.connect(settDepth).connect(roll.gain)
  const white = loop(ctx, kit.white),
    squeal = new GainNode(ctx, { gain: 0 })
  const bands = SQUEAL.map((frequency, i) => {
    const band = new BiquadFilterNode(ctx, { type: "bandpass", frequency, Q: i === 0 ? 45 : 35 })
    io.cents.connect(band.detune)
    white.connect(band).connect(squeal)
    return band
  })
  squeal.connect(output)
  const grainBand = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 1800, Q: 0.7 }),
    grains = shuffled(ctx, kit.crackle, grainBand, 1, io.cents),
    crunch = new GainNode(ctx, { gain: 0 })
  grainBand.connect(crunch).connect(output)
  for (const source of [pink, white]) io.cents.connect(source.detune)
  setts.start()

  let first = true
  return {
    update: (sound, now) => {
      const t = tyreTargets(sound),
        jump = first
      first = false
      glide(roll.gain, t.roll, now, false)
      glide(rollLp.frequency, t.rollHz, now, jump)
      glide(setts.frequency, t.settHz, now, jump)
      glide(settDepth.gain, t.setts, now, false)
      glide(squeal.gain, t.squeal, now, false, 0.03)
      bands.forEach((band, i) => glide(band.frequency, SQUEAL[i]! * t.pitch, now, jump, 0.1))
      glide(crunch.gain, t.crunch, now, false)
      glide(grains.rate, t.grains, now, jump)
      grains.update(now)
    },
    stop: (now) => fadeOut(output, [pink, white, grains.control, setts], now),
  }
}
