/**
 * The audition page's offline renders (lab.ts): a voice held as the director holds it, or a shot
 * played once, into an OfflineAudioContext and measured into a row of the "Render all" table, with
 * anything to look at flagged.
 *
 * @module audio/lab-render
 */
import { measure } from "./measure.ts"
import { engineSpec } from "./synth/engine.ts"
import { LONGEST } from "./synth/thunder.ts"
import { VEHICLE_SHOTS, VEHICLE_VOICES } from "./synth/vehicles.ts"
import { WORLD_SHOTS, WORLD_VOICES } from "./synth/world.ts"
import type { Continuous, Kit, OneShot, Shot, Shots, VoiceFactory, Voices } from "./types.ts"

/** Every continuous kind's voice. */
export const VOICES = { ...VEHICLE_VOICES, ...WORLD_VOICES } satisfies Voices
/** Every one-shot kind's shot. */
export const SHOTS = { ...VEHICLE_SHOTS, ...WORLD_SHOTS } satisfies Shots

/** Any sound the page plays. */
export type Sound = Continuous | OneShot

/** The renders' sample rate, Hz. */
export const RATE = 48000
/** Voices settle (fade in) for `settle` s, are measured for `seconds`, then stopped: they must be silent `fade` s later, when the speaker frees their emitter. */
const VOICE_RENDER = { settle: 0.5, seconds: 2, fade: 0.5 } as const
/** Room for the longest shot: a thunder rolls up to `LONGEST` (20 s). */
const SHOT_SECONDS = LONGEST + 2
/** Below this peak a render counts as silent (−80 dBFS); above `CLIP`, as clipping. */
const SILENT = 1e-4,
  CLIP = 0.95
/** An engine at the redline under full load, heard outside, peaks at the nominal 0.5 within this (its `TRIM` is off otherwise). */
const NOMINAL = [0.42, 0.6] as const

/** Whether `sound` is a calibration render (an engine as new) that peaks off nominal. */
const offNominal = (sound: Sound, peak: number): boolean =>
  sound.kind === "engine" &&
  !sound.inside &&
  sound.load === 1 &&
  sound.damage === 0 &&
  sound.rpm === engineSpec(sound.model).redline &&
  (peak < NOMINAL[0] || peak > NOMINAL[1])
/** Whether `sound` is an engine peaking over its nominal: worn or misfiring, it must not. */
const overNominal = (sound: Sound, peak: number): boolean =>
  sound.kind === "engine" && peak > NOMINAL[1]

/** One line of the render table. */
export interface Row {
  readonly name: string
  readonly params: string
  readonly peak: number
  /** dBFS. */
  readonly rms: number
  /** Spectral centroid, Hz. */
  readonly centroid: number
  readonly nan: boolean
  /** How long it sounds: the voice's measured span, the shot's own end time. */
  readonly seconds: number
  /** Anything to look at: silent, clipping, an engine off or over its nominal peak, NaN, sound after its stop or end. */
  readonly flags: string
}

/** A param's value; a nested one's values joined by "/" (body=panda/front). */
const shown = (value: unknown): string =>
  typeof value === "object" && value !== null
    ? Object.values(value).map(shown).join("/")
    : String(value)
/** `sound`'s params as the table shows them, `name=value` but its kind. */
export const paramsOf = (sound: Sound): string =>
  Object.entries(sound)
    .filter(([name]) => name !== "kind")
    .map(([name, value]) => `${name}=${shown(value)}`)
    .join(" ")

/** The row for `sound` (shown as `params`) measured over [from, to] s of `audio`, which must be silent from `quiet` s on. */
const rowOf = (
  sound: Sound,
  audio: AudioBuffer,
  from: number,
  to: number,
  quiet: number,
  params = paramsOf(sound),
): Row => {
  const span = (a: number, b: number) =>
    Array.from({ length: audio.numberOfChannels }, (_, c) =>
      audio.getChannelData(c).subarray(Math.floor(a * RATE), Math.floor(b * RATE)),
    )
  const m = measure(span(from, to), RATE),
    after = measure(span(quiet, audio.duration), RATE)
  const flags = [
    m.peak < SILENT && "silent",
    m.peak > CLIP && "clips",
    offNominal(sound, m.peak) ? "off nominal" : overNominal(sound, m.peak) && "over nominal",
    (m.nan || after.nan) && "NaN",
    after.peak > SILENT && `${after.peak.toFixed(4)} after its end`,
  ]
  return {
    name: sound.kind,
    params,
    peak: Number(m.peak.toFixed(3)),
    rms: Number(m.rms.toFixed(1)),
    centroid: Math.round(m.centroid),
    nan: m.nan || after.nan,
    seconds: Number((to - from).toFixed(2)),
    flags: flags.filter((flag) => flag !== false).join(", "),
  }
}

/** `sound` held for 2.5 s as the director holds it, at 60 frames a second (its params at `t` s from `at`), then stopped. */
export const renderVoice = async (
  kit: Kit,
  sound: Continuous,
  at: (t: number) => Continuous = () => sound,
  params?: string,
): Promise<Row> => {
  const { settle, seconds, fade } = VOICE_RENDER,
    end = settle + seconds
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil((end + fade + 0.05) * RATE),
    sampleRate: RATE,
  })
  const cents = new ConstantSourceNode(ctx, { offset: 0 })
  cents.start()
  const voice = (VOICES[sound.kind] as VoiceFactory<Continuous>)({
    ctx,
    out: ctx.destination,
    cents,
    kit,
  })
  // Frames at 60 Hz, as the director would hold it.
  for (let t = 0; t < end; t += 1 / 60) voice.update(at(t), t)
  voice.stop(end)
  return rowOf(sound, await ctx.startRendering(), settle, end, end + fade, params)
}

/** `sound` played once at 0 s, measured to its own end. */
export const renderShot = async (kit: Kit, sound: OneShot): Promise<Row> => {
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: SHOT_SECONDS * RATE,
    sampleRate: RATE,
  })
  const shot = SHOTS[sound.kind] as Shot<OneShot>
  await shot.prepare?.(ctx, kit)
  // A fresh params object: the crash and the explosion keep one render per object, and every run should draw anew.
  const end = Math.min(SHOT_SECONDS, shot.play({ ctx, out: ctx.destination, kit }, { ...sound }, 0))
  // The speaker frees a shot's emitter 0.1 s after its end.
  return rowOf(sound, await ctx.startRendering(), 0, end, Math.min(SHOT_SECONDS, end + 0.1))
}
