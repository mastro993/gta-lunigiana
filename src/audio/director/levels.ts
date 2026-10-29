/**
 * The mix's one calibration table. Every source level is dB(A) at 1 m when its synth plays at its
 * nominal 0.5 peak (physics.md §8); `rMin` is the source's size, inside which it gets no louder.
 * Losses on the way stay physical (hearing.ts), and `mixGain` compresses only these levels, so a
 * number here moves one kind against the others and nothing else.
 *
 * Flags, by kind: vehicle voices Doppler-shift (water and the beds are static); every one-shot
 * waits its travel time past `DELAY_FROM`; `echoes` says which one-shots answer off rock faces;
 * `MOST_DB` caps the loudest ones' direct sound; every positional source is occluded (the
 * listener's own car, the beds and thunder are not); a source `aloft` (thunder) takes no ground
 * effect.
 *
 * @module audio/director/levels
 */
import type { Species } from "../../sim/schema.ts"
import type { Speaker } from "../speech/types.ts"
import { rainQuiet } from "../synth/rain.ts"
import type { Continuous, EngineModel, OneShot } from "../types.ts"

/** A source's calibration: dB(A) at 1 m at the synth's nominal peak, its size, m, and whether it stands so far `aloft` that the ground takes nothing on its way. */
export interface Level {
  readonly db: number
  readonly rMin: number
  readonly aloft?: boolean
}

/**
 * Engines at the redline under full load (pass-by levels, physics.md §8): every engine voice peaks alike, so the model's loudness
 * lives here. A train's is one power pack's: TSI Noise (Reg. 1304/2014) lets a diesel unit start at 82–83 dB(A) at 7.5 m with
 * both packs at full power, so one pack is about 80 there, 97 at 1 m (estimated: the limit, not a measurement of the ATR 220).
 */
export const ENGINE = {
  panda: { db: 90, rMin: 2 },
  ape: { db: 92, rMin: 2 },
  truck: { db: 98, rMin: 4 },
  carabinieri: { db: 93, rMin: 2.5 },
  atr220: { db: 97, rMin: 3 },
} as const satisfies Record<EngineModel, Level>

/**
 * The listener's own engine from the driver's seat; the voice makes the cabin tone. TUNED: the voice idles 20–22 dB (RMS)
 * under this in the Panda and the Giulia, so the cabin idles near 46–48 dB(A), as a small car's does; at full load it is quieter than a real cabin
 * (the voice's idle-to-redline range is narrower than an engine's), and well under the outside mix (physics.md §10).
 */
export const OWN_ENGINE_DB = 68

/**
 * The player's own train from its cab, dB(A) at the ears at each synth's nominal peak, as `OWN_ENGINE_DB` is a car's from its
 * seat: the power pack under the cab's car at its rated revs under full power, the wheels at the rolling voice's top speed (130
 * km/h) and the brakes. TUNED: through the cab's 24 dB from the outside levels (`ENGINE.atr220`, `ROLLING`), compressed as
 * sources 97 dB(A) loud and more, the cab played 24–25 dB under a car's seat, its idling packs 13.8 dB under the wind bed;
 * here it idles near a car's idle and runs at line speed near a car under load. TSI Noise lets a driver's cab reach 78 dB(A) at
 * top speed.
 */
export const OWN_TRAIN_DB = { pack: 66, rails: 72, brakes: 64 } as const

