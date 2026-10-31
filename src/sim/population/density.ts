/**
 * How many people live where, from the map's buildings: each home's residents from its floor area,
 * summed around a point (how many people are out near the player) and around each walk edge (where
 * they walk). Built once at load from `MAP`, so it is static data shared by every runtime.
 *
 * @module population/density
 */
import { edgeIndex, midpointOf } from "../edges.ts"
import { buildingsIn, graph, MAP } from "../map/index.ts"

/** Building kinds people live in: the CTR's houses and the OSM tags for homes ("yes" is an untagged OSM building, nearly always a house). */
const HOMES: ReadonlySet<string> = new Set([
  "house",
  "residential",
  "yes",
  "apartments",
  "detached",
  "semidetached_house",
  "terrace",
  "farm",
  "bungalow",
])
/** Storey height, m: the eave height over this is the number of floors (at least 1, at most `MAX_FLOORS`). */
const STOREY = 3
const MAX_FLOORS = 5
/**
 * Gross floor area per resident, m²: ISTAT's 2023 average occupied dwelling is 101 m² for 2.25 people (45 m² each, usable
 * area), and walls and stairs take about a fifth of the gross.
 */
const GROSS_PER_RESIDENT = 56
/**
 * Share of homes lived in: an estimate, since many village houses in the Apuan valleys are holiday homes or empty. At 0.3 the
 * map's homes hold about 3,250 residents.
 */
const LIVED_IN = 0.3

/** Residents of building `i`: 0 for anything that is not a home, and for ruins. */
const residents = Float32Array.from(MAP.buildings, (b) => {
  if (!HOMES.has(b.kind) || b.ruins === true || b.style === "ruin") return 0
  let twice = 0
  for (let k = 0, n = b.outer.length; k < n; k += 2)
    twice += b.outer[k]! * b.outer[(k + 3) % n]! - b.outer[(k + 2) % n]! * b.outer[k + 1]!
  let area = Math.abs(twice) / 2
  for (const hole of b.holes ?? []) {
    let h = 0
    for (let k = 0, n = hole.length; k < n; k += 2)
      h += hole[k]! * hole[(k + 3) % n]! - hole[(k + 2) % n]! * hole[k + 1]!
    area -= Math.abs(h) / 2
  }
  const floors = Math.min(MAX_FLOORS, Math.max(1, Math.round(b.h / STOREY)))
  return (Math.max(0, area) * floors * LIVED_IN) / GROSS_PER_RESIDENT
})
/** Each building's centre (the mean of its outer ring's vertices), x then y. */
const centres = Float64Array.from(
  MAP.buildings.flatMap((b) => {
    let x = 0,
      y = 0
    const n = b.outer.length / 2
    for (let k = 0; k < b.outer.length; k += 2) [x, y] = [x + b.outer[k]!, y + b.outer[k + 1]!]
    return [x / n, y / n]
  }),
)
/** The centre of building `i`: the mean of its outer ring's vertices. */
export const buildingCentre = (i: number): { readonly x: number; readonly y: number } => ({
  x: centres[2 * i]!,
  y: centres[2 * i + 1]!,
})

/** Residents of the homes whose centre is within `r` m of (x, y). */
export const residentsNear = (x: number, y: number, r: number): number => {
  let sum = 0
  buildingsIn(x - r, y - r, x + r, y + r, (i) => {
    const dx = centres[2 * i]! - x,
      dy = centres[2 * i + 1]! - y
    if (dx * dx + dy * dy <= r * r) sum += residents[i]!
  })
  return sum
}

/** Walk edges count the residents within this many metres of their midpoint. */
export const EDGE_REACH = 60
/**
 * A walk edge with fewer residents than this nearby (a lone house or two) never gets a spawn, and walkers seldom turn into one
 * (`WALK_FLOOR` in route.ts): an isolated street stays empty.
 */
export const PEOPLED = 6

/**
 * Per walk edge (`graph.walkEdges` order), the residents within `EDGE_REACH` m of its midpoint, as
 * float32: they read buildings all over the map, so the build bakes them (`MAP.derived.residents`).
 */
export const bakeResidents = (): Array<number> =>
  graph.walkEdges.map((e) => {
    const m = midpointOf(e)
    return Math.fround(residentsNear(m.x, m.y, EDGE_REACH))
  })

const edgeResidents = new Float32Array(graph.edges.length)
graph.walkEdges.forEach((e, k) => (edgeResidents[e] = MAP.derived.residents[k] ?? 0))
/** Residents within `EDGE_REACH` m of the midpoint of walk edge `edge` (0 for any other edge). */
export const residentsAlong = (edge: number): number => edgeResidents[edge] ?? 0
/** Lookups over the walk edges people walk: those with at least `PEOPLED` residents nearby. */
export const peopledIndex = edgeIndex(graph.walkEdges.filter((e) => edgeResidents[e]! >= PEOPLED))
