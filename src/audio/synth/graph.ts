/**
 * Web Audio building blocks every synth shares: moving params, a voice built from its first params,
 * a voice's output stage and its fade-out, struck sources, noise bursts, textures that never repeat
 * (`shuffled`) and damped pings, one-shots baked offline and cached per context, one-shots rendered
 * in pure TypeScript per params object, and playing a baked buffer with a little random variation.
 *
 * Every function builds nodes only when called, so Node can import the synths.
 *
 * @module audio/synth/graph
 */
import { bufferOf } from "../buffers.ts"
import type { Kit, ShotIo, Voice, VoiceFactory, VoiceIo } from "../types.ts"

/** Time constant (s) for continuous params: about two frames, which removes zipper noise. */
const TAU = 0.05

/** A random element of `list`. */
export const pick = <T>(list: ReadonlyArray<T>): T => list[Math.floor(Math.random() * list.length)]!

/** A factor within ±`spread` of 1. */
export const jitter = (spread: number): number => 1 + (Math.random() * 2 - 1) * spread

/** A gain within ±`db` dB of 1. */
export const jitterDb = (db: number): number => 10 ** (((Math.random() * 2 - 1) * db) / 20)

/** A value drawn over `range`. */
export const draw = ([lo, hi]: readonly [number, number]): number => lo + (hi - lo) * Math.random()
/** A value drawn over `range` evenly per octave. */
export const drawLog = ([lo, hi]: readonly [number, number]): number =>
  lo * (hi / lo) ** Math.random()

/** `x` clamped to 0…1; NaN is 0 (a non-finite AudioParam value throws, which would silence that kind for good). */
export const unit = (x: number): number => Math.min(1, Math.max(0, x)) || 0

/** Moves `param` to `value` at `now`: a jump on a voice's first update (no slide-in), a smooth chase after. */
export const glide = (
  param: AudioParam,
  value: number,
  now: number,
  jump: boolean,
  tau = TAU,
): void => {
  if (jump) param.setValueAtTime(value, now)
  else param.setTargetAtTime(value, now, tau)
}

/** A voice whose nodes are built on its first update, from those params (a vehicle model fixes the graph). */
export const builtOnFirst =
  <P>(build: (io: VoiceIo, first: P) => Voice<P>): VoiceFactory<P> =>
  (io) => {
    let voice: Voice<P> | undefined
    return {
      update: (params, now) => (voice ??= build(io, params)).update(params, now),
      stop: (now) => voice?.stop(now),
    }
  }

/** A continuous voice's last node: fades in from silence into `out`; `fadeOut` ends it. */
export const outlet = (ctx: BaseAudioContext, out: AudioNode): GainNode => {
  const level = new GainNode(ctx, { gain: 0 })
  level.gain.setTargetAtTime(1, ctx.currentTime, 0.1)
  level.connect(out)
  return level
}

/** Fades `output` to silence from `now` (gone within 6τ ≤ 0.3 s), stops `sources` then and detaches `output` once they end. */
export const fadeOut = (
  output: GainNode,
  sources: ReadonlyArray<AudioScheduledSourceNode>,
  now: number,
  tau = TAU,
): void => {
  output.gain.cancelScheduledValues(now)
  output.gain.setTargetAtTime(0, now, tau)
  for (const source of sources) source.stop(now + tau * 6)
  sources[0]!.onended = () => output.disconnect()
}

/** Strikes `source` into `out` at `t`: up to `peak` in 3 ms, then an exponential decay with time constant `tau` s. */
export const strike = (
  ctx: BaseAudioContext,
  source: AudioNode,
  out: AudioNode,
  t: number,
  peak: number,
  tau: number,
): void => {
  const gain = new GainNode(ctx, { gain: 0 })
  source.connect(gain).connect(out)
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(peak, t + 0.003)
  gain.gain.setTargetAtTime(0, t + 0.003, tau)
}

/** Band-passed `noise` at `t`: rises to `peak` in `attack` s, then decays with time constant `tau` s. */
export const burst = (
  ctx: BaseAudioContext,
  noise: AudioBuffer,
  out: AudioNode,
  t: number,
  attack: number,
  tau: number,
  hz: number,
  q: number,
  peak: number,
): void => {
  const source = new AudioBufferSourceNode(ctx, { buffer: noise }),
    amp = new GainNode(ctx, { gain: 0 })
  source
    .connect(new BiquadFilterNode(ctx, { type: "bandpass", frequency: hz, Q: q }))
    .connect(amp)
    .connect(out)
  amp.gain.setValueAtTime(0, t)
  amp.gain.linearRampToValueAtTime(peak, t + attack)
  amp.gain.setTargetAtTime(0, t + attack, tau)
  source.onended = () => amp.disconnect()
  source.start(t, Math.random() * (noise.duration - 1))
  source.stop(t + attack + 9 * tau)
}

