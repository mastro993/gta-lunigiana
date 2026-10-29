/**
 * Every vehicle and train sound kind and its synth: the speaker's `Voices` and `Shots` tables spread
 * these in beside the world's, so a vehicle kind without a synth fails to compile.
 *
 * @module audio/synth/vehicles
 */
import type { Shots, Voices } from "../types.ts"
import { crash } from "./crash/index.ts"
import { engine } from "./engine.ts"
import { explosion } from "./explosion.ts"
import { fire } from "./fire.ts"
import { beeper, honk, horn, siren, trainHonk, trainHorn } from "./horns.ts"
import { clunk, door, ignition, thud } from "./impacts.ts"
import { brakes, rails } from "./rail.ts"
import { scrape } from "./scrape.ts"
import { tyres } from "./tyres.ts"

/** Continuous vehicle and train sounds. */
export const VEHICLE_VOICES = {
  engine,
  tyres,
  scrape,
  horn,
  siren,
  beeper,
  fire,
  rails,
  brakes,
  trainHorn,
} satisfies Pick<
  Voices,
  | "engine"
  | "tyres"
  | "scrape"
  | "horn"
  | "siren"
  | "beeper"
  | "fire"
  | "rails"
  | "brakes"
  | "trainHorn"
>

/** One-shot vehicle and train sounds. */
export const VEHICLE_SHOTS = {
  crash,
  explosion,
  thud,
  clunk,
  door,
  ignition,
  honk,
  trainHonk,
} satisfies Pick<
  Shots,
  "crash" | "explosion" | "thud" | "clunk" | "door" | "ignition" | "honk" | "trainHonk"
>
