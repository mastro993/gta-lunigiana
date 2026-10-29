/**
 * Horns, the Carabinieri siren and the truck's reversing beeper (synthesis.md §5).
 *
 * - Horns: per model, a single electromagnetic horn (Panda 420 Hz, Ape 610 Hz "meep") or a pair
 *   (Giulia 410 + 500 Hz, the truck's air horn 150 + 185 Hz with a slow attack as the air builds),
 *   voiced by a peaking filter; the pitch climbs out of a small droop at every press.
 * - Siren: the Italian police and Carabinieri bitonale, 466 Hz and 622 Hz for 750 ms each
 *   (D.M. 20/03/1979), switched with no JavaScript: a square LFO, shaped to exactly those two
 *   values and smoothed by a 25 Hz lowpass (a 10–20 ms glide), drives the tone's frequency.
 * - Beeper: a 1 kHz tone gated 0.5 s on, 0.5 s off by another square LFO.
 * - Train horns: EN 15153-2's pair, 660 Hz high and 370 Hz low, sounded one at a time (both at
 *   once is the dissonant emergency chord), each a pneumatic horn rising out of a droop over its
 *   slower attack, voiced broadly at 1.2 kHz (horns peak in the 500 Hz–2.5 kHz octaves). The
 *   player's H holds the high tone; an AI train gives one moderately long high blast (RFI's signal
 *   rules, art. 5) or, at something on the track, the alarm: short blasts, high and low in turn.
 *
 * @module audio/synth/horns
 */
import type { VehicleModel } from "../../sim/vehicles.ts"
import type { Continuous, Kit, OneShot, Shot, VoiceFactory } from "../types.ts"
import { builtOnFirst, fadeOut, glide } from "./graph.ts"

/** One model's horn. */
interface HornSpec {
  /** Tone frequencies, Hz. */
  readonly tones: ReadonlyArray<number>
  readonly wave: "sawtooth" | "square"
  /** Peaking voicing (+9 dB): Hz, Q. */
  readonly peak: readonly [hz: number, q: number]
  readonly highpass: number
  /** Attack and release, s. */
  readonly attack: number
  readonly release: number
  /** Pitch at the onset as a share of the tone. */
  readonly droop: number
  /** Pitch waver, a share of the tone (a cheap horn). */
  readonly jitter: number
  /** Gate level once pressed: peaks near 0.5. */
  readonly gain: number
}

const HORNS = {
  panda: {
    tones: [420],
    wave: "sawtooth",
    peak: [2200, 1.2],
    highpass: 250,
    attack: 0.01,
    release: 0.04,
    droop: 0.97,
    jitter: 0,
    gain: 0.215,
  },
  ape: {
    tones: [610],
    wave: "square",
    peak: [2600, 1.5],
    highpass: 500,
    attack: 0.006,
    release: 0.03,
    droop: 0.95,
    jitter: 0.01,
    gain: 0.185,
  },
  truck: {
    tones: [150, 185],
    wave: "sawtooth",
    peak: [900, 0.8],
    highpass: 80,
    attack: 0.09,
    release: 0.18,
    droop: 0.94,
    jitter: 0,
    gain: 0.1,
  },
  carabinieri: {
    tones: [410, 500],
    wave: "sawtooth",
    peak: [2400, 1.2],
    highpass: 250,
    attack: 0.01,
    release: 0.04,
    droop: 0.98,
    jitter: 0,
    gain: 0.112,
  },
} as const satisfies Record<VehicleModel, HornSpec>

/** A train's horn's tones, Hz: EN 15153-2's pair (660 ± 30 and 370 ± 20; UIC 644's 660 ± 15 and 370 ± 10). */
export const TRAIN_TONES = { high: 660, low: 370 } as const
/** A train's two horns, one per tone, pneumatic like the truck's: a slow attack as the air comes up. */
const TRAIN_HORN = {
  high: {
    tones: [TRAIN_TONES.high],
    wave: "sawtooth",
    peak: [1200, 0.7],
    highpass: 250,
    attack: 0.12,
    release: 0.2,
    droop: 0.95,
    jitter: 0,
    gain: 0.21,
  },
  low: {
    tones: [TRAIN_TONES.low],
    wave: "sawtooth",
    peak: [1200, 0.7],
    highpass: 250,
    attack: 0.12,
    release: 0.2,
    droop: 0.95,
    jitter: 0,
    gain: 0.21,
  },
} as const satisfies Record<"high" | "low", HornSpec>
/** An AI train's blasts: the moderately long one (RFI art. 5: "un fischio prolungato moderatamente", 1–2 s), s; the alarm's (art. 7: more than three short), each and the gap after it, s: over in 1.6 s, before the driver sounds it again 2 s on. */
const LONG_BLAST = [1.2, 1.8] as const,
  ALARM = { blasts: 4, held: 0.3, gap: 0.1 } as const

