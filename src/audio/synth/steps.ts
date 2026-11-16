/**
 * Footsteps (Farnell, Designing Sound ch. 26): each step is a heel strike then the ball of the
 * foot, every strike a low thump, a band-passed noise burst coloured by the surface, and its
 * grains: gravel crunch, leaf crackle, the stone "tock" of a lastricato, the low hiss of beach sand,
 * the soft crunch of snow lying on any of them. Four variants per surface (and snow) and gait are
 * baked once per context and played with ±8 % rate and ±2 dB, so no two steps match.
 *
 * @module audio/synth/steps
 */
import { bufferOf } from "../buffers.ts"
import type { Kit, OneShot, Shot, Surface } from "../types.ts"
import {
  bake,
  burst,
  jitter,
  jitterDb,
  normalise,
  perContext,
  pick,
  ping,
  playBuffer,
  trimmed,
} from "./graph.ts"

/** How a surface sounds underfoot (synthesis.md §7 starting points, levels TUNED by rendering). */
interface Tread {
  /** Level of the 110 Hz body thump (τ 12 ms). */
  readonly thump: number
  /** The main burst: band-pass centre (Hz) and Q, attack and decay time constant (s). */
  readonly hz: number
  readonly q: number
  readonly attack: number
  readonly decay: number
  /** Noise grains per heel strike (3 ms, around `grainHz`, up to `grit` loud) and damped ~900 Hz stone knocks. */
  readonly grains: number
  readonly grainHz: number
  readonly grit: number
  readonly tocks: number
}

const TREADS = {
  asphalt: {
    thump: 0.5,
    hz: 2200,
    q: 1.2,
    attack: 0.004,
    decay: 0.01,
    grains: 0,
    grainHz: 0,
    grit: 0,
    tocks: 0,
  },
  // Italian lastricato: a harder click and loose slabs knocking.
  stone: {
    thump: 0.6,
    hz: 3000,
    q: 1.5,
    attack: 0.002,
    decay: 0.007,
    grains: 0,
    grainHz: 0,
    grit: 0,
    tocks: 2,
  },
  gravel: {
    thump: 0.3,
    hz: 600,
    q: 0.8,
    attack: 0.006,
    decay: 0.04,
    grains: 30,
    grainHz: 3500,
    grit: 0.45,
    tocks: 0,
  },
  // Packed earth: between gravel and grass, a duller thud with a little grit.
  dirt: {
    thump: 0.4,
    hz: 900,
    q: 0.7,
    attack: 0.008,
    decay: 0.03,
    grains: 12,
    grainHz: 3000,
    grit: 0.3,
    tocks: 0,
  },
  grass: {
    thump: 0.15,
    hz: 1200,
    q: 0.5,
    attack: 0.015,
    decay: 0.04,
    grains: 6,
    grainHz: 5000,
    grit: 0.15,
    tocks: 0,
  },
  // The autumn forest floor: like grass, under a crackle of dry leaves.
  leaves: {
    thump: 0.1,
    hz: 1500,
    q: 0.5,
    attack: 0.01,
    decay: 0.05,
    grains: 40,
    grainHz: 5500,
    grit: 0.35,
    tocks: 0,
  },
  // Dry beach sand gives under the foot: the heel lands soft, with no knock, the burst is slow and muffled low down, and the
  // grains shifting under the sole are fine and faint, a low hiss rather than gravel's crunch. TUNED by rendering, no
  // recording measured.
  sand: {
    thump: 0.2,
    hz: 400,
    q: 2,
    attack: 0.02,
    decay: 0.05,
    grains: 30,
    grainHz: 900,
    grit: 0.12,
    tocks: 0,
  },
} as const satisfies Record<Surface, Tread>
/**
 * Fresh snow over whatever lies under it: a soft, slow crunch, the thump muffled, the burst low, its grains many and dense over half
 * a second (wet snow near 0 °C does not squeak; that needs −10 °C). TUNED by rendering: a walking step peaks near a grass step's and
 * lasts half again as long (estimated, no recording measured).
 */
