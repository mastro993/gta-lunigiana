/**
 * The audition page's controls (lab.ts): the menus and slider ranges of the params, and each kind's
 * params as first shown, a held voice's and a one-shot's. The crash and speech panels edit flat
 * forms (lab-rows.ts), and the rolling voice's only its speed: the train rolls on along a track of
 * joints as the page plays it.
 *
 * @module audio/lab-forms
 */
import { TRAIN_MODELS } from "../sim/rail/models.ts"
import { AGES } from "../sim/schema.ts"
import { VEHICLE_MODELS } from "../sim/vehicles.ts"
import { EAR_HEIGHT } from "./acoustics.ts"
import {
  CRASH,
  type CrashForm,
  crashOf,
  MATERIALS,
  railsAt,
  type Speaking,
  type SpeechForm,
  speechOf,
} from "./lab-rows.ts"
import type { Situation } from "./speech/types.ts"
import { VALLEY_GUSTS } from "./synth/nature.ts"
import type { Continuous, OneShot, Surface, Zone } from "./types.ts"

type Crash = Extract<OneShot, { readonly kind: "crash" }>
type WaterBody = Extract<Continuous, { readonly kind: "water" }>["body"]

/** Every surface. */
const SURFACES = Object.keys({
  asphalt: 0,
  stone: 0,
  gravel: 0,
  dirt: 0,
  grass: 0,
  leaves: 0,
} satisfies Record<Surface, 0>)
/** Every zone of a body. */
const ZONES = Object.keys({ front: 0, side: 0, rear: 0, under: 0 } satisfies Record<Zone, 0>)
/** Menus for the string params, or for `kind.param` where kinds differ. */
export const OPTIONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  model: VEHICLE_MODELS,
  "engine.model": [...VEHICLE_MODELS, ...TRAIN_MODELS],
  surface: SURFACES,
  material: MATERIALS,
  zone: ZONES,
  struck: ZONES,
  against: [...MATERIALS, ...VEHICLE_MODELS],
  body: Object.keys({ fountain: 0, stream: 0, river: 0 } satisfies Record<WaterBody, 0>),
  situation: Object.keys({
    greet: 0,
    chat: 0,
    reply: 0,
    laugh: 0,
    farewell: 0,
    fright: 0,
    shock: 0,
    pity: 0,
    anger: 0,
    surprise: 0,
    helpMan: 0,
    helpWoman: 0,
    helpKid: 0,
    grieve: 0,
    mum: 0,
    dad: 0,
    nonna: 0,
    nonno: 0,
    thief: 0,
  } satisfies Record<Situation, 0>),
  age: AGES,
  species: Object.keys({ robin: 0, tit: 0, blackbird: 0, chaffinch: 0, owl: 0 } satisfies Record<
    Extract<OneShot, { readonly kind: "bird" }>["species"],
    0
  >),
}
/** Slider [min, max, step] per numeric param, or per `kind.param` where kinds differ. */
export const RANGES: Readonly<Record<string, readonly [number, number, number] | undefined>> = {
  "tyres.speed": [0, 45, 0.5],
  "scrape.speed": [0, 20, 0.5],
  "crash.speed": [0, 60, 0.5],
  "thud.speed": [0, 20, 0.5],
  "clunk.speed": [0, 6, 0.1],
  rpm: [0, 7000, 10],
  slip: [0, 20, 0.1],
  mass: [0.1, 30, 0.05],
  pitch: [350, 900, 1],
  size: [0.85, 1.15, 0.01],
  rate: [0, 60, 0.5],
  celsius: [-5, 30, 0.5],
  "thunder.distance": [30, 15000, 10],
  "thunder.ears": [-400, 1000, 0.1],
  "thunder.seed": [1, 1000, 1],
  "rails.v": [-40, 40, 0.5],
  "brakes.speed": [0, 8, 0.1],
}
/** A param's slider when nothing else is given: 0…1. */
export const UNIT_RANGE = [0, 1, 0.01] as const

