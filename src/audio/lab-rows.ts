/**
 * The audition page's "Render all" (lab.ts): every voice and shot at a few representative params
 * (the crashes over a matrix of bodies, targets and speeds, the scrape along every material, each
 * engine at its redline under full load, where its trim is calibrated, and worn by damage, one
 * misfiring, a train rolling over its joints, speech in every register, each animal's calls),
 * rendered offline and measured one at a time (lab-render.ts). Also the flat forms the page's
 * controls edit for the crash and for speech, and a train rolling on for the rolling voice.
 *
 * @module audio/lab-rows
 */
import { TRAIN_MODELS } from "../sim/rail/models.ts"
import type { Age } from "../sim/schema.ts"
import { VEHICLE_MODELS, VEHICLES, type VehicleModel } from "../sim/vehicles.ts"
import { EAR_HEIGHT } from "./acoustics.ts"
import { makeKit } from "./buffers.ts"
import { paramsOf, RATE, renderShot, renderVoice, type Row, type Sound } from "./lab-render.ts"
import { lineFor } from "./speech/index.ts"
import type { Situation } from "./speech/types.ts"
import { engineSpec } from "./synth/engine.ts"
import { VALLEY_GUSTS } from "./synth/nature.ts"
import { axleOffsets, JOINT, RAILS_TOP } from "./synth/rail.ts"
import type { Continuous, EngineModel, Material, OneShot, Surface, Zone } from "./types.ts"

type Crash = Extract<OneShot, { readonly kind: "crash" }>
/** A line said or yelled. */
export type Speaking = Extract<OneShot, { readonly kind: "talk" | "yell" }>

/** Every wall and ground material. */
// Every key of a `satisfies Record<Material, 0>` is a Material.
export const MATERIALS = Object.keys({
  masonry: 0,
  stone: 0,
  sheet: 0,
  glass: 0,
  rail: 0,
  rock: 0,
  earth: 0,
  tree: 0,
  road: 0,
} satisfies Record<Material, 0>) as ReadonlyArray<Material>

/** `model`'s mass, t, as the sim reports it; the reduced mass of two models. */
const tonnes = (model: VehicleModel): number => VEHICLES[model].mass / 1000
const paired = (a: VehicleModel, b: VehicleModel): number => 1 / (1 / tonnes(a) + 1 / tonnes(b))

/** The crash's params flat, one control each: `against` is a wall's material or the model of the car hit, on its `struck` zone. */
export interface CrashForm {
  readonly kind: "crash"
  readonly speed: number
  readonly mass: number
  readonly model: VehicleModel
  readonly zone: Zone
  readonly against: Material | VehicleModel
  readonly struck: Zone
  readonly surface: Surface
}
/** A Panda's nose into a rendered house wall, on asphalt. */
export const CRASH: CrashForm = {
  kind: "crash",
  speed: 8,
  mass: tonnes("panda"),
  model: "panda",
  zone: "front",
  against: "masonry",
  struck: "front",
  surface: "asphalt",
}
const isModel = (name: string): name is VehicleModel =>
  (VEHICLE_MODELS as ReadonlyArray<string>).includes(name)
/** The crash `form` describes. */
export const crashOf = ({ model, zone, against, struck, ...rest }: CrashForm): Crash => ({
  ...rest,
  body: { model, zone },
  against: isModel(against)
    ? { kind: "car", body: { model: against, zone: struck } }
    : { kind: "wall", material: against },
})

/** Speech's params flat: a fresh line for `situation` in the voice of `voice`, `age` and `female`, said (`talk`) or yelled (`yell`). */
export interface SpeechForm<K extends Speaking["kind"] = Speaking["kind"]> {
  readonly kind: K
  readonly situation: Situation
  readonly voice: number
  readonly age: Age
  readonly female: boolean
}
/** The speech `form` describes, with a line drawn for its situation. */
export const speechOf = <K extends Speaking["kind"]>({
  kind,
  situation,
  ...speaker
}: SpeechForm<K>): Extract<Speaking, { readonly kind: K }> =>
  ({ kind, speaker, line: lineFor(situation, Math.random) }) as Extract<
    Speaking,
    { readonly kind: K }
  >

/** Some sounds of every kind of `S`: a new kind fails to compile until "render all" plays it. */
type Each<S extends Sound> = {
  readonly [K in S["kind"]]: ReadonlyArray<Extract<S, { readonly kind: K }>>
}

