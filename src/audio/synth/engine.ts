/**
 * Engine voices (synthesis.md §2.1–2.2): one oscillator at the firing frequency (a sawtooth, or a
 * band-limited pulse for a two-stroke or a diesel), a half-order sub, a tanh waveshaper whose drive
 * follows the load, two exhaust formants, a lowpass opening with revs, and bandpassed noise gated at
 * the firing rate (diesel clatter, two-stroke rattle). A turbo adds a whine that spools up with lag.
 * The revs and load are the sim's (`engineRevs`, or a train's `trainRevs`); the timbre comes from how
 * the engine is built (`engineSpec`, `timbreOf`): its cycle and fuel, its cylinders and its displacement.
 * Crash damage wears it (`WORN`): duller and softer, rough, knocking, cut out by the sim's misfires
 * with a backfire; an engine as new plays exactly as built.
 *
 * Levels: every model's output peaks near 0.5 at the redline under full load (its measured `TRIM`)
 * and sits about 20 dB lower at idle. How loud each model is (physics.md §8) is the director's
 * per-model source level, and so is the own engine's level inside: `inside` only changes the tone
 * (the firewall's dull, boomy filter, physics.md §10).
 *
 * @module audio/synth/engine
 */
import { STAGE_FROM } from "../../sim/damage.ts"
import { TRAIN_MODELS, TRAINS, type TrainModel } from "../../sim/rail/models.ts"
import { type EngineSpec, VEHICLES } from "../../sim/vehicles.ts"
import { loop, smoothstep, tanhCurve } from "../buffers.ts"
import type { Continuous, EngineModel, Voice, VoiceIo } from "../types.ts"
import { builtOnFirst, burst, fadeOut, glide, jitter, unit } from "./graph.ts"

type EngineSound = Extract<Continuous, { readonly kind: "engine" }>

/** One engine's sound, derived from how it is built (`timbreOf`). */
export interface Timbre {
  /** Firing pulses per crank revolution: cylinders / 2 for a four-stroke, cylinders for a two-stroke. */
  readonly pulses: number
  /** The firing waveform: a sawtooth, or a pulse with this duty cycle. */
  readonly wave: "sawtooth" | number
  /** Level of the half-order triangle (uneven firing, the two-stroke's "ring-ding"). */
  readonly sub: number
  /** Exhaust resonances: Hz, Q, gain. */
  readonly formants: ReadonlyArray<readonly [hz: number, q: number, gain: number]>
  /** Lowpass at idle and at the redline under load, Hz. */
  readonly lowpass: readonly [idle: number, redline: number]
  /** Highpass, Hz: thins small engines. */
  readonly highpass: number
  /** Extra waveshaper drive at full load. */
  readonly drive: number
  /** Mechanical noise: level, band swept with revs (Hz), Q, and how much the firing pulse gates it. */
  readonly noise: {
    readonly level: number
    readonly band: readonly [number, number]
    readonly q: number
    readonly pulse: number
  }
  /** Turbo whine level at full boost; 0 for none. */
  readonly turbo: number
  /** Idle and redline, rpm. */
  readonly idle: number
  readonly redline: number
  /** 1 / the patch's own peak at the redline under full load. */
  readonly trim: number
  /** A worn engine's knock at full damage, measured: idling at damage 0.9 it plays 16 dB (RMS) under the firing tone. */
  readonly knock: number
}

/**
 * What the cycle and the fuel give an engine, whatever its size: the firing waveform, how many
 * harmonics of the firing frequency the lowpass keeps at the redline, the mechanical noise (the
 * diesel's knock and the two-stroke's rattle gated at the firing rate, the petrol four's valve
 * train not), the formants' Q, gains and spacing, how far above the first formant the idle lowpass
 * sits and how far under it the highpass, and the waveshaper's drive. Fitted to the four hand-tuned
 * engines this replaced (docs/audio.md).
 */
