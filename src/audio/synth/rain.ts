/**
 * Rain: outside, a bed all around the listener (`rain`); inside a car, its drumming on the roof and
 * windscreen (`roof`). Outside it is a bright pink hiss, the drops near the ears as ticks coloured by
 * what they land on (leaves ring near 4 kHz, roofs and paving tock lower, open ground ticks above
 * 900 Hz), a low roar of runoff in heavy rain, bubbles where it falls on water (Farnell, Designing
 * Sound ch. 15; Medwin and Nystuen 1992). On the roof every drop rings the panel's and the glass's
 * modes, so the cabin drums low and tonal, then roars.
 *
 * Both follow the drops' kinetic energy (`rainQuiet`): the voices play that far under their nominal
 * peak, a 60 mm/h downpour, by themselves, as the wind does by its strength. A light shower is
 * separate ticks over a faint hiss; as the rate grows the drops fuse into the roar.
 *
 * @module audio/synth/rain
 */
import { bufferOf, crackleSamples, loop, smoothstep } from "../buffers.ts"
import type { Continuous, VoiceFactory } from "../types.ts"
import { bubbleTexture } from "./bubbles.ts"
import { rayleigh } from "./crash/dsp.ts"
import { fadeOut, glide, normalise, outlet, shuffled, unit } from "./graph.ts"

type Rain = Extract<Continuous, { readonly kind: "rain" }>
type Roof = Extract<Continuous, { readonly kind: "roof" }>

/** The rate both voices play their nominal peak at, mm/h: a downpour. */
export const DOWNPOUR = 60

/** Kinetic energy of rain falling at `rate` mm/h, J/m²/h (Wischmeier and Smith; it saturates past 76 mm/h). */
const kineticEnergy = (rate: number): number => {
  const r = Math.min(76, Math.max(0.1, rate || 0))
  return r * (11.9 + 8.7 * Math.log10(r))
}

/** How far (dB) the rain voices play under their nominal at `rate` mm/h: the drops' kinetic energy against a downpour's, 12 dB a decade (21 dB under at 1 mm/h). */
export const rainQuiet = (rate: number): number =>
  10 * Math.log10(kineticEnergy(DOWNPOUR) / kineticEnergy(rate))

/** Smoothing of rate and ground changes, s: a regime change runs over real seconds, and the voice follows it gently. */
const TAU = 1
/** Separate drops near the ears, per second, in the sparse layer (the dense one is the kit's crackle, 400 a second). */
const SPARSE = 30

/** Layer gains by rate: rows of [mm/h, gains...], read between rows on a log scale of rate (clamped at the ends). */
type Table = ReadonlyArray<readonly [number, ...ReadonlyArray<number>]>

/** `table`'s gains at `rate`, interpolated in log rate. */
const byRate = (table: Table, rate: number): ReadonlyArray<number> => {
  const x = Math.log(Math.min(table.at(-1)![0], Math.max(table[0]![0], rate || 0)))
  let i = 1
  while (i < table.length - 1 && Math.log(table[i]![0]) < x) i++
  const a = table[i - 1]!,
    b = table[i]!,
    t = Math.max(0, Math.min(1, (x - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]))))
  return a.slice(1).map((g, k) => g + (b[k + 1]! - g) * t)
}

/**
 * The rain's layers by rate: the hiss, the runoff's roar, the sparse big drops and the kit's dense grains, as shares of one level
 * (the hiss 60 %, the drops 30 % at 1 mm/h; the hiss 75 %, the roar 18 % at 60): a shower's ticks fill into patter and fuse into
 * the roar (about 25 big drops per m² a second at 1 mm/h, 450 at 10). TUNED by rendering each layer alone: the voice's RMS keeps
 * within 1.5 dB of its law from 1 to 60 mm/h on open ground, in the forest and in a village, and peaks 0.46–0.6 in a downpour; a
 * shower's ticks peak 22 dB over its RMS, which the bed's gain (0.4 dB higher a dB of `rainQuiet`) keeps under a downpour's peak.
 */