type Engine = Extract<Continuous, { readonly kind: "engine" }>
type Rails = Extract<Continuous, { readonly kind: "rails" }>
/** `model`'s engine as new, outside, the nominal variant, at its redline under full load unless `more` says otherwise. */
const engineAt = (model: EngineModel, more: Partial<Engine> = {}): Engine => ({
  kind: "engine",
  model,
  rpm: engineSpec(model).redline,
  load: 1,
  inside: false,
  variant: 0.5,
  damage: 0,
  misfire: false,
  ...more,
})
/** A worn Panda misfiring in every other 0.25 s window (the sim's), as the director would hold it frame by frame. */
const SPUTTERING = engineAt("panda", { rpm: 3000, load: 0.5, damage: 0.9 })
const sputtering = (t: number): Engine => ({
  ...SPUTTERING,
  misfire: Math.floor(t / 0.25) % 2 === 1,
})

/**
 * An ATR 220 rolling at `v` m/s with its active cab's nose at s 0 at time 0, `t` s on: its axles there, and the rail joints
 * around them (`JOINT` apart), as the director holds the rolling voice frame by frame.
 */
export const railsAt = (v: number, t: number): Rails => {
  const axles = axleOffsets(TRAIN_MODELS[0]).map((at) => v * t - Math.sign(v || 1) * at)
  const lo = Math.floor((Math.min(...axles) - 10) / JOINT),
    hi = Math.ceil((Math.max(...axles) + 10) / JOINT)
  return {
    kind: "rails",
    v,
    axles,
    joints: Array.from({ length: hi - lo + 1 }, (_, k) => (lo + k) * JOINT),
  }
}
/** The rolling voice's renders: at its top speed, where it peaks near 0.5, at the line's 80 km/h, and crawling at 20 km/h. */
const RAILS_SPEEDS = [RAILS_TOP, 80 / 3.6, 20 / 3.6] as const