/** The bitonale: low and high tone (Hz) and how long each lasts (s), D.M. 20/03/1979. */
const SIREN = { low: 466, high: 622, seconds: 0.75 } as const
/** Siren and beeper output gains: peaks near 0.5. */
const SIREN_GAIN = 0.43,
  BEEPER_GAIN = 0.5

interface HornGraph {
  readonly gate: GainNode
  readonly oscillators: ReadonlyArray<OscillatorNode>
  readonly sources: ReadonlyArray<AudioScheduledSourceNode>
}

/** A horn's nodes into `out`, silent until pressed, started at `start`. */
const hornGraph = (
  ctx: BaseAudioContext,
  out: AudioNode,
  kit: Kit,
  spec: HornSpec,
  cents: AudioNode | undefined,
  start: number,
): HornGraph => {
  const gate = new GainNode(ctx, { gain: 0 })
  const voicing = new BiquadFilterNode(ctx, {
    type: "peaking",
    frequency: spec.peak[0],
    Q: spec.peak[1],
    gain: 9,
  })
  voicing
    .connect(new BiquadFilterNode(ctx, { type: "highpass", frequency: spec.highpass }))
    .connect(gate)
    .connect(out)
  const oscillators = spec.tones.map((frequency) => {
    const osc = new OscillatorNode(ctx, { type: spec.wave, frequency })
    osc.connect(voicing)
    if (cents) cents.connect(osc.detune)
    return osc
  })
  const sources: Array<AudioScheduledSourceNode> = [...oscillators]
  if (spec.jitter > 0) {
    // The slow gust signal, sped up 40×, wobbles the pitch at 1–20 Hz.
    const wobble = new AudioBufferSourceNode(ctx, {
      buffer: kit.gust,
      loop: true,
      playbackRate: 40,
    })
    const depth = new GainNode(ctx, { gain: 1200 * Math.log2(1 + spec.jitter) })
    wobble.connect(depth)
    for (const osc of oscillators) depth.connect(osc.detune)
    sources.push(wobble)
  }
  for (const source of sources) source.start(start)
  return { gate, oscillators, sources }
}

/** Presses the horn at `t`: the pitch climbs out of its droop as the diaphragm (or the air) comes up. */
const press = (horn: HornGraph, spec: HornSpec, t: number): void => {
  horn.oscillators.forEach((osc, i) => {
    osc.frequency.setValueAtTime(spec.tones[i]! * spec.droop, t)
    osc.frequency.setTargetAtTime(spec.tones[i]!, t, spec.attack)
  })
  horn.gate.gain.setTargetAtTime(spec.gain, t, spec.attack / 2)
}

/** A held horn: sounds from its first update until stopped. */
export const horn = builtOnFirst<Extract<Continuous, { readonly kind: "horn" }>>((io, first) => {
  const spec: HornSpec = HORNS[first.model],
    graph = hornGraph(io.ctx, io.out, io.kit, spec, io.cents, 0)
  let pressed = false
  return {
    update: (_, now) => {
      if (!pressed) press(graph, spec, now)
      pressed = true
    },
    stop: (now) => fadeOut(graph.gate, graph.sources, now, spec.release / 3),
  }
})

/** An AI driver's honk: one long press or two short ones. */
export const honk: Shot<Extract<OneShot, { readonly kind: "honk" }>> = {
  play: (io, sound, when) => {
    const spec: HornSpec = HORNS[sound.model],
      graph = hornGraph(io.ctx, io.out, io.kit, spec, undefined, when)
    const presses =
      Math.random() < 0.5
        ? [0.3 + Math.random() * 0.3]
        : [0.12 + Math.random() * 0.08, 0.12 + Math.random() * 0.08]
    let t = when
    for (const held of presses) {
      press(graph, spec, t)
      graph.gate.gain.setTargetAtTime(0, t + held, spec.release / 3)
      t += held + 0.1
    }
    const end = t + spec.release * 2
    for (const source of graph.sources) source.stop(end)
    graph.sources[0]!.onended = () => graph.gate.disconnect()
    return end
  },
}