/**
 * A texture's segments: each lasts a draw from `length` s and cross-fades into the next over `seam`
 * s; `update` schedules them `ahead` s ahead (the fire's crackle 0.3 s), more than a segment's
 * shortest, so a frame that comes late finds the next one already planned.
 */
const TEXTURE = { length: [0.3, 0.9], seam: 0.03, ahead: 0.5 } as const

/**
 * The segments a texture starts at `now` to play on `TEXTURE.ahead` s, from `next` (or `now`, when
 * a stalled frame left it behind): where each starts, s, how long it lasts and where in the buffer
 * it starts (0…1); and where the one after them starts.
 */
export const segmentsUntil = (
  next: number,
  now: number,
  random: () => number = Math.random,
): {
  readonly segments: ReadonlyArray<{
    readonly at: number
    readonly length: number
    readonly offset: number
  }>
  readonly next: number
} => {
  const segments: Array<{ at: number; length: number; offset: number }> = []
  let t = Math.max(next, now)
  for (; t < now + TEXTURE.ahead; t += segments.at(-1)!.length) {
    const [lo, hi] = TEXTURE.length
    segments.push({ at: t, length: lo + (hi - lo) * random(), offset: random() })
  }
  return { segments, next: t }
}

/** Equal-power fades over a seam (16 steps): the next segment in, the last out; uncorrelated grains keep their power through it. */
const FADE_IN = Float32Array.from({ length: 16 }, (_, i) => Math.sin(((i / 15) * Math.PI) / 2)),
  FADE_OUT = FADE_IN.slice().reverse()

/** A texture that never repeats (`shuffled`). */
export interface Texture {
  /** Schedules the texture to `TEXTURE.ahead` s past `now`: call it every frame. */
  readonly update: (now: number) => void
  /** The rate every segment plays the buffer at. */
  readonly rate: AudioParam
  /** The source that drives `rate`: stop it with the voice's sources (`fadeOut`); the segments end by themselves. */
  readonly control: ConstantSourceNode
}

/**
 * `buffer` into `out` at `rate` as a texture with no period: segments from random offsets,
 * each cross-faded into the next (`TEXTURE`, `segmentsUntil`), each shifted by `detune` (cents)
 * when given, as a source's own detune is, through one tap of the texture's own: the emitter
 * disconnects its cents wholesale when it is freed, which would leave a segment's own disconnect
 * nothing to cut (an InvalidAccessError as each tyre voice stopped). A plain `loop` of the kit's 3 s grains repeats its
 * pattern every 3 s, every 1.5 s at double speed: the wind's leaves did, the same crackle landing
 * on the same footstep at a walk.
 */
export const shuffled = (
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  out: AudioNode,
  rate = 1,
  detune?: AudioNode,
): Texture => {
  const control = new ConstantSourceNode(ctx, { offset: rate })
  control.start()
  const tap = detune === undefined ? undefined : detune.connect(new GainNode(ctx))
  let next = 0
  return {
    update: (now) => {
      const planned = segmentsUntil(next, now)
      for (const { at, length, offset } of planned.segments) {
        // The rate is the control's alone: the segment's own is 0.
        const source = new AudioBufferSourceNode(ctx, { buffer, loop: true, playbackRate: 0 }),
          amp = new GainNode(ctx, { gain: 0 })
        control.connect(source.playbackRate)
        tap?.connect(source.detune)
        source.connect(amp).connect(out)
        amp.gain.setValueCurveAtTime(FADE_IN, at, TEXTURE.seam)
        amp.gain.setValueCurveAtTime(FADE_OUT, at + length, TEXTURE.seam)
        source.onended = () => {
          amp.disconnect()
          control.disconnect(source.playbackRate)
          tap?.disconnect(source.detune)
        }
        source.start(at, offset * buffer.duration)
        source.stop(at + length + TEXTURE.seam)
      }
      next = planned.next
    },
    rate: control.offset,
    control,
  }
}

