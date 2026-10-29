/**
 * The animals the valley holds for the ear: farm dogs in their yards, owls in their woods, and the
 * trees songbirds sing from. Dogs and owls are found where they are first asked for, each once the
 * tiles it reads are in memory (`../ground.ts`), and kept: they stand where they always did, whichever
 * tiles came first.
 *
 * @module audio/places/animals
 */
import { type Cover, coverAt } from "../../sim/map/cover.ts"
import { buildingBoxes, buildingsIn, heightAt, MAP, treesIn } from "../../sim/map/index.ts"
import { hash01 } from "../../tools/geometry.ts"
import { exactAt } from "../ground.ts"

/** A farm dog in a yard. */
export interface Dog {
  readonly key: string
  readonly x: number
  readonly y: number
  readonly z: number
  readonly big: boolean
}

/** Buildings with a dog: about one in `DOG_SHARE` of these kinds, out of the village cores, with open ground `YARD` m out. */
const KENNELS: ReadonlySet<string> = new Set(["barn", "shed", "house", "farm_auxiliary"])
const DOG_SHARE = 8,
  YARD = 5
const YARD_COVERS: ReadonlySet<Cover> = new Set(["meadow", "grassland", "farmland", "farmyard"])

/** Each kennel building's dog (null: none), by its index in `MAP.buildings`, once worked out. */
const dogs = new Map<number, Dog | null>()

/**
 * Building i's dog, if it has one: a hashed pick among the kennel buildings, in the first open yard
 * probed around it. None while a probe's tile is not in memory: it is worked out when asked again.
 */
const dogOf = (i: number): Dog | undefined => {
  const { id, kind } = MAP.buildings[i]!
  if (!KENNELS.has(kind) || hash01(id, 1) * DOG_SHARE >= 1) return undefined
  const known = dogs.get(i)
  if (known !== undefined) return known ?? undefined
  const [bx0, by0, bx1, by1] = buildingBoxes[i]!,
    cx = (bx0 + bx1) / 2,
    cy = (by0 + by1) / 2
  const probes = [
    [bx0 - YARD, cy],
    [cx, by0 - YARD],
    [bx1 + YARD, cy],
    [cx, by1 + YARD],
  ] as const
  if (!probes.every(([px, py]) => exactAt(px, py))) return undefined
  const covers = probes.map(([px, py]) => coverAt(px, py))
  const yard = covers.findIndex((c) => YARD_COVERS.has(c))
  let dog: Dog | null = null
  if (!covers.includes("paved") && yard >= 0) {
    const [x, y] = probes[yard]!
    dog = { key: `dog:${id}`, x, y, z: heightAt(x, y) + 0.5, big: hash01(id, 2) < 0.5 }
  }
  dogs.set(i, dog)
  return dog ?? undefined
}

/** The dogs within `radius` m of (x, y), in the buildings' order. */
export const dogsNear = (x: number, y: number, radius: number): ReadonlyArray<Dog> => {
  const near: Array<number> = []
  // A dog stands within `YARD` m of its building's box.
  const reach = radius + YARD
  buildingsIn(x - reach, y - reach, x + reach, y + reach, (i) => void near.push(i))
  return near
    .sort((a, b) => a - b)
    .flatMap((i) => {
      const dog = dogOf(i)
      return dog !== undefined && (dog.x - x) ** 2 + (dog.y - y) ** 2 <= radius * radius
        ? [dog]
        : []
    })
}

/** A tawny owl in its wood: the tree it calls from. */
export interface Owl {
  readonly key: string
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * One owl territory in `OWL_SHARE` of the map's `OWL_CELL` m squares with woods in them (a tawny owl holds 20–30 ha), perched
 * `OWL_PERCH` m up a tree at the first of `OWL_TRIES` hashed points of the square that falls in forest.
 */
const OWL_CELL = 500,
  OWL_SHARE = 0.7,
  OWL_TRIES = 8,
  OWL_PERCH = 8

const { minX, minY, maxX, maxY } = MAP.bounds
/** How many owl squares from `lo` start short of `hi`. */
const squares = (lo: number, hi: number) => {
  let n = 0
  while (lo + n * OWL_CELL < hi) n++
  return n
}
/** The owl squares along x and along y, from the map's south-west corner. */
const owlCols = squares(minX, maxX),
  owlRows = squares(minY, maxY)
/** Each owl square's owl (null: none), by `i * owlRows + j`, once worked out. */
const owls = new Map<number, Owl | null>()

/** Square (i, j)'s owl, if it has one. None while a point it tries is not in memory: it is worked out when asked again. */
const owlOf = (i: number, j: number): Owl | undefined => {
  if (hash01(i, j, 11) >= OWL_SHARE) return undefined
  const known = owls.get(i * owlRows + j)
  if (known !== undefined) return known ?? undefined
  let owl: Owl | null = null
  for (let k = 0; k < OWL_TRIES; k++) {
    const x = Math.min(maxX, minX + (i + hash01(i, j, k, 12)) * OWL_CELL),
      y = Math.min(maxY, minY + (j + hash01(i, j, k, 13)) * OWL_CELL)
    if (!exactAt(x, y)) return undefined
    if (coverAt(x, y) !== "forest") continue
    owl = { key: `owl:${i},${j}`, x, y, z: heightAt(x, y) + OWL_PERCH }
    break
  }
  owls.set(i * owlRows + j, owl)
  return owl ?? undefined
}

/** The owls within `radius` m of (x, y), in the squares' order (south to north, the westmost column first). */
export const owlsNear = (x: number, y: number, radius: number): ReadonlyArray<Owl> => {
  const out: Array<Owl> = []
  // The squares the disc's box reaches.
  const first = (v: number, lo: number) => Math.max(0, Math.floor((v - radius - lo) / OWL_CELL)),
    last = (v: number, lo: number, n: number) =>
      Math.min(n - 1, Math.floor((v + radius - lo) / OWL_CELL))
  for (let i = first(x, minX), i1 = last(x, minX, owlCols); i <= i1; i++)
    for (let j = first(y, minY), j1 = last(y, minY, owlRows); j <= j1; j++) {
      const owl = owlOf(i, j)
      if (owl !== undefined && (owl.x - x) ** 2 + (owl.y - y) ** 2 <= radius * radius) out.push(owl)
    }
  return out
}

/** Birds sing from trees `BIRD_NEAR` to `BIRD_FAR` m from the listener. */
const BIRD_NEAR = 15,
  BIRD_FAR = 70

/** A random tree 15–70 m from (x, y) for a bird to sing from, 6–12 m up; undefined where no tree is that near. */
export const birdSpot = (
  x: number,
  y: number,
  random: () => number,
): { readonly x: number; readonly y: number; readonly z: number } | undefined => {
  let tx = 0,
    ty = 0,
    seen = 0
  treesIn(x - BIRD_FAR, y - BIRD_FAR, x + BIRD_FAR, y + BIRD_FAR, (px, py) => {
    const d2 = (px - x) ** 2 + (py - y) ** 2
    // Reservoir sampling: every tree in the ring is equally likely, with no list.
    if (d2 >= BIRD_NEAR ** 2 && d2 <= BIRD_FAR ** 2 && random() * ++seen < 1) [tx, ty] = [px, py]
  })
  if (seen === 0) return undefined
  return { x: tx, y: ty, z: heightAt(tx, ty) + 6 + 6 * random() }
}