/** "Render all": representative params per voice (rendered 2 s) and per shot. */
const VOICE_RENDERS = {
  // Each model at the redline under full load (its trim's calibration: flagged off nominal outside 0.42–0.6), idling, and worn at the redline
  // (flagged over nominal past 0.6, as every engine row is); the Giulia from its seat; a Panda and the truck idling worn; the truck's
  // loudest knock.
  engine: [
    ...VEHICLE_MODELS.flatMap((model) => [
      engineAt(model),
      engineAt(model, { rpm: VEHICLES[model].engine.idle, load: 0 }),
      engineAt(model, { damage: 0.9 }),
    ]),
    engineAt("carabinieri", { rpm: 3500, load: 0.5, inside: true }),
    engineAt("panda", { rpm: VEHICLES.panda.engine.idle, load: 0, damage: 0.5 }),
    engineAt("truck", { rpm: VEHICLES.truck.engine.idle, load: 0, damage: 0.8 }),
    // The loudest knock: the truck's, at the redline off the throttle, at full damage short of destroyed.
    engineAt("truck", { load: 0, damage: 0.99 }),
    // A train's power pack at its rated revs under full power, and idling (trains take no damage).
    ...TRAIN_MODELS.flatMap((model) => [
      engineAt(model),
      engineAt(model, { rpm: engineSpec(model).idle, load: 0 }),
    ]),
  ],
  tyres: [
    // The loudest intended case, a full slide at the Giulia's top speed: peaks near 0.5.
    { kind: "tyres", speed: 40, skid: 1, slip: 12, surface: "asphalt", heavy: false },
    { kind: "tyres", speed: 14, skid: 0, slip: 0, surface: "asphalt", heavy: false },
    { kind: "tyres", speed: 20, skid: 0.6, slip: 6, surface: "asphalt", heavy: false },
    { kind: "tyres", speed: 10, skid: 0, slip: 0, surface: "stone", heavy: false },
    { kind: "tyres", speed: 15, skid: 0.5, slip: 3, surface: "gravel", heavy: true },
    // A standing burnout, a locked wheel, ABS braking at the limit.
    { kind: "tyres", speed: 0, skid: 1, slip: 8, surface: "asphalt", heavy: false },
    { kind: "tyres", speed: 15, skid: 1, slip: 15, surface: "asphalt", heavy: false },
    { kind: "tyres", speed: 20, skid: 0.25, slip: 3, surface: "asphalt", heavy: false },
  ],
  // Full grinding from 12 m/s, where every material peaks near 0.5; masonry slower, and the guard rail's squeal at 2.5 m/s.
  scrape: [
    ...MATERIALS.map((material) => ({ kind: "scrape", speed: 12, material }) as const),
    { kind: "scrape", speed: 4, material: "masonry" },
    { kind: "scrape", speed: 2.5, material: "rail" },
  ],
  horn: VEHICLE_MODELS.map((model) => ({ kind: "horn", model }) as const),
  siren: [{ kind: "siren" }],
  beeper: [{ kind: "beeper" }],
  fire: [{ kind: "fire" }],
  water: [
    { kind: "water", body: "fountain", flow: 0.5 },
    { kind: "water", body: "stream", flow: 0.6 },
    { kind: "water", body: "river", flow: 1 },
  ],
  // The valley's usual gusts, and squalls on a ridge.
  wind: [
    { kind: "wind", strength: 0.3, forest: 0, gusts: VALLEY_GUSTS },
    { kind: "wind", strength: 1, forest: 1, gusts: VALLEY_GUSTS },
    { kind: "wind", strength: 1, forest: 0.3, gusts: 1 },
  ],
  // A mild evening; the cold, where a held voice still chirps at its slowest.
  crickets: [
    { kind: "crickets", density: 0.3, celsius: 15 },
    { kind: "crickets", density: 1, celsius: 22 },
    { kind: "crickets", density: 1, celsius: 5 },
  ],
  // A shower on open ground, rain in the woods, a steady rain on a river (its plinks at their loudest), a downpour on a village by the
  // river; a downpour on open ground peaks near 0.5.
  rain: (
    [
      [1, 0, 0, 0],
      [10, 1, 0, 0],
      [6, 0, 0, 1],
      [60, 0, 1, 1],
      [60, 0, 0, 0],
    ] as const
  ).map(([rate, forest, built, water]) => ({ kind: "rain", rate, forest, built, water }) as const),
  roof: [
    { kind: "roof", rate: 1 },
    { kind: "roof", rate: 10 },
    { kind: "roof", rate: 60 },
  ],
  // Rendered rolling on (`railsAt`, in `renderRows`), so their axles clack over the joints.
  rails: RAILS_SPEEDS.map((v) => railsAt(v, 0)),
  // The loudest squeal, braking hard at 2 m/s, and a gentler stop.
  brakes: [
    { kind: "brakes", speed: 2, brake: 0.6 },
    { kind: "brakes", speed: 4, brake: 0.3 },
  ],
  plBell: [{ kind: "plBell", variant: 0.5 }],
  trainHorn: [{ kind: "trainHorn" }],
} satisfies Each<Continuous>
const SHOT_RENDERS = {
  // A Panda into a house wall (a bump to a heavy hit), car–car pairs, each other target, a side hit, a wreck, the laden truck nudging
  // and hitting a house, a hard landing on the road and a roll onto it: each at the sim's mass (the car's, the reduced mass of two).
  crash: (
    [
      { speed: 2 },
      { speed: 5 },
      { speed: 14 },
      { speed: 20 },
      { speed: 10, against: "panda" },
      { speed: 12, against: "truck" },
      { speed: 8, model: "ape", against: "stone" },
      { speed: 12, model: "carabinieri", against: "rail" },
      { speed: 10, against: "tree" },
      { speed: 8, against: "earth" },
      { speed: 12, zone: "side" },
      { speed: 40, model: "carabinieri" },
      { speed: 2, model: "truck" },
      { speed: 12, model: "truck" },
      { speed: 8, zone: "under", against: "road" },
      { speed: 8, zone: "side", against: "road" },
    ] satisfies ReadonlyArray<Partial<CrashForm>>
  ).map((row) => {
    const form = { ...CRASH, ...row }
    return crashOf({
      ...form,
      mass: isModel(form.against) ? paired(form.model, form.against) : tonnes(form.model),
    })
  }),
  // Its debris on the road, on setts (bouncier) and on grass (muffled); each run draws a new blast.
  explosion: (["asphalt", "stone", "grass"] as const).map(
    (surface) => ({ kind: "explosion", surface }) as const,
  ),
  thud: [
    { kind: "thud", speed: 5 },
    { kind: "thud", speed: 12 },
  ],
  clunk: [
    { kind: "clunk", speed: 5, heavy: false },
    { kind: "clunk", speed: 2, heavy: true },
  ],
  door: [
    { kind: "door", model: "panda", open: true },
    { kind: "door", model: "panda", open: false },
    { kind: "door", model: "truck", open: false },
  ],
  ignition: VEHICLE_MODELS.map((model) => ({ kind: "ignition", model }) as const),
  honk: [
    { kind: "honk", model: "panda" },
    { kind: "honk", model: "truck" },
  ],
  trainHonk: [
    { kind: "trainHonk", urgent: false },
    { kind: "trainHonk", urgent: true },
  ],
  step: (
    [
      ["stone", true, false],
      ["asphalt", false, false],
      ["gravel", true, false],
      ["grass", false, false],
      ["grass", false, true],
    ] as const
  ).map(([surface, run, snow]) => ({ kind: "step", surface, run, snow }) as const),
  // Each register: a man, a woman, an elder and a child, chatting quietly and crying out; a line drawn per page load.
  talk: (
    [
      { situation: "chat", voice: 0.3, age: "adult", female: false },
      { situation: "reply", voice: 0.7, age: "adult", female: true },
      { situation: "greet", voice: 0.5, age: "elder", female: false },
      { situation: "laugh", voice: 0.5, age: "kid", female: true },
    ] as const
  ).map((form) => speechOf({ kind: "talk", ...form })),
  yell: (
    [
      { situation: "fright", voice: 0.3, age: "adult", female: false },
      { situation: "anger", voice: 0.7, age: "adult", female: true },
      { situation: "shock", voice: 0.5, age: "elder", female: true },
      { situation: "surprise", voice: 0.5, age: "kid", female: false },
    ] as const
  ).map((form) => speechOf({ kind: "yell", ...form })),
  scream: [
    { kind: "scream", voice: 0.2 },
    { kind: "scream", voice: 0.8 },
  ],
  groan: [
    { kind: "groan", voice: 0.2 },
    { kind: "groan", voice: 0.8 },
  ],
  bell: [
    { kind: "bell", pitch: 400 },
    { kind: "bell", pitch: 800 },
  ],
  bird: (["robin", "tit", "blackbird", "chaffinch", "owl"] as const).map(
    (species) => ({ kind: "bird", species }) as const,
  ),
  bark: [
    { kind: "bark", big: true },
    { kind: "bark", big: false },
  ],
  moo: [
    { kind: "moo", size: 0.85 },
    { kind: "moo", size: 1.15 },
  ],
  grunt: [{ kind: "grunt", size: 1 }],
  squeal: [{ kind: "squeal", size: 1 }],
  yelp: [{ kind: "yelp", size: 1 }],
  meow: [
    { kind: "meow", size: 1, yowl: false },
    { kind: "meow", size: 1, yowl: true },
  ],
  hiss: [{ kind: "hiss", size: 1 }],
  // A bolt's crack and boom 300 m away, one rumbling from 2 and 8 km, an in-cloud flash overhead.
  thunder: (
    [
      [300, true],
      [2000, true],
      [8000, true],
      [0, false],
    ] as const
  ).map(
    ([distance, bolt], i) =>
      ({ kind: "thunder", distance, ears: EAR_HEIGHT, bolt, seed: i + 1 }) as const,
  ),
} satisfies Each<OneShot>

/** Renders every voice (a train rolling on), the sputtering engine and every shot offline, one at a time (a dozen 22 s stereo renders at once would hold hundreds of MB). */
export const renderRows = async (): Promise<ReadonlyArray<Row>> => {
  const kit = makeKit(new OfflineAudioContext({ length: 1, sampleRate: RATE }))
  const rows: Array<Row> = []
  for (const sound of Object.values(VOICE_RENDERS).flat())
    rows.push(
      await renderVoice(
        kit,
        sound,
        sound.kind === "rails" ? (t) => railsAt(sound.v, t) : undefined,
        sound.kind === "rails" ? `v=${sound.v.toFixed(1)} rolling on` : undefined,
      ),
    )
  rows.push(
    await renderVoice(
      kit,
      SPUTTERING,
      sputtering,
      paramsOf(SPUTTERING).replace("misfire=false", "misfire=every other 0.25 s"),
    ),
  )
  for (const sound of Object.values(SHOT_RENDERS).flat()) rows.push(await renderShot(kit, sound))
  return rows
}