/** Every other positional kind. Tyres at their squeal-capable peak; the step is a running step on stone. */
export const LEVELS = {
  tyres: { db: 98, rMin: 2 },
  scrape: { db: 105, rMin: 2 },
  horn: { db: 116, rMin: 2 },
  siren: { db: 117, rMin: 2.5 },
  beeper: { db: 100, rMin: 2 },
  // TUNED (estimated, no recording measured): a car burning out, its roar and crackle; checked to sit 3–6 dB over an idling Panda.
  fire: { db: 82, rMin: 2 },
  crash: { db: 115, rMin: 2 },
  // TUNED (estimated, no recording measured): a burning car's fuel going up, 9 dB over the reference crash (5.4 in the mix), the size of its fireball.
  explosion: { db: 124, rMin: 3 },
  thud: { db: 85, rMin: 1 },
  // TUNED (estimated, no recording measured): a car slamming its bump stops at 5 m/s, 20 dB under a Panda's crash at that speed (105).
  clunk: { db: 85, rMin: 1.5 },
  door: { db: 82, rMin: 1 },
  ignition: { db: 85, rMin: 1 },
  honk: { db: 116, rMin: 2 },
  step: { db: 62, rMin: 0.5 },
  // A man's speech at 1 m (Pearsons, Bennett and Fidell 1977, EPA-600/1-77-025, anechoic): normal effort 58 dB(A), shouted 89.
  talk: { db: 58, rMin: 1 },
  yell: { db: 89, rMin: 1 },
  scream: { db: 100, rMin: 1 },
  groan: { db: 72, rMin: 1 },
  bird: { db: 85, rMin: 1 },
  bark: { db: 96, rMin: 1 },
  // Estimate: no level at 1 m found. A loud call, between a man's shout (89) and a farm dog's bark (96); Korean native cows' calls
  // averaged 71 dB at the recorder, distance unstated (cited in Frontiers in Veterinary Science 2025, doi 10.3389/fvets.2025.1549100).
  moo: { db: 92, rMin: 1 },
  // Pigs' grunts run 60–90 dB at 1 m, a contact grunt in the middle (estimate); squeals: piglets under a needle peaked at 101.9 dB
  // (Engenharia Agrícola 2018), a grown pig's squeal is commonly put at 110–115: a scared pig between.
  grunt: { db: 70, rMin: 1 },
  squeal: { db: 105, rMin: 1 },
  // Estimate: a dog's yelp is shorter and thinner than its bark (96).
  yelp: { db: 90, rMin: 1 },
  // Estimate: a cat's yowl of pain; a plain meow plays `MEOW_QUIET` under it (attention meows reach about 80 dB close up, an
  // ordinary one 45–65). A hiss is a short breathy burst.
  meow: { db: 75, rMin: 0.5 },
  hiss: { db: 65, rMin: 0.5 },
  bell: { db: 118, rMin: 5 },
  // TUNED (estimated, no recording measured): a train's disc brakes squealing in the last metres to a stand.
  brakes: { db: 95, rMin: 3 },
  // A level crossing's bell: at least 90 dB at 1 m (the Wegh eLCSP's data sheet), heard from at least 100 m by law (DPR 495/1992
  // art. 186); a small bell on the post.
  plBell: { db: 92, rMin: 0.3 },
  // A train's horn: TSI's 115–123 dB 5 m ahead (Reg. 1302/2014 after EN 15153-2), 129–137 at 1 m: its lower end in dB(A), from
  // a horn mouth and a cab front about 2 m across. The AI's honk is the same horn.
  trainHorn: { db: 130, rMin: 2 },
  trainHonk: { db: 130, rMin: 2 },
  // A lightning channel, kilometres of it, heard from its strike point (an in-cloud flash's start) and aloft, over no ground: 88 dB(A)
  // at 1 km once the render's own `thunderQuiet` is taken (a close strike's pulse tops 120 dB unweighted there), 66 at 5 km; inside
  // 300 m its crack is no louder, and its direct sound is capped (`MOST_DB`) anyway.
  thunder: { db: 154, rMin: 300, aloft: true },
} as const satisfies Record<
  Exclude<
    Continuous["kind"] | OneShot["kind"],
    "engine" | "water" | "wind" | "crickets" | "rain" | "roof" | "rails"
  >,
  Level
>

/**
 * A train's wheels on its rails, a line source along its length: dB(A) per metre at the rolling voice's nominal, its top speed
 * (`RAILS_TOP`, 130 km/h), 30 dB softer per decade of speed (`railsQuiet`). From TSI Noise's pass-by limit for a diesel unit, 81
 * dB(A) at 7.5 m at 80 km/h with its engines: the wheels 3 dB under it, a 55.6 m train's 78 there, 93.6 dB per metre at 80 km/h
 * (estimated: the limit, not a measurement of the ATR 220).
 */
