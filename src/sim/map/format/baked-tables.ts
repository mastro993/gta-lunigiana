/**
 * The baked tables the global file carries field by field (docs/map.md, "The global file"): the
 * parked spots, the farms and the lamps. Here each field has its place in the sections
 * (`PARKED_FIELDS`, `FARM_FLAGS`, `LAMP_WORDS`, `LAMP_KINDS`), a double that is no whole number of
 * a unit (a rest, a farm's centre, a lamp's numbers) travels as its two int32 words (`toWords`,
 * `fromWords`), and the tables are built back from their sections as `JSON.parse` built them.
 * `GLOBAL_LAYOUT` in `./global-file.ts` lays their sections out among the global file's others.
 *
 * @module map/format/baked-tables
 */
import type { VehicleModel } from "../../vehicles.ts"
import type { FarmEntry, Lamp, ParkedSpot, Rest } from "../index.ts"

/** A parked spot's flag where a truck fits: past the models' bits, under the 128 a zigzag-coded byte holds. */
export const TRUCK = 1 << 6

/** Each parked spot's field's section: a field added to `ParkedSpot` fails to compile until it has its place in the file, and a spot with a key not here throws. */
export const PARKED_FIELDS = {
  x: "xy",
  y: "xy",
  angle: "angles",
  rest: "rests",
  truck: "flags",
} as const satisfies Record<keyof ParkedSpot, string>

/** A farm's flags: a field added to `FarmEntry` fails to compile until it has its place in the file. */
export const FARM_FLAGS = { rural: 1, pen: 2 } as const satisfies Record<
  Exclude<keyof FarmEntry, "building">,
  number
>

/** Each lamp number's place in the lamps' words: a field added to `Lamp` fails to compile until it has its place in the file. */
export const LAMP_WORDS = { x: 0, y: 1, z: 2, nx: 3, ny: 4 } as const satisfies Record<
  Exclude<keyof Lamp, "kind">,
  number
>

/** The lamps' numbers. */
export const LAMP_FIELDS = Object.keys(LAMP_WORDS) as Array<keyof typeof LAMP_WORDS>

/** A lamp's kind as its index here. */
export const LAMP_KINDS = ["wall", "pole"] as const satisfies ReadonlyArray<Lamp["kind"]>

/** Doubles as int32 words, big-endian: every value's high word, then every value's low word (−0 as 0, as JSON wrote it); a value not finite throws. */
export const toWords = (values: ArrayLike<number>, what: string): Int32Array => {
  const n = values.length,
    out = new Int32Array(2 * n),
    view = new DataView(new ArrayBuffer(8))
  for (let k = 0; k < n; k++) {
    const v = values[k]!
    if (!Number.isFinite(v)) throw new Error(`${what}: ${v} at ${k} is not finite`)
    view.setFloat64(0, v === 0 ? 0 : v)
    out[k] = view.getInt32(0)
    out[n + k] = view.getInt32(4)
  }
  return out
}

/** `toWords`' doubles back, to the bit, as a plain array of their length, as `JSON.parse` gives (a pushed one keeps up to half its length again spare). */
export const fromWords = (words: Int32Array): Array<number> => {
  const n = words.length / 2,
    out: Array<number> = [],
    view = new DataView(new ArrayBuffer(8))
  for (let k = 0; k < n; k++) {
    view.setInt32(0, words[k]!)
    view.setInt32(4, words[n + k]!)
    out.push(view.getFloat64(0))
  }
  return out.slice()
}

/**
 * Every parked spot's rests, spot by spot, each spot's in `models`' order (the order the decoder
 * gives them in); a rest of a model not in `models`, or out of their order, throws.
 */
export const restsOf = (
  parked: ReadonlyArray<ParkedSpot>,
  models: ReadonlyArray<VehicleModel>,
  what: string,
): Array<Rest> =>
  parked.flatMap((spot, k) => {
    let last = -1
    return Object.entries(spot.rest).flatMap(([model, rest]) => {
      const m = models.indexOf(model as VehicleModel)
      if (m <= last)
        throw new Error(
          `${what}: spot ${k}'s rest of ${model} is not in the order of ${models.join(", ")}`,
        )
      last = m
      return rest === undefined ? [] : [rest]
    })
  })

// The tables are built as `JSON.parse` built them: arrays of their length (`Array.from`: a pushed
// one keeps up to half its length again spare), each entry a literal of its keys.

/** The parked spots from their sections, each as the build bakes it: `{ x, y, angle, rest, truck? }`, its rests in the line's order of the models. */
export const parkedOf = (
  xy: Int32Array,
  angles: Int32Array,
  flags: Int32Array,
  words: Array<number>,
  models: ReadonlyArray<VehicleModel>,
): Array<ParkedSpot> => {
  const n = words.length / 3
  let r = 0
  return Array.from({ length: angles.length }, (_, k) => {
    const rest: Partial<Record<VehicleModel, Rest>> = {}
    for (let m = 0; m < models.length; m++)
      if ((flags[k]! & (1 << m)) !== 0) {
        rest[models[m]!] = [words[r]!, words[n + r]!, words[2 * n + r]!]
        r++
      }
    const x = xy[2 * k]! / 10,
      y = xy[2 * k + 1]! / 10,
      angle = angles[k]! / 1000
    return (flags[k]! & TRUCK) === 0 ? { x, y, angle, rest } : { x, y, angle, rest, truck: true }
  })
}

/** The farms from their sections: `{ building, rural, pen }`. */
export const farmsOf = (buildings: Int32Array, flags: Int32Array): Array<FarmEntry> =>
  Array.from({ length: buildings.length }, (_, k) => ({
    building: buildings[k]!,
    rural: (flags[k]! & FARM_FLAGS.rural) !== 0,
    pen: (flags[k]! & FARM_FLAGS.pen) !== 0,
  }))

/** The lamps from their sections, in the key order the bake gives them (`bakeLamps`: `{ x, y, nx, ny, kind, z }`). */
export const lampsOf = (values: Array<number>, kinds: Int32Array): Array<Lamp> => {
  const n = kinds.length,
    at = (field: keyof typeof LAMP_WORDS, k: number) => values[LAMP_WORDS[field] * n + k]!
  return Array.from({ length: n }, (_, k) => ({
    x: at("x", k),
    y: at("y", k),
    nx: at("nx", k),
    ny: at("ny", k),
    kind: LAMP_KINDS[kinds[k]!]!,
    z: at("z", k),
  }))
}