const SNOW: Tread = {
  thump: 0.1,
  hz: 800,
  q: 0.7,
  attack: 0.03,
  decay: 0.07,
  grains: 60,
  grainHz: 1500,
  grit: 0.5,
  tocks: 0,
}

/** What a step lands on: a surface, or the snow on it. */
type Ground = Surface | "snow"
const GROUNDS: ReadonlyArray<Ground> = [...(Object.keys(TREADS) as ReadonlyArray<Surface>), "snow"]
const treadOf = (ground: Ground): Tread => (ground === "snow" ? SNOW : TREADS[ground])

const VARIANTS = 4
/** Seconds baked per step: long enough for the slowest tail to die out. */
const SLOT = 0.7

/** Footfalls per second at `speed` m/s on foot: 2 at a walk (2.2 m/s), 3 at a sprint (5.5 m/s). */
export const stepRate = (speed: number): number =>
  Math.min(3.4, Math.max(1.2, 2 + (speed - 2.2) / 3.3))

/** A walking step plays this many dB under a running one (the director's masking counts it too). */
export const WALK_DB = 4

/** Schedules one step on `tread`: the heel, then the ball (sooner when running, which is also `WALK_DB` louder and 20 % brighter). */
const footfall = (oc: OfflineAudioContext, kit: Kit, tread: Tread, run: boolean): void => {
  const out = oc.destination,
    louder = run ? 10 ** (WALK_DB / 20) : 1,
    bright = run ? 1.2 : 1
  for (const [t, weight] of [
    [0, 1],
    [run ? 0.04 : 0.09, 0.6],
  ] as const) {
    const a = weight * louder
    ping(oc, out, t, 110, tread.thump * a, 0.012)
    burst(oc, kit.white, out, t, tread.attack, tread.decay, tread.hz * bright, tread.q, 0.5 * a)
    for (let i = 0; i < Math.round(tread.grains * weight); i++) {
      burst(
        oc,
        kit.white,
        out,
        t + Math.random() * tread.decay * 3,
        0.00075,
        0.001,
        tread.grainHz * bright * jitter(0.4),
        2,
        tread.grit * Math.random() * a,
      )
    }
    for (let i = 0; i < Math.round(tread.tocks * weight); i++) {
      ping(
        oc,
        out,
        t + 0.002 + Math.random() * 0.015,
        900 * jitter(0.15),
        0.25 * jitter(0.5) * a,
        0.006,
      )
    }
  }
}

const keyOf = (ground: Ground, run: boolean): string => `${ground} ${run ? "run" : "walk"}`

const baked = perContext(async (ctx, kit) => {
  const sets = GROUNDS.flatMap((ground) => [false, true].map((run) => ({ ground, run })))
  // One bake at a time: a bake builds its whole graph before its first await, so starting all 64
  // at once built every graph (some 1,600 bursts) in one long task, a stall on the first key press.
  const sounds: Array<Array<Float32Array<ArrayBuffer>>> = []
  for (const { ground, run } of sets) {
    const variants: Array<Float32Array<ArrayBuffer>> = []
    for (let v = 0; v < VARIANTS; v++)
      variants.push(
        trimmed(await bake(ctx.sampleRate, SLOT, (oc) => footfall(oc, kit, treadOf(ground), run))),
      )
    sounds.push(variants)
  }
  // One factor for all, so the surfaces keep their relative levels: a running step on stone peaks at 0.5.
  normalise(sounds.flat(), 0.5, sounds[sets.findIndex((set) => set.ground === "stone" && set.run)])
  return new Map(
    sets.map(({ ground, run }, i) => [
      keyOf(ground, run),
      sounds[i]!.map((samples) => bufferOf(ctx, samples)),
    ]),
  )
})

/** One footstep on `surface`, or in the snow on it, walking or running. */
export const step: Shot<Extract<OneShot, { readonly kind: "step" }>> = {
  prepare: baked.prepare,
  play: (io, { surface, run, snow }, when) => {
    const variants = baked.get(io.ctx)?.get(keyOf(snow ? "snow" : surface, run))
    return variants === undefined
      ? when
      : playBuffer(io, pick(variants), when, jitter(0.08), jitterDb(2))
  },
}