export const ROLLING = { lw: 99.9, rMin: 1 } as const

/**
 * At most this many dB over gain 1 a one-shot's direct sound plays (its echoes, at least `ECHO_MIN_DB` under it, keep the way's
 * own level). TUNED: a crash at 8, where the master limiter takes a few dB of a 15 m/s crash's peak; nearer (the listener's own
 * crash comes about 25 dB over), it took 20 dB off the hit and, released 0.25 s later, gave the crunch's sub-hits back nearly as
 * loud as the hit: an echo. An explosion at 10: centred, it (crest 6–7 dB, a crash's 13) meters 4–5.5 dB over a 40 m/s wreck at
 * 8 while the limiter takes 2.5 dB of it (5.3 of the wreck); at 12 it took 4.3 dB, held into the roar for up to 0.8 s. Thunder at
 * 2: its loud part lasts seconds, so its crack (a render's 0.5 peak) stays under the limiter's −6 dBFS going in (×0.8 master):
 * −9 dBFS centred, −6.0 at the widest pan (±0.85); its rumble 10 dB and more under that. A train's honk at 2, as thunder: 130 dB
 * at 1 m, it would play 15 dB over gain 1 from 20 m and slam the limiter, and its loud part lasts 1.2–2 s (the alarm again every 2
 * s while a train is held). At 8 the limiter took 3.1 dB of a long blast and 4.4 of the alarm at the widest pan, 2.1 and 3.3
 * centred, for 1.3–1.6 s; at 2, at most 0.3 and 0.8 dB.
 */
export const MOST_DB = {
  crash: 8,
  explosion: 10,
  thunder: 2,
  trainHonk: 2,
} as const satisfies Partial<Record<OneShot["kind"], number>>

/**
 * The tawny owl's hoot, a bird's call of its own: estimated (no measurement found) 5 dB over a songbird's, low (800 Hz) and carrying,
 * so on a still night (the floor at `NIGHT_DB`) one is heard about a kilometre across open ground, as listeners report.
 */
export const OWL: Level = { db: 90, rMin: 1 }

/** Water's level comes from places (the line source at the listener); its size is the 1 m that level is clamped at. */
export const WATER_R_MIN = 1

/**
 * The beds, dB(A) at the listener at full strength / density, and the rain in a 60 mm/h downpour (estimated from noise charts: gentle
 * rain under 40, heavy 60–70). The voices scale themselves below that; a gale's wind bed plays over its full strength, up to
 * `GALE_DB`.
 */
export const BEDS = { wind: 60, crickets: 42, rain: 64 } as const

/**
 * The loudest the wind bed plays, dB(A): a gale on a crest, the loudest a bed's 0.5 peak plays under the master limiter (gain 1.25).
 * Past the voice's full strength (`BEDS.wind`) only the bed's gain rises, so the usual wind keeps the voice it was tuned with.
 */
export const GALE_DB = 65

/** The wind (body and leaves) at `strength` follows strength², so its level falls 40 dB per decade of strength; past 1, the bed's gain carries it to `GALE_DB`. */
export const windDb = (strength: number): number =>
  BEDS.wind + 40 * Math.log10(Math.max(0.05, strength))

/** Rain at the listener, dB(A), at `rate` mm/h: the downpour's `BEDS.rain`, `rainQuiet` under (43 at 1 mm/h, 50 at 4, 55 at 10, 62 at 40). */
export const rainDb = (rate: number): number => BEDS.rain - rainQuiet(rate)

/**
 * Rain drumming on the roof of the car the listener sits in, dB(A) at the ears in a 60 mm/h downpour: heard with no cabin, as the
 * own engine (the roof radiates inside). Estimated (no in-car measurement found): damped steel about 10 dB under a bare metal roof's
 * 74 under ISO heavy rain, so 64 at 40 mm/h; the cabin idles at 46–48, so a shower is faint over it and a downpour drowns it.
 */