const CYCLES = {
  petrol: {
    wave: "sawtooth",
    harmonics: 20,
    noise: { level: 0.05, band: [800, 3000], q: 1.1, pulse: 0 },
    q: [2.5, 3],
    gains: [0.6, 0.25],
    spacing: 3.3,
    idle: 2.7,
    highpass: 1 / 8,
    drive: 2.5,
  },
  diesel: {
    wave: 0.3,
    harmonics: 11,
    noise: { level: 0.075, band: [1500, 2500], q: 1.5, pulse: 0.6 },
    q: [2.5, 3],
    gains: [0.6, 0.25],
    spacing: 3.3,
    idle: 2.7,
    highpass: 1 / 8,
    drive: 2.5,
  },
  // A short, sharp port-timed pulse through an expansion chamber: thin, bright, buzzy.
  twoStroke: {
    wave: 0.12,
    harmonics: 66,
    noise: { level: 0.1, band: [1500, 4500], q: 1, pulse: 0.15 },
    q: [3, 4],
    gains: [0.7, 0.35],
    spacing: 2.3,
    idle: 2,
    highpass: 1 / 5,
    drive: 4,
  },
} as const

/** The first exhaust formant of a 1242 cm³ four (Hz); it scales as the cube root of the swept volume (a resonance goes as 1/length). */
const F1 = 330,
  F1_CC = 1242
/** A two-stroke's expansion chamber rings this much higher than a four-stroke's pipe of its size. */
const CHAMBER = 1.3

/**
 * An engine's timbre from how it is built: pulses from its cylinders and cycle, waveform and noise from
 * its cycle and fuel, the sub from the size of each cylinder (0.25 at 310 cm³), the formants and the
 * idle lowpass from its displacement (size scaling), the redline lowpass from its firing frequency
 * there, a turbo's whine, tighter formants and harder drive only with a turbo. `exhaust` moves the
 * formants for an exhaust voiced unlike its size; `trim` is the measured 1 / peak, `knock` the measured knock.
 */
export const timbreOf = (engine: EngineSpec, trim = 1, exhaust = 1, knock = 0): Timbre => {
  const cycle = engine.strokes === 2 ? CYCLES.twoStroke : CYCLES[engine.fuel],
    turbo = engine.aspiration === "turbo"
  const pulses = engine.strokes === 4 ? engine.cylinders / 2 : engine.cylinders
  const f1 =
    F1 * (engine.displacement / F1_CC) ** (-1 / 3) * (engine.strokes === 2 ? CHAMBER : 1) * exhaust
  const tight = turbo ? 0.8 : 1
  return {
    pulses,
    wave: cycle.wave,
    sub: Math.min(
      0.4,
      Math.max(0.1, 0.25 + 0.15 * Math.log10(engine.displacement / engine.cylinders / 310)),
    ),
    formants: [
      [f1, cycle.q[0] * tight, turbo ? 0.8 : cycle.gains[0]],
      [f1 * cycle.spacing, cycle.q[1] * tight, turbo ? 0.35 : cycle.gains[1]],
    ],
    lowpass: [cycle.idle * f1, cycle.harmonics * (engine.redline / 60) * pulses],
    highpass: Math.max(30, f1 * cycle.highpass),
    drive: cycle.drive + (turbo ? 1 : 0),
    noise: { ...cycle.noise, level: cycle.noise.level * tight },
    // The diesel's bigger turbo whines louder.
    turbo: turbo ? (engine.fuel === "diesel" ? 0.02 : 0.015) : 0,
    idle: engine.idle,
    redline: engine.redline,
    trim,
    knock,
  }
}

/**
 * MEASURED: 1 / each model's own peak at the redline under full load, from the audition page's renders at
 * {rpm: redline, load: 1} in headless Chrome (three runs within 0.001 of each other; `window.lab.renderAll()`
 * flags a row off the nominal 0.42–0.6). Re-measure after any change to `timbreOf` or the graph.
 */