/** A sine at `hz` struck at `t` with amplitude `peak`, decaying with time constant `tau` s for `seconds`: thumps, knocks, bell partials. */
export const ping = (
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  hz: number,
  peak: number,
  tau: number,
  seconds = 9 * tau,
): void => {
  const tone = new OscillatorNode(ctx, { frequency: hz }),
    amp = new GainNode(ctx, { gain: 0 })
  tone.connect(amp).connect(out)
  amp.gain.setValueAtTime(peak, t)
  amp.gain.setTargetAtTime(0, t, tau)
  tone.onended = () => amp.disconnect()
  tone.start(t)
  tone.stop(t + seconds)
}

/** The largest absolute sample. */
const peakOf = (samples: Float32Array): number =>
  samples.reduce((peak, v) => Math.max(peak, Math.abs(v)), 0)

/** Scales `sounds` in place by one factor so the loudest of `reference` peaks at `peak`, keeping their relative levels. */
export const normalise = (
  sounds: ReadonlyArray<Float32Array>,
  peak: number,
  reference: ReadonlyArray<Float32Array> = sounds,
): void => {
  const loudest = Math.max(...reference.map(peakOf))
  if (loudest === 0) return
  for (const samples of sounds)
    for (let i = 0; i < samples.length; i++) samples[i]! *= peak / loudest
}

/** Renders the mono sound `build` schedules from time 0, `seconds` long at `rate` Hz, offline. */
export const bake = async (
  rate: number,
  seconds: number,
  build: (oc: OfflineAudioContext) => void,
): Promise<Float32Array<ArrayBuffer>> => {
  // One context per sound: every node runs for its context's whole length, so sharing one would cost count² time.
  const oc = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.ceil(rate * seconds),
    sampleRate: rate,
  })
  build(oc)
  return (await oc.startRendering()).getChannelData(0)
}

/** `sound` without its trailing silence (below −80 dB): a bake made long enough for its slowest variant. */
export const trimmed = (sound: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> => {
  let end = sound.length
  while (end > 1 && Math.abs(sound[end - 1]!) < 1e-4) end--
  return sound.slice(0, end)
}

/** A shot's baked buffers, made once per context: `prepare` bakes them, `get` is undefined until that resolves. */
export const perContext = <T>(make: (ctx: BaseAudioContext, kit: Kit) => Promise<T>) => {
  const jobs = new WeakMap<BaseAudioContext, Promise<void>>(),
    ready = new WeakMap<BaseAudioContext, T>()
  return {
    prepare: (ctx: BaseAudioContext, kit: Kit): Promise<void> => {
      const job = jobs.get(ctx) ?? make(ctx, kit).then((value) => void ready.set(ctx, value))
      jobs.set(ctx, job)
      return job
    },
    get: (ctx: BaseAudioContext): T | undefined => ready.get(ctx),
  }
}

/** Plays `buffer` into `io.out` at `when`, sped up by `rate` and scaled by `gain`; returns the context time it ends. */
export const playBuffer = (
  io: ShotIo,
  buffer: AudioBuffer,
  when: number,
  rate = 1,
  gain = 1,
): number => {
  const source = new AudioBufferSourceNode(io.ctx, { buffer, playbackRate: rate }),
    amp = new GainNode(io.ctx, { gain })
  source.connect(amp).connect(io.out)
  source.onended = () => amp.disconnect()
  source.start(when)
  return when + buffer.duration / rate
}

/** The rate a pure-TypeScript render plays at on `ctx`, Hz: the device's up to 48 kHz (above it Web Audio resamples: a mode costs a step a sample, so 96 kHz would double the cost for nothing audible). */
export const renderRate = (ctx: BaseAudioContext): number => Math.min(ctx.sampleRate, 48000)

/**
 * A one-shot's `play` that renders it with `render` (pure TypeScript, on the main thread) at `renderRate`, from its exact params and
 * `Math.random`, and keeps the render per params object: the director's echoes of a sound pass the same object, played again later
 * and fainter, and replay it instead of rendering anew.
 */
export const rendered = <P extends object>(
  render: (sound: P, sampleRate: number, random: () => number) => Float32Array<ArrayBuffer>,
) => {
  const renders = new WeakMap<P, AudioBuffer>()
  return (io: ShotIo, sound: P, when: number): number => {
    let buffer = renders.get(sound)
    if (buffer === undefined)
      renders.set(
        sound,
        (buffer = bufferOf(
          io.ctx,
          render(sound, renderRate(io.ctx), Math.random),
          renderRate(io.ctx),
        )),
      )
    return playBuffer(io, buffer, when)
  }
}