const ROOF_DB = 66

/** The roof's drumming at the ears, dB(A), at `rate` mm/h: as the rain's law (45 at 1 mm/h, 52 at 4, 57 at 10, 64 at 40). */
export const roofDb = (rate: number): number => ROOF_DB - rainQuiet(rate)

/** Source heights above their ground, m: a vehicle's body, a person (feet to mouth), and water lifted out of its carved bed. */
export const HEIGHT = { vehicle: 0.8, person: 1, water: 2 } as const

/** Each species' mouth above the ground, m (standing). */
export const MOUTH = { dog: 0.5, cat: 0.25, cow: 1.3, pig: 0.5 } as const satisfies Record<
  Species,
  number
>

/**
 * How many dB a woman's or a child's voice is under a man's (`talk` and `yell` are a man's): Pearsons et al. 1977 measured women
 * and children 3 dB under men at normal effort (55 against 58 dB(A) at 1 m) and 7 dB under them shouting (82 against 89).
 */
export const SOFTER = { talk: 3, yell: 7 } as const

/** The level of a line said (`talk`) or yelled (`yell`) by `speaker`. */
export const speechLevel = (kind: "talk" | "yell", speaker: Speaker): Level =>
  speaker.female || speaker.age === "kid"
    ? { ...LEVELS[kind], db: LEVELS[kind].db - SOFTER[kind] }
    : LEVELS[kind]

/** At most this many voices of each kind play; the loudest at the listener win. */
export const CAPS = {
  engine: 8,
  tyres: 4,
  scrape: 2,
  horn: 3,
  siren: 2,
  beeper: 2,
  fire: 2,
  water: 4,
  wind: 1,
  crickets: 1,
  rain: 1,
  roof: 1,
  rails: 2,
  brakes: 2,
  plBell: 2,
  trainHorn: 1,
} as const satisfies Record<Continuous["kind"], number>

/** A voice that played last frame keeps its place under the cap until a newcomer is this many dB louder: near-equals do not swap every frame. */
export const KEEP_DB = 3

/** At most this many bell towers ring the hour, the loudest at the listener: up to a dozen are within earshot of a hillside, far under the nearest. */
export const TOWERS = 4

/** One-shots nearer than this (m) play at once: a lag under ~120 ms goes unnoticed (physics.md §6). */
export const DELAY_FROM = 40

/**
 * The reverb send, on a mixer whose full send returns 12 dB under dry. None in the open, where nothing
 * scatters sound back (an open field's late energy is 15 dB and more under the direct sound), nor in
 * the woods (a known limit: docs/audio.md). In a street, street² of `db` dB at `ref` m (the tail
 * leaks out of every gap in the facades), 3 dB wetter per doubling of distance from `near` to `far` m:
 * along a street the reverberant field falls like a line source's, the direct sound like a point's
 * (Thomas et al. 2013). `cabin`× inside a vehicle, whose own noise masks the tail; `snow` of it gone under a full snow cover,
 * the street floor no longer reflecting (fresh snow's NRC is near 0.9).
 */
export const REVERB = { db: 8, ref: 10, near: 2.5, far: 40, cabin: 0.25, snow: 0.5 } as const

/** An echo plays at least this many dB under the direct sound: a rock face's own reflection loss (places.ts). */
export const ECHO_MIN_DB = 10

/** One-shots loud and sharp enough to answer off rock faces (physics.md §7): a crash from 6 m/s, explosions, honks and trains' horns, bells, yells, screams, the loud animal calls and thunder. */
const ECHOING = new Set<OneShot["kind"]>([
  "explosion",
  "honk",
  "trainHonk",
  "bell",
  "yell",
  "scream",
  "bark",
  "moo",
  "squeal",
  "thunder",
])

/** Whether `sound` answers off rock faces. */
export const echoes = (sound: OneShot): boolean =>
  sound.kind === "crash" ? sound.speed >= 6 : ECHOING.has(sound.kind)