const TRIM = {
  panda: 0.488,
  ape: 0.316,
  truck: 0.371,
  carabinieri: 0.469,
  atr220: 0.382,
} as const satisfies Record<EngineModel, number>
/**
 * MEASURED: each model's knock at full damage (`Timbre.knock`), so that idling at damage 0.9 it plays 16 dB (RMS) under the
 * firing tone (the seeded render with the knock against the same without it, in headless Chrome). A thin Ape needs little, the
 * truck's loud diesel much. Re-measure after any change to the graph. Trains take no damage: none.
 */
const KNOCK = {
  panda: 4,
  ape: 1.5,
  truck: 8,
  carabinieri: 5.5,
  atr220: 0,
} as const satisfies Record<EngineModel, number>
/** Voicing where size alone is wrong: the Giulia's sports exhaust plays a quarter lower than its 2 l would (210 Hz, not 282). */
const EXHAUST = {
  panda: 1,
  ape: 1,
  truck: 1,
  carabinieri: 0.75,
  atr220: 1,
} as const satisfies Record<EngineModel, number>

/** Whether `model` is a train's. */
const isTrain = (model: EngineModel): model is TrainModel =>
  (TRAIN_MODELS as ReadonlyArray<string>).includes(model)

/** How `model`'s engine is built: a vehicle's, or a train's power pack. */
export const engineSpec = (model: EngineModel): EngineSpec =>
  isTrain(model) ? TRAINS[model].engine : VEHICLES[model].engine

/** The timbre of `model`'s engine. */
export const timbre = (model: EngineModel): Timbre =>
  timbreOf(engineSpec(model), TRIM[model], EXHAUST[model], KNOCK[model])

/** The own engine heard from the driver's seat, behind the firewall (physics.md §10). */
export const CABIN = { lowpass: 2500, shelf: 4 } as const

/** How one vehicle differs from another of its model, from its `variant` 0…1: ±2 % in pitch, ±4 % in its exhaust formants. */
export const variation = (variant: number) => ({
  pitch: 1 + 0.04 * (variant - 0.5),
  formant: 1 + 0.08 * (variant - 0.5),
})

/** Where every param of an engine graph heads. */
interface EngineTargets {
  /** Firing frequency, Hz. */
  readonly hz: number
  readonly drive: number
  readonly lowpass: number
  readonly noiseHz: number
  readonly noise: number
  readonly turboHz: number
  readonly turbo: number
  readonly gain: number
  readonly cabinHz: number
  readonly shelf: number
  /** Damage: how deep the output wobbles, how far the firings' pitch jitters (cents), how loud it knocks; the misfire gate. */
  readonly rough: number
  readonly jitter: number
  readonly knock: number
  readonly gate: number
}

/**
 * What crash damage `w` (0…1) does to an engine's voice. From the first crash it grows duller,
 * softer and weaker (`dull`, `soft`: the shares of its lowpass and of the load's drive gone at
 * w = 1; `weak`: dB off its output gain, which `engineQuiet` counts); from 0.2,
 * the light stage that shows no smoke yet, it runs rough (its output wobbling up to `rough` deep with
 * slow brown noise, its firings jittering up to `jitter` cents with the same noise); from the
 * medium stage it knocks once a crank turn (its measured `Timbre.knock`), loudest off the throttle,
 * half as loud under full load, which masks a real knock and would lift its peaks. While the sim
 * misfires (the severe stage on) the voice falls toward `cut` with time constant `cutTau` s, and each
 * misfire pops a backfire (`backfire`, the bursts' peak). Damage params glide over `glide` s. The
 * output gain only falls with damage; the knock (halved under load) and the backfires are sized so
 * a worn engine still peaks under its nominal (the audition page's worn rows).
 */