/** The rolling voice's controls: its speed; the train rolls on along a track of joints (`railsAt`). */
interface RailsForm {
  readonly kind: "rails"
  readonly v: number
}
/** A held panel's controls: its voice's params, the rolling voice's flattened. */
export type HeldForm = Exclude<Continuous, { readonly kind: "rails" }> | RailsForm
/** The voice `form` describes at page time `t` s. */
export const voiceOf = (form: HeldForm, t: number): Continuous =>
  form.kind === "rails" ? railsAt(form.v, t) : form

/** Each kind's params as first shown; the controls are made from these (numbers: sliders, strings: menus, flags: checkboxes). */
export const HELD = {
  engine: {
    kind: "engine",
    model: "panda",
    rpm: 3000,
    load: 0.5,
    inside: false,
    variant: 0.5,
    damage: 0,
    misfire: false,
  },
  tyres: { kind: "tyres", speed: 12, skid: 0, slip: 0, surface: "asphalt", heavy: false },
  scrape: { kind: "scrape", speed: 8, material: "masonry" },
  horn: { kind: "horn", model: "panda" },
  siren: { kind: "siren" },
  beeper: { kind: "beeper" },
  fire: { kind: "fire" },
  water: { kind: "water", body: "stream", flow: 0.6 },
  wind: { kind: "wind", strength: 0.6, forest: 0.3, gusts: VALLEY_GUSTS },
  crickets: { kind: "crickets", density: 0.7, celsius: 15 },
  rain: { kind: "rain", rate: 4, forest: 0.3, built: 0.2, water: 0 },
  roof: { kind: "roof", rate: 4 },
  rails: { kind: "rails", v: 22 },
  brakes: { kind: "brakes", speed: 2, brake: 0.6 },
  plBell: { kind: "plBell", variant: 0.5 },
  trainHorn: { kind: "trainHorn" },
} as const satisfies {
  readonly [K in Continuous["kind"]]: Extract<HeldForm, { readonly kind: K }>
}

/** A one-shot panel's controls: its sound's params, the crash's and speech's flattened. */
export type Form =
  | Exclude<OneShot, Crash | Speaking>
  | CrashForm
  | SpeechForm<"talk">
  | SpeechForm<"yell">
/** The one-shot `form` describes. */
export const soundOf = (form: Form): OneShot =>
  form.kind === "crash"
    ? crashOf(form)
    : form.kind === "talk" || form.kind === "yell"
      ? speechOf(form)
      : form

/** Each one-shot kind's params as first shown. */
export const PLAYED = {
  crash: CRASH,
  explosion: { kind: "explosion", surface: "asphalt" },
  thud: { kind: "thud", speed: 8 },
  clunk: { kind: "clunk", speed: 3, heavy: false },
  door: { kind: "door", model: "panda", open: false },
  ignition: { kind: "ignition", model: "panda" },
  honk: { kind: "honk", model: "panda" },
  trainHonk: { kind: "trainHonk", urgent: false },
  step: { kind: "step", surface: "stone", run: false, snow: false },
  talk: { kind: "talk", situation: "chat", voice: 0.5, age: "adult", female: false },
  yell: { kind: "yell", situation: "fright", voice: 0.5, age: "adult", female: true },
  scream: { kind: "scream", voice: 0.3 },
  groan: { kind: "groan", voice: 0.3 },
  bell: { kind: "bell", pitch: 600 },
  bird: { kind: "bird", species: "robin" },
  bark: { kind: "bark", big: true },
  moo: { kind: "moo", size: 1 },
  grunt: { kind: "grunt", size: 1 },
  squeal: { kind: "squeal", size: 1 },
  yelp: { kind: "yelp", size: 1 },
  meow: { kind: "meow", size: 1, yowl: false },
  hiss: { kind: "hiss", size: 1 },
  thunder: { kind: "thunder", distance: 1500, ears: EAR_HEIGHT, bolt: true, seed: 1 },
} as const satisfies { readonly [K in OneShot["kind"]]: Extract<Form, { readonly kind: K }> }