const RAIN_LAYERS: Table = [
  [1, 0.56, 0, 1.34, 0.26],
  [4, 0.56, 0, 1.16, 0.41],
  [10, 0.61, 0.12, 0.67, 0.37],
  [25, 0.63, 0.19, 0.42, 0.26],
  [60, 0.63, 0.24, 0, 0.22],
]
/** A drop's ring on leaves (a 4 kHz band) and its tock on roofs and paving (bands at 1.8 kHz and 600 Hz) pass less of it than open ground's 900 Hz highpass: these bring each to as loud. */
const SURFACES = { leaves: 2.2, hard: 3.1, ground: 1 } as const
/**
 * Rain on water: the bubbles' loudest plink (their texture peaks at 1, 28 dB over its RMS) plays at most `plink` after the rate's
 * law, a downpour's, and their layer at most `most` before it. TUNED by rendering, seeded, water 0 against 1 on open ground and in a
 * village: at 4–8 mm/h the plinks add 1.7–2.4 dB at 8 kHz and up to 2.5 dB of crest, the voice peaking 0.33–0.47; from 20 mm/h the
 * roar takes them (under 1 dB at 8 kHz). A layer at 0.4 at every rate left a steady rain on a river sounding like open ground's (8 mm/h:
 * every octave within 0.3 dB, the crest unchanged).
 */
const WATER = { plink: 0.4, most: 1.5 } as const

/** The rain voice's layer gains for `sound`: the hiss, the runoff's roar, the sparse and dense drops, their surfaces, the bubbles. */
interface RainMix {
  readonly bed: number
  readonly roar: number
  readonly sparse: number
  readonly dense: number
  readonly leaves: number
  readonly hard: number
  readonly ground: number
  readonly water: number
  /** The hiss's top, Hz: leaves are brighter. */
  readonly top: number
}

/** The layers at `sound`'s rate and ground: the drops ring as what they land on, its shares adding in power (a forest edge sounds as loud as either side). */
export const rainMix = (sound: Rain): RainMix => {
  const [bed, roar, sparse, dense] = byRate(RAIN_LAYERS, sound.rate),
    forest = unit(sound.forest),
    built = unit(sound.built) * (1 - forest)
  return {
    bed: bed!,
    roar: roar!,
    sparse: sparse!,
    dense: dense!,
    leaves: SURFACES.leaves * Math.sqrt(forest),
    hard: SURFACES.hard * Math.sqrt(built),
    ground: SURFACES.ground * Math.sqrt(Math.max(0, 1 - forest - built)),
    water:
      unit(sound.water) *
      Math.min(WATER.most, WATER.plink * 10 ** (rainQuiet(sound.rate) / 20)) *
      smoothstep(0.5, 4, sound.rate || 0),
    top: 9000 + 2000 * forest,
  }
}

/** Rain on water: small bubbles (the type I, about 15 kHz, and the larger type II drops' 2–10 kHz plinks), Poisson at 1500 a second (Medwin and Nystuen 1992; `bubbleTexture` above γ 5 sounds like rain). */
const RAIN_ON_WATER = { rate: 1500, rMin: 0.0002, rMax: 0.0015, gamma: 5.5, xi: 0.1 } as const
/** Seconds per texture loop: long enough not to be heard repeating under the hiss. */
const LOOP_SECONDS = 6

/** A buffer `make` makes once per context, on first use (a few ms on the main thread, the first time that voice plays). */
const once = (make: (ctx: BaseAudioContext) => AudioBuffer) => {
  const made = new WeakMap<BaseAudioContext, AudioBuffer>()
  return (ctx: BaseAudioContext): AudioBuffer => {
    let buffer = made.get(ctx)
    if (buffer === undefined) made.set(ctx, (buffer = make(ctx)))
    return buffer
  }
}

/** Sparse drops near the ears. */
const sparseOf = once((ctx) =>
  bufferOf(ctx, crackleSamples(ctx.sampleRate * LOOP_SECONDS, ctx.sampleRate, SPARSE)),
)
/** Rain on water, peaking at 1. */
const bubblesOf = once((ctx) => {
  const samples = bubbleTexture(ctx.sampleRate, LOOP_SECONDS / 2, RAIN_ON_WATER)
  normalise([samples], 1)
  return bufferOf(ctx, samples)
})

