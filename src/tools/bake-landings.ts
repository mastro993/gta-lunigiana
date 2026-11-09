// The registry of bakes, their landings half: where each bake's values land in the map, and what
// the provisional map holds there until the bake runs. The runs are in bake.ts, keyed by the same
// names; they load the owners, which decode `MAP`, so the cut (tile-map.ts) reads this module alone
// to make the provisional map the build hands over before it loads them (`writeMap` in
// build-output.ts).
import type { MonzoneMap, Spawn } from "../sim/map/index.ts"

/** The global map before its hash: what the cut makes and the bakes land in. */
type Global = Omit<MonzoneMap, "hash">

/** Where a value lands in the global map: a key, or a key of one of its records. */
type Path = {
  [K in keyof Global]-?:
    | readonly [K]
    | (Global[K] extends ArrayLike<unknown> | string | number
        ? never
        : readonly [K, Extract<keyof Global[K], string>])
}[keyof Global]

/** The value the global map holds at `P`. */
type At<P extends Path> = P extends readonly [infer K extends keyof Global, infer L]
  ? Global[K][L & keyof Global[K]]
  : Global[P[0]]

/** A bake landing in the global map: each of its values, by name, at its path in `at`; `empty` given the built parked spots. */
const inGlobal = <const P extends Readonly<Record<string, Path>>>(
  at: P,
  empty: (spots: ReadonlyArray<Spawn>) => { readonly [N in keyof P]: At<P[N]> },
) => ({ at, empty })

/**
 * Every bake, by name: where it lands (`at` in the global map, or `tiles` for the water's floors,
 * on each water piece in the tiles) and its value in the provisional map (`empty`). Each bake runs
 * on the provisional map and the whole map's vectors alone, never on another bake's value, so the
 * farms' building centres are part of the farms bake. The order gives the global file's key order:
 * `landBakes` writes the one-level landings in it (`lanes`, `farms`, `lamps`), then the copies in
 * `derived` and its landings (`bells`, `residents`, `farms`, `mouths`), so a new bake goes where
 * its keys are to stand in the file.
 */
export const BAKES = {
  lanes: inGlobal({ lanes: ["lanes"] }, () => ({
    lanes: { panda: [], ape: [], truck: [], carabinieri: [] },
  })),
  parked: inGlobal({ parked: ["spawns", "parked"] }, (spots) => ({
    parked: spots.map((s) => ({ ...s, rest: {} })),
  })),
  floors: { tiles: "Water.floor", empty: (): ReadonlyArray<ReadonlyArray<number>> => [] },
  bells: inGlobal({ bells: ["derived", "bells"] }, () => ({ bells: [] })),
  residents: inGlobal({ residents: ["derived", "residents"] }, () => ({ residents: [] })),
  farms: inGlobal({ farms: ["farms"], centres: ["derived", "farms"] }, () => ({
    farms: [],
    centres: [],
  })),
  lamps: inGlobal({ lamps: ["lamps"] }, () => ({ lamps: [] })),
  mouths: inGlobal({ mouths: ["derived", "mouths"] }, () => ({ mouths: [] })),
}

/** Each bake's values, by bake: what `bake` (bake.ts) returns. */
export type Bakes = { readonly [K in keyof typeof BAKES]: ReturnType<(typeof BAKES)[K]["empty"]> }

/** Every path a bake lands at in the global map. */
type Landed = {
  [K in keyof typeof BAKES]: (typeof BAKES)[K] extends { readonly at: infer A } ? A[keyof A] : never
}[keyof typeof BAKES]

/**
 * Each landing in the global map, in registry order: its bake's name, its path and its value in
 * `values(name)` (a bake's values, by landing name).
 */
export const landings = (values: (name: keyof Bakes) => unknown) =>
  (Object.keys(BAKES) as Array<keyof Bakes>).flatMap((name) => {
    const entry = BAKES[name]
    if (!("at" in entry)) return []
    // a bake landing in the global map gives a record of its values by landing name (`inGlobal`)
    const value = values(name) as Readonly<Record<string, unknown>>
    return Object.entries<Path>(entry.at).map(([key, path]) => ({ name, path, value: value[key] }))
  })

/**
 * The global map from what the cut makes of it besides the bakes, `derived` apart (`facts`, its
 * parked spots as built), the railway's copies in `derived` (`copies`) and `bakes`, each missing
 * one's empty value in its place. Written in the global file's key order: the facts, the one-level
 * landings in registry order, then `derived`, the copies first and then its landings (a value
 * written over an existing key keeps its place). `facts` and `copies` are left as they are.
 */
export const landBakes = (
  facts: Omit<Global, Extract<Landed, readonly [unknown]>[0] | "derived" | "spawns"> & {
    readonly spawns: Omit<Global["spawns"], "parked"> & { readonly parked: ReadonlyArray<Spawn> }
  },
  copies: Omit<Global["derived"], Extract<Landed, readonly ["derived", unknown]>[1]>,
  bakes: Partial<Bakes> = {},
): Global => {
  const all = landings((name) => bakes[name] ?? BAKES[name].empty(facts.spawns.parked))
  const out: Record<string, unknown> = { ...facts }
  for (const { path, value } of all) if (path.length === 1) out[path[0]] = value
  out.derived = copies
  // a fresh record on each write, so no landing writes into `facts` or `copies`
  for (const { path, value } of all)
    if (path.length === 2) out[path[0]] = { ...(out[path[0]] as object), [path[1]]: value }
  return out as Global
}
