/**
 * The crash tests' cases: the design's matrix of crashes, each with the sim's masses behind it, and
 * the seeded random source they render from. Shared by `crash.test.ts` and `crash.long-test.ts`.
 *
 * @module audio/synth/crash/__tests__/cases
 */
import assert from "node:assert/strict"

import { VEHICLE_MODELS, VEHICLES, type VehicleModel } from "../../../../sim/vehicles.ts"
import type { Material, Surface, Zone } from "../../../types.ts"
import type { Crash } from "../hit.ts"

/** The rate every render is made at, Hz. */
export const RATE = 48000
/** Twenty draws of each crash: every bound below holds on other seeds too (checked on seeds 1–80, twenty at a time), with margin. */
export const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)

/** The median of `values`. */
export const median = (values: ReadonlyArray<number>): number =>
  [...values].sort((a, b) => a - b)[values.length >> 1]!
/** Asserts `value` lies in `lo`…`hi`, naming `what`. */
export const within = (value: number, lo: number, hi: number, what: string) =>
  assert.ok(value >= lo && value <= hi, `${what}: ${value.toFixed(3)} not in ${lo}…${hi}`)

/** A small deterministic random source (mulberry32), so the checks never flake. */
export const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** A crash as the matrix gives it: its speed, the car and the zone hit, and what it hits on what ground. */
export interface Spec {
  readonly speed: number
  readonly model?: VehicleModel
  readonly zone?: Zone
  /** A wall's material, or the model of the car hit (on its rear). */
  readonly against?: Material | VehicleModel
  readonly surface?: Surface
}
const isModel = (name: string): name is VehicleModel =>
  (VEHICLE_MODELS as ReadonlyArray<string>).includes(name)
/** `model`'s mass as the sim reports it, t. */
const tonnes = (model: VehicleModel) => VEHICLES[model].mass / 1000
/** The crash `spec` describes, with the sim's mass behind it: the car's against a wall, the reduced mass of two cars. */
export const crash = ({
  speed,
  model = "panda",
  zone = "front",
  against = "masonry",
  surface = "asphalt",
}: Spec): Crash => ({
  kind: "crash",
  speed,
  body: { model, zone },
  surface,
  mass: isModel(against) ? 1 / (1 / tonnes(model) + 1 / tonnes(against)) : tonnes(model),
  against: isModel(against)
    ? { kind: "car", body: { model: against, zone: "rear" } }
    : { kind: "wall", material: against },
})

/** The design's matrix: a Panda into a house wall from a bump to a hard hit, car–car pairs, each other target, a side hit, a wreck, the road. */
export const CASES = {
  bump: { speed: 2 },
  masonry5: { speed: 5 },
  masonry14: { speed: 14 },
  masonry20: { speed: 20 },
  pandas: { speed: 10, against: "panda" },
  truck: { speed: 12, against: "truck" },
  stone: { speed: 8, model: "ape", against: "stone" },
  rail: { speed: 12, model: "carabinieri", against: "rail" },
  tree: { speed: 10, against: "tree" },
  earth: { speed: 8, against: "earth", surface: "grass" },
  side: { speed: 12, zone: "side" },
  wreck: { speed: 40, model: "carabinieri" },
  sheet: { speed: 12, against: "sheet" },
  masonry12: { speed: 12 },
  // A house wall at the speeds of the car–car and the road cases below.
  masonry10: { speed: 10 },
  masonry6: { speed: 6 },
  // Bottoming out on the road after a jump, rolling onto it, a side into a house wall as hard; the laden truck: a nudge and a hard hit.
  landing: { speed: 6, zone: "under", against: "road" },
  roll: { speed: 8, zone: "side", against: "road" },
  side8: { speed: 8, zone: "side" },
  truckNudge: { speed: 2, model: "truck" },
  truck12: { speed: 12, model: "truck" },
} as const satisfies Record<string, Spec>
export type Case = keyof typeof CASES