/** Rain around the listener: `rate` mm/h on leaves, roofs and paving, open ground and water in the shares given. */
export const rain: VoiceFactory<Rain> = ({ ctx, out, kit }) => {
  const level = outlet(ctx, out),
    law = new GainNode(ctx, { gain: 0 }),
    sheets = new GainNode(ctx, { gain: 1 })
  sheets.connect(law).connect(level)
  // The wind drives it in sheets: the gust signal at half pace swells it ±1 dB.
  const gust = loop(ctx, kit.gust, 0.5)
  gust.connect(new GainNode(ctx, { gain: 0.12 })).connect(sheets.gain)
  const layer = () => new GainNode(ctx, { gain: 0 })
  // The hiss: pink, open above 350 Hz with a lift at 2.5 kHz.
  const pink = loop(ctx, kit.pink),
    top = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 9000, Q: 0.7 }),
    bed = layer()
  pink
    .connect(new BiquadFilterNode(ctx, { type: "highpass", frequency: 350, Q: 0.7 }))
    .connect(new BiquadFilterNode(ctx, { type: "peaking", frequency: 2500, Q: 0.8, gain: 3 }))
    .connect(top)
    .connect(bed)
    .connect(sheets)
  // The runoff's roar off roofs, gutters and streets in heavy rain.
  const brown = loop(ctx, kit.brown),
    roar = layer()
  brown
    .connect(new BiquadFilterNode(ctx, { type: "lowpass", frequency: 600 }))
    .connect(roar)
    .connect(sheets)
  // The drops near the ears: a sparse layer of big ones and the kit's dense grains, through what they land on.
  const big = loop(ctx, sparseOf(ctx)),
    sparse = layer(),
    dense = layer(),
    small = shuffled(ctx, kit.crackle, dense),
    drops = new GainNode(ctx)
  big.connect(sparse).connect(drops)
  dense.connect(drops)
  const leaves = layer(),
    hard = layer(),
    ground = layer()
  drops
    .connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 4000, Q: 1.5 }))
    .connect(leaves)
    .connect(sheets)
  drops
    .connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 1800, Q: 2 }))
    .connect(hard)
    .connect(sheets)
  drops.connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 600, Q: 4 })).connect(hard)
  drops
    .connect(new BiquadFilterNode(ctx, { type: "highpass", frequency: 900, Q: 0.7 }))
    .connect(ground)
    .connect(sheets)
  const bubbles = loop(ctx, bubblesOf(ctx)),
    water = layer()
  bubbles.connect(water).connect(sheets)
  let first = true
  return {
    update: (sound, now) => {
      const mix = rainMix(sound),
        set = (node: GainNode, value: number) => glide(node.gain, value, now, first, TAU)
      glide(law.gain, 10 ** (-rainQuiet(sound.rate) / 20), now, first, TAU)
      set(bed, mix.bed)
      set(roar, mix.roar)
      set(sparse, mix.sparse)
      set(dense, mix.dense)
      set(leaves, mix.leaves)
      set(hard, mix.hard)
      set(ground, mix.ground)
      set(water, mix.water)
      glide(top.frequency, mix.top, now, first, TAU)
      small.update(now)
      first = false
    },
    stop: (now) => fadeOut(level, [pink, gust, brown, big, small.control, bubbles], now),
  }
}

/**
 * The modes a drop rings on a car (Hz, Q): the roof panel, damped steel on bitumen pads (95–560 Hz, Q 6–8), and the windscreen
 * (Farnell's glass pane: 254–669 Hz and a cluster near 2 kHz, Q 1.5–3), the glass's half as loud.
 */
const MODES = [
  [95, 8, 1],
  [160, 8, 1],
  [240, 7, 1],
  [380, 6, 0.8],
  [560, 6, 0.6],
  [254, 3, 0.5],
  [443, 3, 0.5],
  [551, 2.5, 0.4],
  [669, 2, 0.4],
  [1990, 1.5, 0.3],
] as const
/** The rate the drumming is made at, Hz: it holds nothing above 3.5 kHz. */
const DRUM_RATE = 16000
/** Drops per second in the drumming loop (two copies play, so about 85 a second on the car's 2.5 m² in a light shower). */
const DRUMS = 40

/**
 * `seconds` of drops striking a car's roof and windscreen, `perSecond` (Poisson) at `sampleRate`: each drop a click of its impact,
 * then every mode ringing as strongly as where it landed lets it, most drops small and a few big; RMS 0.2, looping seamlessly
 * (a mode ringing past the end wraps to the start).
 */
