/**
 * A level crossing's bell (*campana*), from a recording of an Italian automatic crossing measured
 * for the trains research (Commons, "Il segnale acustico di un passaggio a livello automatico",
 * CC BY-SA 4.0, analysed only): single strokes 1.287 s apart (46.6 a minute), each ringing until the
 * next, a small bright inharmonic bell whose stroke sits at 3.7–5.2 kHz and falls to a 1.2–2.5 kHz
 * hum, its doublets beating at 25–26 Hz. One period is rendered in pure TypeScript per context: the
 * steady ring of every stroke before it summed in closed form, so the loop wraps on a stroke with
 * no seam, and the voice starts on one. Each box's bell is its own unit, detuned up to ±1.2 % (its
 * `variant`), so two boxes that start ringing in the same step drift apart rather than fuse into one.
 *
 * @module audio/synth/crossing
 */
import { bufferOf } from "../buffers.ts"
import type { Continuous, VoiceFactory } from "../types.ts"
import { builtOnFirst, fadeOut, renderRate } from "./graph.ts"

/** The bell's partials, measured: Hz, level at the stroke (dB re the loudest), T60 (s). */
const PARTIALS = [
  [1233.5, -17, 6.5],
  [1526, -22, 8],
  [1720, -29, 5],
  [2502.6, -20, 5],
  [3737, -4, 2.5],
  [3762.7, -2, 2.1],
  [4398, -8, 0.65],
  [5157, 0, 1.2],
  [5182, -5, 1.5],
  [6720, -7, 0.46],
  [8536, -7, 0.4],
  [10314, -3, 0.45],
] as const
/** Seconds between strokes, measured (9 intervals of 1.285–1.291 s). */
export const STROKE = 1.287
/** The clapper's click: its share of the loudest partial and its time constant, s. */
const CLICK = { level: 0.6, tau: 0.0012 } as const

/**
 * One period of the bell ringing steadily at `rate` Hz, from a stroke: each partial's ring summed over every stroke before it
 * (a·e^(−t/τ)·sin(ωt) for each, a geometric series: Im(e^(iωt)/(1 − r·e^(iωP))), r = e^(−P/τ)), so the period's end runs on
 * into its start as a stroke does; the click a little seeded noise at the stroke. Peaks at 0.5.
 */
export const bellLoop = (rate: number): Float32Array<ArrayBuffer> => {
  const n = Math.round(STROKE * rate),
    period = n / rate,
    out = new Float32Array(n)
  for (const [hz, db, t60] of PARTIALS) {
    const a = 10 ** (db / 20),
      tau = t60 / 6.91,
      w = 2 * Math.PI * hz
    // C = 1 / (1 − r·e^(iψ)), the sum over every earlier stroke.
    const r = Math.exp(-period / tau),
      psi = w * period
    const dr = 1 - r * Math.cos(psi),
      di = r * Math.sin(psi),
      d2 = dr * dr + di * di
    const cr = dr / d2,
      ci = di / d2
    // A decaying phasor, stepped by multiplication: e^(−t/τ)·e^(iωt).
    const step = Math.exp(-1 / (tau * rate)),
      sr = step * Math.cos(w / rate),
      si = step * Math.sin(w / rate)
    let zr = 1,
      zi = 0
    for (let i = 0; i < n; i++) {
      // Im((zr + i·zi)·(cr + i·ci)).
      out[i]! += a * (zi * cr + zr * ci)
      const next = zr * sr - zi * si
      zi = zr * si + zi * sr
      zr = next
    }
  }
  // The clapper's click: a few milliseconds of noise, seeded (an LCG), so every context rings alike.
  let seed = 12345
  for (let i = 0; i < Math.min(n, Math.ceil(10 * CLICK.tau * rate)); i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    out[i]! += CLICK.level * (seed / 2 ** 31 - 1) * Math.exp(-i / (CLICK.tau * rate))
  }
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  for (let i = 0; i < n; i++) out[i]! *= 0.5 / peak
  return out
}

/** Each context's period, rendered on its first bell. */
const loops = new WeakMap<BaseAudioContext, AudioBuffer>()

/** How far a unit's bell is detuned at most, cents (±1.2 %: its pitch and its stroke rate together; an estimate). */
const UNIT_CENTS = 20

/** A crossing's bell, from its first stroke until stopped: its unit's detune from its first `variant`, Doppler from `io.cents`. */
export const plBell: VoiceFactory<Extract<Continuous, { readonly kind: "plBell" }>> = builtOnFirst(
  (io, first) => {
    const { ctx } = io
    let buffer = loops.get(ctx)
    if (buffer === undefined)
      loops.set(ctx, (buffer = bufferOf(ctx, bellLoop(renderRate(ctx)), renderRate(ctx))))
    const source = new AudioBufferSourceNode(ctx, {
        buffer,
        loop: true,
        detune: 2 * UNIT_CENTS * (first.variant - 0.5),
      }),
      output = new GainNode(ctx, { gain: 1 })
    io.cents.connect(source.detune)
    source.connect(output).connect(io.out)
    source.start()
    return {
      update: () => {},
      stop: (now) => fadeOut(output, [source], now),
    }
  },
)