/** An AI train's blasts from `when`: each tone and how long it is held, s; `random` draws a long blast's length. */
export const trainBlasts = (
  urgent: boolean,
  random: () => number = Math.random,
): ReadonlyArray<{ readonly tone: "high" | "low"; readonly held: number }> =>
  urgent
    ? Array.from({ length: ALARM.blasts }, (_, i) => ({
        tone: i % 2 === 0 ? "high" : "low",
        held: ALARM.held,
      }))
    : [{ tone: "high", held: LONG_BLAST[0] + (LONG_BLAST[1] - LONG_BLAST[0]) * random() }]

/** A train's horn held from its cab: the high tone, sounding from its first update until stopped. */
export const trainHorn: VoiceFactory<Extract<Continuous, { readonly kind: "trainHorn" }>> = (
  io,
) => {
  const spec: HornSpec = TRAIN_HORN.high,
    graph = hornGraph(io.ctx, io.out, io.kit, spec, io.cents, 0)
  let pressed = false
  return {
    update: (_, now) => {
      if (!pressed) press(graph, spec, now)
      pressed = true
    },
    stop: (now) => fadeOut(graph.gate, graph.sources, now, spec.release / 3),
  }
}

/** An AI train's horn: one moderately long high blast, or the alarm. */
export const trainHonk: Shot<Extract<OneShot, { readonly kind: "trainHonk" }>> = {
  play: (io, sound, when) => {
    const graphs = {
      high: hornGraph(io.ctx, io.out, io.kit, TRAIN_HORN.high, undefined, when),
      low: hornGraph(io.ctx, io.out, io.kit, TRAIN_HORN.low, undefined, when),
    }
    let t = when
    for (const { tone, held } of trainBlasts(sound.urgent)) {
      const spec: HornSpec = TRAIN_HORN[tone]
      press(graphs[tone], spec, t)
      graphs[tone].gate.gain.setTargetAtTime(0, t + held, spec.release / 3)
      t += held + ALARM.gap
    }
    const end = t + TRAIN_HORN.high.release * 2
    for (const graph of Object.values(graphs)) {
      for (const source of graph.sources) source.stop(end)
      graph.sources[0]!.onended = () => graph.gate.disconnect()
    }
    return end
  },
}

/**
 * A square LFO at `hz`, `high` first, into `param`, with edges rounded by a lowpass at `smooth` Hz. The
 * built-in square is normalised to its Gibbs overshoot, so its plateaus sit near ±0.85: a waveshaper
 * flattens them to exactly `low` and `high`.
 */
const squareLfo = (
  ctx: BaseAudioContext,
  hz: number,
  low: number,
  high: number,
  smooth: number,
  param: AudioParam,
): OscillatorNode => {
  const lfo = new OscillatorNode(ctx, { type: "square", frequency: hz })
  lfo
    .connect(new WaveShaperNode(ctx, { curve: new Float32Array([low, low, high, high]) }))
    .connect(new BiquadFilterNode(ctx, { type: "lowpass", frequency: smooth, Q: -3 }))
    .connect(param)
  lfo.start()
  return lfo
}

/** The Carabinieri two-tone siren, high tone first. */
export const siren: VoiceFactory<Extract<Continuous, { readonly kind: "siren" }>> = (io) => {
  const { ctx } = io
  const tone = new OscillatorNode(ctx, { type: "square", frequency: 0 })
  const lfo = squareLfo(ctx, 1 / (2 * SIREN.seconds), SIREN.low, SIREN.high, 25, tone.frequency)
  io.cents.connect(tone.detune)
  const output = new GainNode(ctx, { gain: 0 })
  // The horn speaker's band.
  tone
    .connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 1600, Q: 0.6 }))
    .connect(output)
    .connect(io.out)
  tone.start()
  return {
    update: (_, now) => glide(output.gain, SIREN_GAIN, now, false),
    stop: (now) => fadeOut(output, [tone, lfo], now),
  }
}

/** The truck's reversing alarm, on first. */
export const beeper: VoiceFactory<Extract<Continuous, { readonly kind: "beeper" }>> = (io) => {
  const { ctx } = io
  const tone = new OscillatorNode(ctx, { type: "triangle", frequency: 1000 }),
    gate = new GainNode(ctx, { gain: 0 })
  // Fully on, fully off, with 2 ms ramps against clicks.
  const lfo = squareLfo(ctx, 1, 0, 1, 150, gate.gain)
  io.cents.connect(tone.detune)
  const output = new GainNode(ctx, { gain: 0 })
  tone.connect(gate).connect(output).connect(io.out)
  tone.start()
  return {
    update: (_, now) => glide(output.gain, BEEPER_GAIN, now, false),
    stop: (now) => fadeOut(output, [tone, lfo], now),
  }
}