const WORN = {
  dull: 0.35,
  soft: 0.3,
  weak: 2,
  rough: 0.4,
  jitter: 40,
  roughFrom: 0.2,
  cut: 0.15,
  cutTau: 0.005,
  backfire: 4,
  glide: 0.3,
} as const
/** The brown noise's playback rate for the wobble (its corner falls from 154 to 77 Hz: lumps, not hiss). */
const LUMPS = 0.5
/** Waveshaper curves: clamped to ±1 (the wobble never lifts the output past its unity gain); the positive half only (a gate). */
const CLIP = Float32Array.of(-1, 1),
  POSITIVE = Float32Array.of(0, 0, 1)

/**
 * The output gain at idle against the redline under full load, dB. The lowpass closing and the light
 * drive take about 9 dB more, so idle sits near 20 dB (RMS) below full.
 */
const IDLE_DB = -11

/** Revs as a share of the way from idle (0) to the redline (1). */
const revsOf = (timbre: Timbre, rpm: number): number =>
  Math.min(1, Math.max(0, (rpm - timbre.idle) / (timbre.redline - timbre.idle)))

/** The gain law's dB under the nominal peak (0 at the redline under full load as new, 11 at idle, `WORN.weak` more at full damage): masking and the voice caps count it. */
const quietOf = (timbre: Timbre, rpm: number, load: number, damage: number): number =>
  -IDLE_DB * (1 - 0.6 * revsOf(timbre, rpm) - 0.4 * load) + WORN.weak * unit(damage)

/**
 * How many dB `model`'s engine plays under its nominal peak at `rpm` and `load`, worn by `damage`, by its gain law (the
 * filters' share at idle, ~9 dB, and a worn engine's duller tone are not counted).
 */
export const engineQuiet = (model: EngineModel, rpm: number, load: number, damage = 0): number =>
  quietOf(timbre(model), rpm, load, damage)

/**
 * The engine law: revs set pitch and brightness, load sets drive and level (revs weigh 60 % of the level range, load 40 %);
 * `damage` dulls, softens, roughens and knocks it (`WORN`), and a `misfire` closes its gate.
 */
export const engineTargets = (
  timbre: Timbre,
  rpm: number,
  load: number,
  inside: boolean,
  variant: number,
  damage = 0,
  misfire = false,
): EngineTargets => {
  const revs = revsOf(timbre, rpm),
    w = unit(damage),
    rough = smoothstep(WORN.roughFrom, 1, w)
  return {
    hz: (rpm / 60) * timbre.pulses * variation(variant).pitch,
    drive: 0.4 + load * timbre.drive * (1 - WORN.soft * w),
    lowpass:
      (timbre.lowpass[0] + (timbre.lowpass[1] - timbre.lowpass[0]) * revs * (0.5 + 0.5 * load)) *
      (1 - WORN.dull * w),
    noiseHz: timbre.noise.band[0] + (timbre.noise.band[1] - timbre.noise.band[0]) * revs,
    noise: timbre.noise.level * (0.3 + 0.7 * load) * (0.4 + revs),
    turboHz: 2500 + 6000 * load * revs,
    turbo: timbre.turbo * load * revs,
    gain: 0.5 * timbre.trim * 10 ** (-quietOf(timbre, rpm, load, damage) / 20),
    cabinHz: inside ? CABIN.lowpass : 20000,
    shelf: inside ? CABIN.shelf : 0,
    rough: WORN.rough * rough,
    jitter: WORN.jitter * rough,
    knock: timbre.knock * smoothstep(STAGE_FROM.medium, 1, w) * (1 - 0.5 * load),
    gate: misfire ? WORN.cut : 1,
  }
}

/** A band-limited pulse of duty cycle `duty`: x(t) = Σ 2/(kπ)·sin(kπD)·cos(kωt) (the DC term is dropped). */
const pulseWave = (ctx: BaseAudioContext, duty: number, harmonics = 48): PeriodicWave => {
  const real = new Float32Array(harmonics),
    imag = new Float32Array(harmonics)
  for (let k = 1; k < harmonics; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty)
  return new PeriodicWave(ctx, { real, imag })
}