export const drumSamples = (
  sampleRate: number,
  seconds: number,
  perSecond: number,
  random: () => number = Math.random,
): Float32Array<ArrayBuffer> => {
  const n = Math.floor(sampleRate * seconds),
    out = new Float32Array(n)
  for (
    let t = -Math.log(1 - random()) / perSecond;
    t < seconds;
    t += -Math.log(1 - random()) / perSecond
  ) {
    const size = random() ** 3,
      i0 = Math.floor(t * sampleRate)
    for (let j = 0, click = Math.ceil(0.0005 * sampleRate); j < click; j++)
      out[(i0 + j) % n]! += 0.3 * size * (random() * 2 - 1)
    for (const [hz, q, gain] of MODES) {
      if (hz >= 0.45 * sampleRate) continue
      // A damped sine by its two-term recurrence, until 40 dB down.
      const decay = (Math.PI * hz) / q,
        r = Math.exp(-decay / sampleRate),
        w = (2 * Math.PI * hz) / sampleRate
      const c = 2 * r * Math.cos(w),
        k2 = r * r,
        length = Math.min(n, Math.ceil((Math.log(100) / decay) * sampleRate))
      // A Rayleigh draw: how strongly a drop landing at a random spot excites this mode.
      let prev = 0,
        cur = size * gain * rayleigh(random) * Math.sin(w)
      for (let j = 0, i = i0 % n; j < length; j++, i = i + 1 === n ? 0 : i + 1) {
        out[i]! += cur
        const next = c * cur - k2 * prev
        prev = cur
        cur = next
      }
    }
  }
  let energy = 0
  for (const v of out) energy += v * v
  const gain = energy > 0 ? 0.2 / Math.sqrt(energy / n) : 0
  for (let i = 0; i < n; i++) out[i]! *= gain
  return out
}

/** The drumming loop. */
const drumsOf = once((ctx) => bufferOf(ctx, drumSamples(DRUM_RATE, LOOP_SECONDS, DRUMS), DRUM_RATE))

/**
 * The roof's layers by rate: separate drops drumming, the dense patter ringing the panel, the sheet's roar, as shares of one level
 * (the drums 90 % at 1 mm/h; the roar 60 % at 60). TUNED by rendering each layer alone, as the rain's: within 0.7 dB of the law,
 * 0.49 peak in a downpour, centroid 0.6 kHz.
 */
const ROOF_LAYERS: Table = [
  [1, 0.32, 1.03, 0],
  [4, 0.24, 1.63, 0.41],
  [10, 0.2, 1.8, 0.59],
  [25, 0.15, 1.63, 0.76],
  [60, 0.14, 1.46, 0.83],
]

/** The roof voice's layer gains at `sound`'s rate: drops you can count in a shower, a drumming patter by 4 mm/h, a roar past 20. */
interface RoofMix {
  readonly drums: number
  readonly dense: number
  readonly roar: number
}

/** The layers at `sound`'s rate. */
export const roofMix = (sound: Roof): RoofMix => {
  const [drums, dense, roar] = byRate(ROOF_LAYERS, sound.rate)
  return { drums: drums!, dense: dense!, roar: roar! }
}

/** Rain drumming on the roof and the windscreen of the car the listener sits in, at `rate` mm/h; the cabin closes everything over 3.5 kHz. */
export const roof: VoiceFactory<Roof> = ({ ctx, out, kit }) => {
  const level = outlet(ctx, out),
    law = new GainNode(ctx, { gain: 0 }),
    cabin = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 3500, Q: 0.7 })
  cabin.connect(law).connect(level)
  const layer = () => new GainNode(ctx, { gain: 0 })
  // Two copies of the drumming loop at different paces, so the pattern never repeats within a minute.
  const drumming = drumsOf(ctx),
    one = loop(ctx, drumming),
    two = loop(ctx, drumming, 1.13),
    drums = layer()
  one.connect(drums)
  two.connect(drums)
  drums.connect(cabin)
  // The dense patter, the kit's grains ringing the panel's three strongest modes, and the sheet's roar: the panel, under 1 kHz.
  const panel = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 1000, Q: 0.7 }),
    patter = new GainNode(ctx),
    grains = shuffled(ctx, kit.crackle, patter),
    dense = layer()
  panel.connect(cabin)
  for (const hz of [160, 380, 560])
    patter
      .connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: hz, Q: 4 }))
      .connect(dense)
  dense.connect(panel)
  const pink = loop(ctx, kit.pink),
    roar = layer()
  pink
    .connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 300, Q: 0.7 }))
    .connect(roar)
    .connect(panel)
  let first = true
  return {
    update: (sound, now) => {
      const mix = roofMix(sound)
      glide(law.gain, 10 ** (-rainQuiet(sound.rate) / 20), now, first, TAU)
      glide(drums.gain, mix.drums, now, first, TAU)
      glide(dense.gain, mix.dense, now, first, TAU)
      glide(roar.gain, mix.roar, now, first, TAU)
      grains.update(now)
      first = false
    },
    stop: (now) => fadeOut(level, [one, two, grains.control, pink], now),
  }
}
