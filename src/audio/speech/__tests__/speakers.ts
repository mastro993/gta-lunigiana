/**
 * The speakers and situations the speech render tests voice, shared by `render.test.ts` and `render.long-test.ts`.
 *
 * @module audio/speech/__tests__/speakers
 */
import type { Situation, Speaker } from "../types.ts"

/** The rate the lines render at, Hz. */
export const RATE = 48000

/** A grown man's voice. */
export const MAN: Speaker = { voice: 0.5, age: "adult", female: false }

/** A voice of each age and sex. */
export const SPEAKERS: ReadonlyArray<Speaker> = [
  MAN,
  { voice: 0.2, age: "adult", female: true },
  { voice: 0.7, age: "kid", female: false },
  { voice: 0.9, age: "elder", female: true },
  { voice: 0.1, age: "elder", female: false },
]

/** Every situation a line is spoken in. */
export const SITUATIONS: ReadonlyArray<Situation> = [
  "greet",
  "chat",
  "reply",
  "laugh",
  "farewell",
  "fright",
  "shock",
  "pity",
  "anger",
  "surprise",
  "helpMan",
  "helpWoman",
  "helpKid",
  "grieve",
  "mum",
  "dad",
  "nonna",
  "nonno",
  "thief",
]

/** The RMS of `samples`. */
export const rms = (samples: Float32Array) =>
  Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length)