/** Turbo spool lag, s. */
const SPOOL = 0.6

const build = (io: VoiceIo, first: EngineSound): Voice<EngineSound> => {
  const { ctx } = io,
    spec = timbre(first.model),
    shift = variation(first.variant).formant
  const firing = new ConstantSourceNode(ctx, { offset: 0 })
  const sources: Array<AudioScheduledSourceNode> = [firing],
    tones: Array<OscillatorNode> = []
  const tone = (options: OscillatorOptions, ratio: number) => {
    const osc = new OscillatorNode(ctx, { ...options, frequency: 0 })
    firing.connect(new GainNode(ctx, { gain: ratio })).connect(osc.frequency)
    io.cents.connect(osc.detune)
    sources.push(osc)
    tones.push(osc)
    return osc
  }
  // Every layer sums into the cabin filters; then the damage's wobble (`lump`) and the misfire `gate`, unity gains until the
  // engine is worn; the output gain is last, so `stop` detaches the whole voice.
  const cabin = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 20000 })
  const shelf = new BiquadFilterNode(ctx, { type: "lowshelf", frequency: 120, gain: 0 })
  const lump = new GainNode(ctx, { gain: 1 }),
    gate = new GainNode(ctx, { gain: 1 }),
    output = new GainNode(ctx, { gain: 0 })
  cabin.connect(shelf).connect(lump).connect(gate).connect(output).connect(io.out)

  const pre = new GainNode(ctx, { gain: 0.4 }),
    lowpass = new BiquadFilterNode(ctx, { type: "lowpass", frequency: spec.lowpass[0] })
  const shaper = new WaveShaperNode(ctx, { curve: tanhCurve(), oversample: "2x" })
  const main = tone(
    spec.wave === "sawtooth" ? { type: "sawtooth" } : { periodicWave: pulseWave(ctx, spec.wave) },
    1,
  )
  main.connect(pre)
  tone({ type: "triangle" }, 0.5)
    .connect(new GainNode(ctx, { gain: spec.sub }))
    .connect(pre)
  pre
    .connect(shaper)
    .connect(lowpass)
    .connect(new BiquadFilterNode(ctx, { type: "highpass", frequency: spec.highpass }))
    .connect(cabin)
  for (const [frequency, Q, gain] of spec.formants) {
    shaper
      .connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: frequency * shift, Q }))
      .connect(new GainNode(ctx, { gain }))
      .connect(cabin)
  }

  const hiss = loop(ctx, io.kit.white),
    band = new BiquadFilterNode(ctx, {
      type: "bandpass",
      frequency: spec.noise.band[0],
      Q: spec.noise.q,
    })
  const hissGain = new GainNode(ctx, { gain: 0 })
  io.cents.connect(hiss.detune)
  hiss.connect(band).connect(hissGain).connect(cabin)
  // Firing-synchronous bursts: the diesel's clatter, the two-stroke's rattle.
  if (spec.noise.pulse > 0)
    tone({ periodicWave: pulseWave(ctx, 0.1) }, 1)
      .connect(new GainNode(ctx, { gain: spec.noise.pulse }))
      .connect(hissGain.gain)

  const turbo =
    spec.turbo > 0
      ? {
          whine: new OscillatorNode(ctx, { frequency: 2500 }),
          gain: new GainNode(ctx, { gain: 0 }),
        }
      : undefined
  if (turbo) {
    io.cents.connect(turbo.whine.detune)
    turbo.whine.connect(turbo.gain).connect(cabin)
    sources.push(turbo.whine)
  }
  for (const source of sources) source.start()
  // `loop` started the noise already.
  sources.push(hiss)

  /** A worn engine's own nodes, built on its first update with damage: few engines ever take any. */
  const wear = () => {
    // Slow brown noise wobbles the output under its unity gain and jitters the firings' pitch.
    const lumps = loop(ctx, io.kit.brown, LUMPS),
      rough = new GainNode(ctx, { gain: 0 }),
      wobble = new GainNode(ctx, { gain: 0 })
    lumps
      .connect(new GainNode(ctx, { gain: 2.5 }))
      .connect(new WaveShaperNode(ctx, { curve: CLIP }))
      .connect(rough)
      .connect(lump.gain)
    lumps.connect(wobble)
    for (const osc of tones) wobble.connect(osc.detune)
    // The knock: a narrow band of noise struck once a crank turn.
    const clatter = loop(ctx, io.kit.white),
      knock = new GainNode(ctx, { gain: 0 }),
      struck = new GainNode(ctx, { gain: 0 })
    io.cents.connect(clatter.detune)
    clatter
      .connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: 1400, Q: 3 }))
      .connect(struck)
      .connect(cabin)
    const crank = tone({ periodicWave: pulseWave(ctx, 0.1) }, 1 / spec.pulses)
    crank
      .connect(new WaveShaperNode(ctx, { curve: POSITIVE }))
      .connect(knock)
      .connect(struck.gain)
    crank.start()
    // Backfires play past the gate, at the engine's own level: 1 / trim is its nominal peak before the output gain.
    const pops = new GainNode(ctx, { gain: 1 / spec.trim })
    pops.connect(output)
    sources.push(lumps, clatter)
    return { rough, wobble, knock, pops }
  }
  /** A bang in the exhaust as a misfire's unburnt charge goes off: a low thump and a crack. */
  const backfire = (out: AudioNode, t: number) => {
    burst(ctx, io.kit.white, out, t, 0.001, 0.02, 180 * jitter(0.2), 0.9, WORN.backfire)
    burst(ctx, io.kit.white, out, t, 0.0005, 0.005, 1500 * jitter(0.2), 0.8, WORN.backfire / 2)
  }

  let fresh = true,
    misfiring = false,
    worn: ReturnType<typeof wear> | undefined
  return {
    update: (sound, now) => {
      const jump = fresh
      fresh = false
      const t = engineTargets(
        spec,
        sound.rpm,
        sound.load,
        sound.inside,
        first.variant,
        sound.damage,
        sound.misfire,
      )
      glide(firing.offset, t.hz, now, jump, 0.04)
      glide(pre.gain, t.drive, now, jump, 0.04)
      glide(lowpass.frequency, t.lowpass, now, jump, 0.04)
      glide(band.frequency, t.noiseHz, now, jump)
      glide(hissGain.gain, t.noise, now, jump)
      glide(output.gain, t.gain, now, false, 0.04)
      glide(cabin.frequency, t.cabinHz, now, jump, 0.1)
      glide(shelf.gain, t.shelf, now, jump, 0.1)
      if (turbo) {
        glide(turbo.whine.frequency, t.turboHz, now, false, SPOOL)
        glide(turbo.gain.gain, t.turbo, now, false, SPOOL)
      }
      if (worn === undefined && unit(sound.damage) > 0) worn = wear()
      if (worn !== undefined) {
        glide(lump.gain, 1 - t.rough, now, jump, WORN.glide)
        glide(worn.rough.gain, t.rough, now, jump, WORN.glide)
        glide(worn.wobble.gain, t.jitter, now, jump, WORN.glide)
        glide(worn.knock.gain, t.knock, now, jump, WORN.glide)
      }
      if (sound.misfire !== misfiring) {
        misfiring = sound.misfire
        glide(gate.gain, t.gate, now, jump, WORN.cutTau)
        if (misfiring && worn !== undefined) backfire(worn.pops, now)
      }
    },
    stop: (now) => fadeOut(output, sources, now),
  }
}

/** An engine: the sim's revs and load, Doppler from `io.cents`, the cabin tone when `inside`, worn by its `damage` and cut by its misfires. */
export const engine = builtOnFirst(build)
